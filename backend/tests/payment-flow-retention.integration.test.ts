import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { prisma } from "../src/config/prisma.js";
import { assertSafeLocalTestDatabase } from "../src/scripts/testDatabaseGuard.js";
import {
  createBookingApplication,
  expireStalePaymentFlows,
  getVenueAvailability,
  markWhatsappHandoff
} from "../src/services/booking.service.js";

assertSafeLocalTestDatabase();

after(async () => {
  await prisma.$disconnect();
});

test("[phase02] düzenleme süresi dolan başvuru ve WhatsApp erişimi korunur", async (context) => {
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

  const creationStartedAt = Date.now();
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
  const creationFinishedAt = Date.now();
  applicationId = application.id;
  assert.ok(application.paymentFlowExpiresAt);
  assert.ok(
    application.paymentFlowExpiresAt.valueOf() >= creationStartedAt + 24 * 60 * 60 * 1_000
  );
  assert.ok(
    application.paymentFlowExpiresAt.valueOf() <= creationFinishedAt + 24 * 60 * 60 * 1_000
  );
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

  const metrics = await expireStalePaymentFlows(sweepNow, correlationId);

  const retained = await prisma.bookingApplication.findUnique({ where: { id: application.id } });
  assert.ok(retained);
  assert.equal(retained.status, "ONAY_BEKLIYOR");
  assert.equal(retained.deletedAt, null);
  assert.ok(retained.paymentFlowExpiredAt);
  assert.ok(retained.paymentFlowTokenHash);
  assert.equal(metrics.physicalDeletedCount, 0);
  assert.equal(metrics.editingExpiredCount, 1);
  assert.equal((await expireStalePaymentFlows(sweepNow, correlationId)).selectedCount, 0);

  const handedOff = await markWhatsappHandoff(application.id, paymentFlowKey, correlationId);
  assert.ok(handedOff.whatsappHandoffAt);

  const editExpiredAudit = await prisma.auditLog.findFirst({
    where: {
      targetType: "BookingApplication",
      targetId: application.id,
      action: "booking.payment_flow_edit_expired"
    },
    select: { metadata: true }
  });
  assert.ok(editExpiredAudit);
  assert.equal(
    (editExpiredAudit.metadata as { reason?: string } | null)?.reason,
    "edit_window_elapsed"
  );
});

test("[phase02] bekleyen public başvuru ve WhatsApp geçişi salon slotunu tutmaz", async (context) => {
  const marker = randomUUID();
  const correlationId = randomUUID();
  const firstPaymentFlowKey = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
  const secondPaymentFlowKey = `${randomUUID()}${randomUUID()}`.replaceAll("-", "");
  const venue = await prisma.venue.create({
    data: {
      slug: `phase02-slot-${marker}`,
      name: `Phase 02 Slot ${marker}`,
      displayName: "Phase 02 Slot",
      isPartner: true,
      isActive: true
    }
  });
  const packageRecord = await prisma.package.create({
    data: {
      code: `phase02-slot-${marker}`,
      name: `Phase 02 Slot ${marker}`,
      priceCents: 100_000
    }
  });
  const applicationIds: string[] = [];

  context.after(async () => {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: applicationIds } } });
    await prisma.bookingApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.package.deleteMany({ where: { id: packageRecord.id } });
    await prisma.venue.deleteMany({ where: { id: venue.id } });
  });

  const createPendingApplication = async (
    suffix: string,
    paymentFlowKey: string
  ): Promise<{ id: string; status: string }> => {
    const application = await createBookingApplication(
      {
        brideFirstName: "Sentetik",
        brideLastName: `Gelin ${suffix}`,
        bridePhone: suffix === "first" ? "05550000011" : "05550000021",
        groomFirstName: "Sentetik",
        groomLastName: `Damat ${suffix}`,
        groomPhone: suffix === "first" ? "05550000012" : "05550000022",
        primaryContact: "GELIN",
        primaryEmail: `phase02-slot-${suffix}-${marker}@example.invalid`,
        weddingDate: "2095-09-10",
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
    applicationIds.push(application.id);
    return application;
  };

  const firstApplication = await createPendingApplication("first", firstPaymentFlowKey);
  await markWhatsappHandoff(firstApplication.id, firstPaymentFlowKey, correlationId);

  const availability = await getVenueAvailability(venue.id, "2095-09-10");
  assert.deepEqual(availability.occupiedSlots, []);

  const secondApplication = await createPendingApplication("second", secondPaymentFlowKey);
  assert.equal(firstApplication.status, "ONAY_BEKLIYOR");
  assert.equal(secondApplication.status, "ONAY_BEKLIYOR");
});
