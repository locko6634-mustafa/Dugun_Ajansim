import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { prisma } from "../src/config/prisma.js";
import { assertSafeLocalTestDatabase } from "../src/scripts/testDatabaseGuard.js";
import {
  createBookingApplication,
  expireStalePaymentFlows,
  markWhatsappHandoff
} from "../src/services/booking.service.js";

assertSafeLocalTestDatabase();

after(async () => {
  await prisma.$disconnect();
});

test("[phase02] handoff kaydı TTL sonrasında fiziksel olarak silinmez", async (context) => {
  const marker = randomUUID();
  const correlationId = randomUUID();
  const paymentFlowKey = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
  const venue = await prisma.venue.create({
    data: {
      slug: `phase02-${marker}`,
      name: `Phase 02 ${marker}`,
      displayName: "Phase 02",
      isPartner: true,
      isActive: true
    }
  });
  const packageRecord = await prisma.package.create({
    data: {
      code: `phase02-${marker}`,
      name: `Phase 02 ${marker}`,
      priceCents: 100_000
    }
  });
  let applicationId = "";

  context.after(async () => {
    if (applicationId) {
      await prisma.auditLog.deleteMany({ where: { targetId: applicationId } });
      await prisma.bookingApplication.deleteMany({ where: { id: applicationId } });
    }
    await prisma.package.deleteMany({ where: { id: packageRecord.id } });
    await prisma.venue.deleteMany({ where: { id: venue.id } });
  });

  const application = await createBookingApplication(
    {
      brideFirstName: "Sentetik",
      brideLastName: "Gelin",
      bridePhone: "05550000001",
      groomFirstName: "Sentetik",
      groomLastName: "Damat",
      groomPhone: "05550000002",
      primaryContact: "GELIN",
      primaryEmail: `phase02-${marker}@example.invalid`,
      weddingDate: "2095-08-10",
      startTime: "19:00",
      endTime: "23:00",
      endsNextDay: false,
      venueId: venue.id,
      packageCode: packageRecord.code,
      serviceCodes: [],
      paymentMethod: "CASH",
      privacyConsent: true,
      marketingConsent: false
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: randomUUID(),
      paymentFlowKey,
      correlationId
    }
  );
  applicationId = application.id;
  const sweepNow = new Date("2030-08-12T12:00:00.000Z");
  await prisma.bookingApplication.update({
    where: { id: application.id },
    data: { paymentFlowExpiresAt: sweepNow }
  });

  await assert.rejects(
    expireStalePaymentFlows(sweepNow, null as unknown as string),
    /correlationId|must not be null/i
  );
  const rolledBack = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: application.id }
  });
  assert.equal(rolledBack.status, "ONAY_BEKLIYOR");
  assert.equal(rolledBack.deletedAt, null);
  assert.equal(rolledBack.paymentFlowExpiredAt, null);
  assert.ok(rolledBack.paymentFlowTokenHash);

  await markWhatsappHandoff(application.id, paymentFlowKey, correlationId);
  await prisma.bookingApplication.update({
    where: { id: application.id },
    data: {
      paymentFlowExpiresAt: sweepNow,
      whatsappHandoffAt: new Date(sweepNow.valueOf() - 25 * 60 * 60 * 1_000)
    }
  });

  const metrics = await expireStalePaymentFlows(sweepNow, correlationId);

  const retained = await prisma.bookingApplication.findUnique({ where: { id: application.id } });
  assert.ok(retained);
  assert.equal(retained.status, "ONAY_BEKLIYOR");
  assert.equal(retained.deletedAt, null);
  assert.ok(retained.whatsappHandoffAt);
  assert.equal(retained.paymentFlowTokenHash, null);
  assert.equal(metrics.physicalDeletedCount, 0);
  assert.ok(metrics.preservedEvidenceCount >= 1);
  assert.equal((await expireStalePaymentFlows(sweepNow, correlationId)).selectedCount, 0);

  const accessClosedAudit = await prisma.auditLog.findFirst({
    where: {
      targetType: "BookingApplication",
      targetId: application.id,
      action: "booking.payment_flow_access_closed"
    },
    select: { metadata: true }
  });
  assert.ok(accessClosedAudit);
  assert.equal(
    (accessClosedAudit.metadata as { reason?: string } | null)?.reason,
    "handoff_or_payment_evidence_retained"
  );
});
