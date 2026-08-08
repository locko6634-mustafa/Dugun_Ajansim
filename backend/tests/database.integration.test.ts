import assert from "node:assert/strict";
import { after, test } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.config.js";
import { prisma } from "../src/config/prisma.js";
import { CSRF_COOKIE_NAME } from "../src/middlewares/auth.middleware.js";
import { assertSafeLocalTestDatabase } from "../src/scripts/testDatabaseGuard.js";
import {
  approveBookingApplication,
  createBookingApplication,
  expireStalePaymentFlows,
  getVenueAvailability,
  markWhatsappHandoff,
  rejectBookingApplication
} from "../src/services/booking.service.js";
import { decryptValue, hashPassword, hashToken, verifyPassword } from "../src/utils/crypto.js";
import {
  addCalendarDays,
  deliveryEncryptionAad,
  getIstanbulDate,
  messageSecretEncryptionAad
} from "../src/utils/domain.js";

assertSafeLocalTestDatabase();

const assertOperationsWeddingContract = (wedding: Record<string, unknown>) => {
  for (const field of [
    "applicationId",
    "customerUserId",
    "primaryContact",
    "primaryEmail",
    "venueId",
    "cancelledAt",
    "deletedAt",
    "deletedById",
    "createdAt",
    "updatedAt"
  ]) {
    assert.equal(field in wedding, false, `Operasyon düğün yanıtı ${field} alanını içermemeli.`);
  }
  assert.equal(typeof wedding.id, "string");
  assert.equal(typeof wedding.brideFirstName, "string");
  assert.equal(typeof wedding.bridePhone, "string");
  assert.equal(typeof wedding.groomFirstName, "string");
  assert.equal(typeof wedding.groomPhone, "string");
  assert.deepEqual(Object.keys(wedding.packageSummary as object), ["name"]);
  assert.equal(typeof (wedding.packageSummary as { name: unknown }).name, "string");
};

after(async () => {
  await prisma.$disconnect();
});

test("test veritabanı guard yalnızca açık yerel hedefi kabul eder", () => {
  const safeEnvironment = { ...process.env };
  const unsafeEnvironments = [
    { ...safeEnvironment, TEST_DATABASE_GUARD: undefined },
    {
      ...safeEnvironment,
      DATABASE_URL: "postgresql://test_user:test_password@example.com:55632/dugun_ajansim_test"
    },
    {
      ...safeEnvironment,
      DATABASE_URL: "postgresql://test_user:test_password@localhost:5432/dugun_ajansim_test"
    },
    {
      ...safeEnvironment,
      DATABASE_URL: "postgresql://test_user:test_password@localhost:55632/baska_test"
    }
  ];

  assert.doesNotThrow(() => assertSafeLocalTestDatabase(safeEnvironment));
  for (const unsafeEnvironment of unsafeEnvironments) {
    assert.throws(() => assertSafeLocalTestDatabase(unsafeEnvironment));
  }
});

test("migration ile oluşturulan tablo ve gerçek healthcheck birlikte çalışır", async (context) => {
  assert.equal(env.ADMIN_SESSION_IDLE_MINUTES, 720);
  assert.equal(env.SALON_SESSION_IDLE_MINUTES, 720);
  assert.equal(env.CUSTOMER_SESSION_IDLE_HOURS, 12);
  assert.equal(env.TEMPORARY_PASSWORD_TTL_HOURS, 72);
  const healthRecord = await prisma.systemHealth.create({
    data: { status: "integration-test" }
  });

  context.after(async () => {
    await prisma.systemHealth.delete({ where: { id: healthRecord.id } });
  });

  const storedRecord = await prisma.systemHealth.findUnique({
    where: { id: healthRecord.id }
  });
  assert.equal(storedRecord?.status, "integration-test");

  const userDefault = await prisma.$queryRaw<Array<{ column_default: string | null }>>`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'mustChangePassword'
  `;
  assert.equal(userDefault[0]?.column_default, null);

  const catalogArrayColumns = await prisma.$queryRaw<
    Array<{ table_name: string; column_name: string; is_nullable: string }>
  >`
    SELECT table_name, column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
        (table_name = 'packages' AND column_name = 'features')
        OR (table_name = 'services' AND column_name IN ('features', 'gallery'))
      )
    ORDER BY table_name, column_name
  `;
  assert.equal(catalogArrayColumns.length, 3);
  assert.equal(
    catalogArrayColumns.every((column) => column.is_nullable === "NO"),
    true
  );

  const response = await request(createApp()).get("/api/v1/health");
  const catalogResponse = await request(createApp()).get("/api/v1/catalog");

  assert.equal(response.status, 200);
  assert.equal(response.body.success, true);
  assert.equal(response.body.database, "connected");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(catalogResponse.status, 200);
  assert.deepEqual(catalogResponse.body.data.paymentPolicy, {
    cashDiscountPercent: 10,
    depositMaximumCents: 500_000
  });
  assert.equal(catalogResponse.body.data.bookingFormConstraints.personName.maxLength, 80);
  assert.equal(catalogResponse.body.data.bookingFormConstraints.phone.maxLength, 24);
  assert.equal(catalogResponse.body.data.bookingFormConstraints.note.maxLength, 2_000);
});

test("expired, revoked, idle, disabled ve süresi dolmuş geçici kimlikler reddedilir", async (context) => {
  const marker = `guard-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const password = "yalnizca-guard-entegrasyon-parolasi";
  const user = await prisma.user.create({
    data: {
      username: marker,
      passwordHash: await hashPassword(password),
      role: "ADMIN",
      status: "ACTIVE",
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: new Date()
    }
  });
  context.after(async () => {
    await prisma.user.delete({ where: { id: user.id } });
  });
  const app = createApp();
  const sessionCookie = (token: string) => `${env.SESSION_COOKIE_NAME}=${token}`;
  const now = Date.now();

  await assert.rejects(
    prisma.user.update({
      where: { id: user.id },
      data: { temporaryPasswordExpiresAt: new Date(now + 60_000) }
    })
  );
  await assert.rejects(
    prisma.authSession.create({
      data: {
        tokenHash: hashToken(`${marker}-invalid-expiry`),
        csrfTokenHash: hashToken(`${marker}-invalid-expiry-csrf`),
        userId: user.id,
        createdAt: new Date(now),
        expiresAt: new Date(now - 1)
      }
    })
  );

  const expiredToken = `${marker}-expired`;
  const expiredSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(expiredToken),
      csrfTokenHash: hashToken(`${expiredToken}-csrf`),
      userId: user.id,
      createdAt: new Date(now - 2 * 60 * 60 * 1000),
      lastUsedAt: new Date(now - 2 * 60 * 60 * 1000),
      expiresAt: new Date(now - 60 * 60 * 1000)
    }
  });
  assert.equal(
    (await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie(expiredToken)))
      .status,
    401
  );
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: expiredSession.id } })).revokedAt
  );

  const revokedToken = `${marker}-revoked`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(revokedToken),
      csrfTokenHash: hashToken(`${revokedToken}-csrf`),
      userId: user.id,
      expiresAt: new Date(now + 60 * 60 * 1000),
      revokedAt: new Date()
    }
  });
  assert.equal(
    (await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie(revokedToken)))
      .status,
    401
  );

  const idleToken = `${marker}-idle`;
  const idleSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(idleToken),
      csrfTokenHash: hashToken(`${idleToken}-csrf`),
      userId: user.id,
      createdAt: new Date(now - 60 * 60 * 1000),
      lastUsedAt: new Date(now - 721 * 60 * 1000),
      expiresAt: new Date(now + 60 * 60 * 1000)
    }
  });
  assert.equal(
    (await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie(idleToken))).status,
    401
  );
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: idleSession.id } })).revokedAt
  );

  const disabledToken = `${marker}-disabled`;
  const disabledSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(disabledToken),
      csrfTokenHash: hashToken(`${disabledToken}-csrf`),
      userId: user.id,
      expiresAt: new Date(now + 60 * 60 * 1000)
    }
  });
  await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });
  assert.equal(
    (await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie(disabledToken)))
      .status,
    401
  );
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: disabledSession.id } })).revokedAt
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      status: "ACTIVE",
      mustChangePassword: true,
      temporaryPasswordExpiresAt: new Date(now - 1),
      passwordChangedAt: null
    }
  });
  const expiredTemporaryLogin = await request(app).post("/api/v1/auth/login").send({
    username: user.username,
    password,
    remember: false
  });
  const unknownLogin = await request(app)
    .post("/api/v1/auth/login")
    .send({
      username: `${marker}-unknown`,
      password,
      remember: false
    });
  assert.equal(expiredTemporaryLogin.status, 401);
  assert.equal(unknownLogin.status, 401);
  assert.equal(expiredTemporaryLogin.body.message, unknownLogin.body.message);
});

test("başvuru, atomik onay, rol izolasyonu ve gizli teslimat uçtan uca çalışır", async (context) => {
  const marker = `it-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const correlationId = `integration-${marker}`;
  const weddingDate = addCalendarDays(getIstanbulDate(new Date()), 30);
  let venueId: string | undefined;
  const secondaryVenueIds: string[] = [];
  let adminId: string | undefined;
  let managerId: string | undefined;
  const staffIds: string[] = [];
  let assignmentScopeTriggerDisabled = false;

  context.after(async () => {
    if (assignmentScopeTriggerDisabled) {
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "wedding_assignments" ENABLE TRIGGER "wedding_assignments_venue_match_trigger"'
      );
    }
    await prisma.auditLog.deleteMany({ where: { correlationId } });
    const applications = await prisma.bookingApplication.findMany({
      where: { primaryEmail: { contains: marker } },
      select: { id: true }
    });
    const applicationIds = applications.map((item) => item.id);
    const weddings = await prisma.wedding.findMany({
      where: { applicationId: { in: applicationIds } },
      select: { id: true, customerUserId: true }
    });
    await prisma.wedding.deleteMany({ where: { id: { in: weddings.map((item) => item.id) } } });
    await prisma.staff.deleteMany({ where: { id: { in: staffIds } } });
    await prisma.user.deleteMany({
      where: { id: { in: weddings.map((item) => item.customerUserId) } }
    });
    await prisma.bookingApplication.deleteMany({ where: { id: { in: applicationIds } } });
    await prisma.package.deleteMany({ where: { code: { contains: marker } } });
    if (managerId) await prisma.user.deleteMany({ where: { id: managerId } });
    if (secondaryVenueIds.length > 0) {
      await prisma.venue.deleteMany({ where: { id: { in: secondaryVenueIds } } });
    }
    if (venueId) await prisma.venue.deleteMany({ where: { id: venueId } });
    if (adminId) await prisma.user.deleteMany({ where: { id: adminId } });
  });

  const venue = await prisma.venue.create({
    data: { slug: marker, name: `Test Salonu ${marker}` }
  });
  venueId = venue.id;
  const secondVenue = await prisma.venue.create({
    data: { slug: `${marker}-second`, name: `Test Salonu İki ${marker}` }
  });
  secondaryVenueIds.push(secondVenue.id);
  const packageRecord = await prisma.package.create({
    data: {
      code: marker,
      name: `Test Paketi ${marker}`,
      priceCents: 2_000_000
    }
  });
  const admin = await prisma.user.create({
    data: {
      username: `admin-${marker}`,
      passwordHash: await hashPassword("Guvenli-Test-123"),
      role: "ADMIN",
      mustChangePassword: false,
      passwordChangedAt: new Date()
    }
  });
  adminId = admin.id;

  const applicationInput = {
    brideFirstName: "Ayşe",
    brideLastName: "Yılmaz",
    bridePhone: "05551234567",
    groomFirstName: "Mehmet",
    groomLastName: "Demir",
    groomPhone: "05559876543",
    primaryContact: "GELIN" as const,
    primaryEmail: `bir-${marker}@example.com`,
    weddingDate,
    startTime: "20:00",
    endTime: "02:00",
    endsNextDay: true,
    venueId: venue.id,
    packageCode: packageRecord.code,
    serviceCodes: [],
    paymentMethod: "CASH" as const,
    note: "",
    privacyConsent: true,
    marketingConsent: false
  };
  const paymentFlowKey = `${marker}-payment-flow-key-1234567890`;
  const firstApplication = await createBookingApplication(applicationInput, {
    source: "PUBLIC_FORM",
    idempotencyKey: `${marker}-idempotent`,
    paymentFlowKey,
    correlationId
  });
  const duplicateApplication = await createBookingApplication(applicationInput, {
    source: "PUBLIC_FORM",
    idempotencyKey: `${marker}-idempotent`,
    paymentFlowKey,
    correlationId
  });
  assert.equal(duplicateApplication.id, firstApplication.id);
  assert.equal(firstApplication.totalPriceCents, 1_800_000);
  await assert.rejects(
    prisma.bookingApplication.update({
      where: { id: firstApplication.id },
      data: { payableNowCents: 1 }
    })
  );
  await assert.rejects(
    prisma.bookingApplication.update({
      where: { id: firstApplication.id },
      data: { weddingEndsAt: new Date(`${weddingDate}T17:00:00.000Z`) }
    })
  );
  const concurrentIdempotencyKey = `${marker}-concurrent-idempotency`;
  const concurrentDate = addCalendarDays(weddingDate, 3);
  const concurrentApplications = await Promise.all([
    createBookingApplication(
      {
        ...applicationInput,
        weddingDate: concurrentDate,
        primaryEmail: `eszamanli-${marker}@example.com`
      },
      {
        source: "PUBLIC_FORM",
        idempotencyKey: concurrentIdempotencyKey,
        paymentFlowKey: `${marker}-concurrent-flow-key-1234567890`,
        correlationId
      }
    ),
    createBookingApplication(
      {
        ...applicationInput,
        weddingDate: concurrentDate,
        primaryEmail: `eszamanli-${marker}@example.com`
      },
      {
        source: "PUBLIC_FORM",
        idempotencyKey: concurrentIdempotencyKey,
        paymentFlowKey: `${marker}-concurrent-flow-key-1234567890`,
        correlationId
      }
    )
  ]);
  assert.equal(concurrentApplications[0].id, concurrentApplications[1].id);
  assert.equal(
    await prisma.bookingApplication.count({
      where: { idempotencyKey: concurrentIdempotencyKey }
    }),
    1
  );
  await assert.rejects(
    createBookingApplication(
      {
        ...applicationInput,
        brideFirstName: "Farkli"
      },
      {
        source: "PUBLIC_FORM",
        idempotencyKey: `${marker}-idempotent`,
        paymentFlowKey,
        correlationId
      }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 409
  );

  // Aynı salon ve saat aralığında çakışan başvuru reddedilmelidir (400 Bad Request)
  await assert.rejects(
    createBookingApplication(
      {
        ...applicationInput,
        primaryEmail: `cakisan-${marker}@example.com`
      },
      {
        source: "PUBLIC_FORM",
        idempotencyKey: `${marker}-conflicting-test`,
        paymentFlowKey: `${marker}-conflicting-flow-key-1234567890`,
        correlationId
      }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 400
  );

  const secondApplication = await createBookingApplication(
    {
      ...applicationInput,
      venueId: secondVenue.id,
      weddingDate,
      brideFirstName: "Elif",
      groomFirstName: "Can",
      primaryEmail: `iki-${marker}@example.com`
    },
    {
      source: "ADMIN",
      idempotencyKey: `${marker}-second`,
      actor: { id: admin.id },
      correlationId
    }
  );

  const archivedDate = addCalendarDays(weddingDate, 8);
  const archivedApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: archivedDate,
      primaryEmail: `arsiv-${marker}@example.com`
    },
    {
      source: "ADMIN",
      idempotencyKey: `${marker}-archived`,
      actor: { id: admin.id },
      correlationId
    }
  );
  await prisma.bookingApplication.update({
    where: { id: archivedApplication.id },
    data: { deletedAt: new Date(), deletedById: admin.id }
  });
  await assert.rejects(
    approveBookingApplication(archivedApplication.id, admin.id, correlationId),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 404
  );
  await assert.rejects(
    rejectBookingApplication(archivedApplication.id, "Arşivli kayıt", admin.id, correlationId),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 409
  );
  assert.equal(await prisma.wedding.count({ where: { applicationId: archivedApplication.id } }), 0);
  const replacementApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: archivedDate,
      primaryEmail: `arsiv-yedek-${marker}@example.com`
    },
    {
      source: "ADMIN",
      idempotencyKey: `${marker}-archived-replacement`,
      actor: { id: admin.id },
      correlationId
    }
  );

  const retryApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 2),
      brideFirstName: "Derya",
      groomFirstName: "Mert",
      primaryEmail: `retry-${marker}@example.com`
    },
    {
      source: "ADMIN",
      idempotencyKey: `${marker}-username-retry`,
      actor: { id: admin.id },
      correlationId
    }
  );
  let usernameAttempts = 0;
  const retryUsername = `retry-${marker}`;
  const retriedApproval = await approveBookingApplication(
    retryApplication.id,
    admin.id,
    correlationId,
    {
      createUsername: async () => {
        usernameAttempts += 1;
        return usernameAttempts === 1 ? admin.username : retryUsername;
      }
    }
  );
  assert.equal(usernameAttempts, 2);
  assert.equal(retriedApproval.username, retryUsername);

  await markWhatsappHandoff(firstApplication.id, paymentFlowKey, correlationId);

  const concurrentApprovals = await Promise.allSettled([
    approveBookingApplication(firstApplication.id, admin.id, correlationId),
    approveBookingApplication(firstApplication.id, admin.id, correlationId)
  ]);
  assert.equal(concurrentApprovals.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentApprovals.filter((result) => result.status === "rejected").length, 1);
  const rejectedApprovalResult = concurrentApprovals.find((result) => result.status === "rejected");
  assert.ok(rejectedApprovalResult);
  assert.equal(
    rejectedApprovalResult.reason instanceof Error && "statusCode" in rejectedApprovalResult.reason
      ? (rejectedApprovalResult.reason as { statusCode: unknown }).statusCode
      : undefined,
    409
  );
  assert.equal(await prisma.wedding.count({ where: { applicationId: firstApplication.id } }), 1);
  assert.equal(
    (
      await prisma.bookingApplication.findUniqueOrThrow({
        where: { id: firstApplication.id },
        select: { paymentFlowTokenHash: true }
      })
    ).paymentFlowTokenHash,
    null
  );
  const firstApprovalResult = concurrentApprovals.find((result) => result.status === "fulfilled");
  assert.ok(firstApprovalResult);
  const firstApproval = firstApprovalResult.value;
  const secondApproval = await approveBookingApplication(
    secondApplication.id,
    admin.id,
    correlationId
  );
  assert.notEqual(firstApproval.username, secondApproval.username);

  const wedding = await prisma.wedding.findUniqueOrThrow({
    where: { id: firstApproval.weddingId },
    include: { customerUser: true, delivery: true, messageTasks: true }
  });
  assert.ok(wedding.delivery);
  assert.equal(wedding.messageTasks.length, 2);
  const activationTask = wedding.messageTasks.find((task) => task.kind === "ACCOUNT_ACTIVATION");
  assert.ok(
    activationTask?.secretCiphertext && activationTask.secretIv && activationTask.secretAuthTag
  );
  const temporaryPassword = decryptValue(
    {
      ciphertext: activationTask.secretCiphertext,
      iv: activationTask.secretIv,
      authTag: activationTask.secretAuthTag
    },
    messageSecretEncryptionAad(wedding.id, activationTask.kind)
  );
  assert.equal(await verifyPassword(wedding.customerUser.passwordHash, temporaryPassword), true);
  assert.notEqual(temporaryPassword, weddingDate.replaceAll("-", ""));
  assert.equal(activationTask.encryptionVersion, 2);
  assert.equal(wedding.delivery?.encryptionVersion, 2);
  assert.ok(wedding.customerUser.temporaryPasswordExpiresAt);
  assert.ok(wedding.customerUser.activeAt);
  assert.equal(
    wedding.customerUser.temporaryPasswordExpiresAt.valueOf() -
      wedding.customerUser.activeAt.valueOf(),
    env.TEMPORARY_PASSWORD_TTL_HOURS * 60 * 60 * 1000
  );
  assert.equal(wedding.endsAt.toISOString(), `${weddingDate}T23:00:00.000Z`);
  assert.equal(
    wedding.delivery?.dueDate.toISOString().slice(0, 10),
    addCalendarDays(weddingDate, 21)
  );

  const preActivationToken = `${marker}-pre-activation-session-token`;
  const preActivationSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(preActivationToken),
      csrfTokenHash: hashToken(`${marker}-pre-activation-csrf`),
      userId: wedding.customerUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  const app = createApp();
  const approvedPaymentFlowRead = await request(app)
    .get(`/api/v1/booking-applications/${firstApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", paymentFlowKey);
  assert.equal(approvedPaymentFlowRead.status, 404);
  const routePaymentFlowKey = `${marker}-route-payment-flow-key-1234567890`;
  const publicRouteApplication = await request(app)
    .post("/api/v1/booking-applications")
    .set("X-Correlation-ID", correlationId)
    .set("Idempotency-Key", `${marker}-public-route-key`)
    .set("Payment-Flow-Key", routePaymentFlowKey)
    .send({
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 4),
      brideFirstName: "Route",
      groomFirstName: "Public",
      primaryEmail: `route-${marker}@example.com`
    });
  assert.equal(publicRouteApplication.status, 201);
  assert.equal(publicRouteApplication.headers["cache-control"], "no-store");
  assert.equal("idempotencyKey" in publicRouteApplication.body.data, false);
  assert.ok(publicRouteApplication.body.data.paymentFlowExpiresAt);
  const publicRouteApplicationId = publicRouteApplication.body.data.id as string;
  const originalPaymentFlowExpiry = publicRouteApplication.body.data.paymentFlowExpiresAt as string;

  const unauthorizedPaymentFlow = await request(app)
    .get(`/api/v1/booking-applications/${publicRouteApplicationId}/payment-flow`)
    .set("Payment-Flow-Key", `${marker}-wrong-payment-flow-key-1234567890`);
  assert.equal(unauthorizedPaymentFlow.status, 404);

  const restoredPaymentFlow = await request(app)
    .get(`/api/v1/booking-applications/${publicRouteApplicationId}/payment-flow`)
    .set("Payment-Flow-Key", routePaymentFlowKey);
  assert.equal(restoredPaymentFlow.status, 200);
  assert.equal(
    restoredPaymentFlow.body.data.referenceCode,
    publicRouteApplication.body.data.referenceCode
  );
  assert.equal(restoredPaymentFlow.body.data.primaryEmail, `route-${marker}@example.com`);

  const updatedPaymentFlow = await request(app)
    .patch(`/api/v1/booking-applications/${publicRouteApplicationId}/payment-flow`)
    .set("Payment-Flow-Key", routePaymentFlowKey)
    .send({
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 4),
      brideFirstName: "Route",
      groomFirstName: "Public",
      primaryEmail: `route-${marker}@example.com`,
      paymentMethod: "DEPOSIT",
      note: "Ödeme akışı güncellendi"
    });
  assert.equal(updatedPaymentFlow.status, 200);
  assert.equal(
    updatedPaymentFlow.body.data.referenceCode,
    publicRouteApplication.body.data.referenceCode
  );
  assert.equal(updatedPaymentFlow.body.data.paymentFlowExpiresAt, originalPaymentFlowExpiry);
  assert.equal(updatedPaymentFlow.body.data.paymentMethod, "DEPOSIT");

  await assert.rejects(
    approveBookingApplication(publicRouteApplicationId, admin.id, correlationId),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 409
  );
  const firstHandoff = await request(app)
    .post(`/api/v1/booking-applications/${publicRouteApplicationId}/whatsapp-handoff`)
    .set("Payment-Flow-Key", routePaymentFlowKey)
    .send({});
  const repeatedHandoff = await request(app)
    .post(`/api/v1/booking-applications/${publicRouteApplicationId}/whatsapp-handoff`)
    .set("Payment-Flow-Key", routePaymentFlowKey)
    .send({});
  assert.equal(firstHandoff.status, 200);
  assert.equal(repeatedHandoff.status, 200);
  assert.equal(
    repeatedHandoff.body.data.whatsappHandoffAt,
    firstHandoff.body.data.whatsappHandoffAt
  );
  const rejectedFlowKey = `${marker}-rejected-payment-flow-key-1234567890`;
  const rejectedFlowApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 9),
      primaryEmail: `rejected-flow-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-rejected-payment-flow`,
      paymentFlowKey: rejectedFlowKey,
      correlationId
    }
  );
  await rejectBookingApplication(
    rejectedFlowApplication.id,
    "Ödeme doğrulanamadı",
    admin.id,
    correlationId
  );
  const rejectedPaymentFlowRead = await request(app)
    .get(`/api/v1/booking-applications/${rejectedFlowApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", rejectedFlowKey);
  assert.equal(rejectedPaymentFlowRead.status, 404);
  assert.equal(
    (
      await prisma.bookingApplication.findUniqueOrThrow({
        where: { id: rejectedFlowApplication.id },
        select: { paymentFlowTokenHash: true }
      })
    ).paymentFlowTokenHash,
    null
  );

  const expiringDate = addCalendarDays(weddingDate, 5);
  const expiringFlowKey = `${marker}-expiring-payment-flow-key-1234567890`;
  const expiringApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: expiringDate,
      startTime: "10:00",
      endTime: "12:00",
      endsNextDay: false,
      primaryEmail: `expiring-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-expiring-payment-flow`,
      paymentFlowKey: expiringFlowKey,
      correlationId
    }
  );
  await prisma.bookingApplication.update({
    where: { id: expiringApplication.id },
    data: { paymentFlowExpiresAt: new Date(Date.now() - 1_000) }
  });
  assert.equal(await expireStalePaymentFlows(new Date(), correlationId), 1);
  const expiredApplication = await prisma.bookingApplication.findUnique({
    where: { id: expiringApplication.id }
  });
  assert.equal(expiredApplication, null);
  const expiredAvailability = await getVenueAvailability(venue.id, expiringDate);
  assert.equal(
    expiredAvailability.occupiedSlots.some(
      (slot) => slot.startTime === "10:00" && slot.endTime === "12:00"
    ),
    false
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { targetType: "BookingApplication", targetId: expiringApplication.id }
    }),
    0
  );

  const customVenueName = `Anonim Salon ${marker}`;
  const updatedCustomVenueName = `${customVenueName} Güncel`;
  const customVenueFlowKey = `${marker}-custom-venue-expiry-key-1234567890`;
  const customVenueWeddingDate = addCalendarDays(weddingDate, 8);
  const customVenueApplication = await createBookingApplication(
    {
      ...applicationInput,
      venueId: undefined,
      customVenueName,
      weddingDate: customVenueWeddingDate,
      primaryEmail: `custom-venue-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-custom-venue-expiry`,
      paymentFlowKey: customVenueFlowKey,
      correlationId
    }
  );
  const customVenue = await prisma.venue.findUniqueOrThrow({
    where: { name: customVenueName },
    select: { id: true }
  });
  secondaryVenueIds.push(customVenue.id);
  const updatedCustomVenueFlow = await request(app)
    .patch(`/api/v1/booking-applications/${customVenueApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", customVenueFlowKey)
    .send({
      ...applicationInput,
      venueId: undefined,
      customVenueName: updatedCustomVenueName,
      weddingDate: customVenueWeddingDate,
      primaryEmail: `custom-venue-${marker}@example.com`
    });
  assert.equal(updatedCustomVenueFlow.status, 200);
  assert.equal(updatedCustomVenueFlow.body.data.customVenueName, updatedCustomVenueName);
  assert.equal(await prisma.venue.count({ where: { id: customVenue.id } }), 0);
  const updatedCustomVenue = await prisma.venue.findUniqueOrThrow({
    where: { name: updatedCustomVenueName },
    select: { id: true }
  });
  secondaryVenueIds.push(updatedCustomVenue.id);
  await prisma.bookingApplication.update({
    where: { id: customVenueApplication.id },
    data: { paymentFlowExpiresAt: new Date(Date.now() - 1_000) }
  });

  assert.equal(await expireStalePaymentFlows(new Date(), correlationId), 1);
  assert.equal(
    await prisma.bookingApplication.count({ where: { id: customVenueApplication.id } }),
    0
  );
  assert.equal(await prisma.venue.count({ where: { id: updatedCustomVenue.id } }), 0);
  assert.equal(
    await prisma.auditLog.count({
      where: { targetType: "BookingApplication", targetId: customVenueApplication.id }
    }),
    0
  );

  const handedOffExpiringDate = addCalendarDays(weddingDate, 6);
  const handedOffExpiringFlowKey = `${marker}-handed-off-expiring-flow-key-1234567890`;
  const handedOffExpiringApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: handedOffExpiringDate,
      startTime: "13:00",
      endTime: "15:00",
      endsNextDay: false,
      primaryEmail: `handed-off-expiring-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-handed-off-expiring-payment-flow`,
      paymentFlowKey: handedOffExpiringFlowKey,
      correlationId
    }
  );
  await markWhatsappHandoff(
    handedOffExpiringApplication.id,
    handedOffExpiringFlowKey,
    correlationId
  );
  await prisma.bookingApplication.update({
    where: { id: handedOffExpiringApplication.id },
    data: { paymentFlowExpiresAt: new Date(Date.now() - 1_000) }
  });
  const handedOffExpiredAvailability = await getVenueAvailability(
    venue.id,
    handedOffExpiringDate
  );
  assert.equal(
    handedOffExpiredAvailability.occupiedSlots.some(
      (slot) => slot.startTime === "13:00" && slot.endTime === "15:00"
    ),
    false
  );
  const replacementAfterHandoffExpiry = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: handedOffExpiringDate,
      startTime: "13:00",
      endTime: "15:00",
      endsNextDay: false,
      primaryEmail: `handoff-expiry-replacement-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-handoff-expiry-replacement`,
      paymentFlowKey: `${marker}-handoff-expiry-replacement-key-1234567890`,
      correlationId
    }
  );
  assert.ok(replacementAfterHandoffExpiry.id);
  assert.equal(await expireStalePaymentFlows(new Date(), correlationId), 1);
  const expiredHandedOffApplication = await prisma.bookingApplication.findUnique({
    where: { id: handedOffExpiringApplication.id }
  });
  assert.equal(expiredHandedOffApplication, null);
  assert.equal(
    await prisma.auditLog.count({
      where: {
        targetId: handedOffExpiringApplication.id,
        targetType: "BookingApplication"
      }
    }),
    0
  );

  const approvalExpiryRaceDate = addCalendarDays(weddingDate, 7);
  const approvalExpiryRaceFlowKey = `${marker}-approval-expiry-race-key-1234567890`;
  const approvalExpiryRaceApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: approvalExpiryRaceDate,
      startTime: "16:00",
      endTime: "18:00",
      endsNextDay: false,
      primaryEmail: `approval-expiry-race-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-approval-expiry-race`,
      paymentFlowKey: approvalExpiryRaceFlowKey,
      correlationId
    }
  );
  await markWhatsappHandoff(
    approvalExpiryRaceApplication.id,
    approvalExpiryRaceFlowKey,
    correlationId
  );
  let approvalExpiryWasForced = false;
  await assert.rejects(
    approveBookingApplication(
      approvalExpiryRaceApplication.id,
      admin.id,
      correlationId,
      {
        createUsername: async () => {
          approvalExpiryWasForced = true;
          await prisma.bookingApplication.update({
            where: { id: approvalExpiryRaceApplication.id },
            data: { paymentFlowExpiresAt: new Date(Date.now() - 1_000) }
          });
          return `expiry-race-${marker}`;
        }
      }
    ),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 410
  );
  assert.equal(approvalExpiryWasForced, true);
  assert.equal(
    await prisma.wedding.count({ where: { applicationId: approvalExpiryRaceApplication.id } }),
    0
  );
  const expiredPaymentFlowRead = await request(app)
    .get(`/api/v1/booking-applications/${approvalExpiryRaceApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", approvalExpiryRaceFlowKey);
  assert.equal(expiredPaymentFlowRead.status, 404);

  const beforeActivation = await request(app)
    .get("/api/v1/customer/dashboard")
    .set("Cookie", `${env.SESSION_COOKIE_NAME}=${preActivationToken}`);
  assert.equal(beforeActivation.status, 401);
  const revokedPreActivationSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: preActivationSession.id }
  });
  assert.ok(revokedPreActivationSession.revokedAt);

  await prisma.user.update({
    where: { id: wedding.customerUserId },
    data: { activeAt: new Date(Date.now() - 60_000) }
  });
  const login = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Correlation-ID", correlationId)
    .send({
      username: wedding.customerUser.username,
      password: temporaryPassword,
      remember: true
    });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.mustChangePassword, true);
  const loginCookies = login.headers["set-cookie"] as unknown as string[];
  const loginSessionCookie = loginCookies.find((cookie) =>
    cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`)
  );
  const loginCsrfCookie = loginCookies.find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`));
  assert.ok(loginSessionCookie);
  assert.ok(loginCsrfCookie);
  let customerCookie = loginSessionCookie.split(";", 1)[0];
  let customerCsrfCookie = loginCsrfCookie.split(";", 1)[0];
  const customerToken = customerCookie.slice(`${env.SESSION_COOKIE_NAME}=`.length);
  let customerCsrfToken = customerCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);

  const secondarySession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(`${marker}-secondary-session-token`),
      csrfTokenHash: hashToken(`${marker}-secondary-csrf`),
      userId: wedding.customerUserId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  const forcedPasswordChange = await request(app)
    .get("/api/v1/customer/dashboard")
    .set("Cookie", customerCookie);
  assert.equal(forcedPasswordChange.status, 428);

  const passwordHashBeforeCsrfFailure = (
    await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })
  ).passwordHash;
  const csrfRejectedPasswordChange = await request(app)
    .post("/api/v1/auth/password/change")
    .set("Cookie", `${customerCookie}; ${customerCsrfCookie}`)
    .send({
      currentPassword: temporaryPassword,
      newPassword: "csrf-olmadan-kullanilamayacak-kalici-parola"
    });
  assert.equal(csrfRejectedPasswordChange.status, 403);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })).passwordHash,
    passwordHashBeforeCsrfFailure
  );

  const passwordChange = await request(app)
    .post("/api/v1/auth/password/change")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", `${customerCookie}; ${customerCsrfCookie}`)
    .set("X-CSRF-Token", customerCsrfToken)
    .send({
      currentPassword: temporaryPassword,
      newPassword: "yalnizca-entegrasyonda-kullanilan-kalici-parola"
    });
  assert.equal(passwordChange.status, 200);
  const rotatedSessionCookie = (passwordChange.headers["set-cookie"] as unknown as string[]).find(
    (cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`)
  );
  const rotatedCsrfCookie = (passwordChange.headers["set-cookie"] as unknown as string[]).find(
    (cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`)
  );
  assert.ok(rotatedSessionCookie);
  assert.ok(rotatedCsrfCookie);
  customerCookie = rotatedSessionCookie.split(";", 1)[0];
  customerCsrfCookie = rotatedCsrfCookie.split(";", 1)[0];
  customerCsrfToken = customerCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);

  const invalidatedTemporaryTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: activationTask.id }
  });
  assert.equal(invalidatedTemporaryTask.status, "CANCELLED");
  assert.equal(invalidatedTemporaryTask.secretCiphertext, null);
  assert.equal(invalidatedTemporaryTask.secretIv, null);
  assert.equal(invalidatedTemporaryTask.secretAuthTag, null);
  const changedCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId }
  });
  assert.equal(changedCustomer.mustChangePassword, false);
  assert.equal(changedCustomer.temporaryPasswordExpiresAt, null);
  assert.ok(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: secondarySession.id } })).revokedAt
  );

  const rotatedOldSession = await request(app)
    .get("/api/v1/customer/dashboard")
    .set("Cookie", `${env.SESSION_COOKIE_NAME}=${customerToken}`);
  assert.equal(rotatedOldSession.status, 401);
  const ownDashboard = await request(app)
    .get(`/api/v1/customer/dashboard?weddingId=${secondApproval.weddingId}`)
    .set("Cookie", customerCookie);
  assert.equal(ownDashboard.status, 200);
  assert.equal(ownDashboard.body.data.couple.bride, "Ayşe Yılmaz");

  const adminToken = `${marker}-admin-session-token`;
  const adminCsrfToken = `${marker}-admin-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(adminToken),
      csrfTokenHash: hashToken(adminCsrfToken),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  const adminCookie = `${env.SESSION_COOKIE_NAME}=${adminToken}`;
  const adminAuthCookie = `${adminCookie}; ${CSRF_COOKIE_NAME}=${adminCsrfToken}`;
  const archivedFlowKey = `${marker}-archived-payment-flow-key-1234567890`;
  const archivedFlowApplication = await createBookingApplication(
    {
      ...applicationInput,
      weddingDate: addCalendarDays(weddingDate, 10),
      primaryEmail: `archived-flow-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-archived-payment-flow`,
      paymentFlowKey: archivedFlowKey,
      correlationId
    }
  );
  const archivedFlow = await request(app)
    .post(`/api/v1/admin/booking-applications/${archivedFlowApplication.id}/archive`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(archivedFlow.status, 200);
  const archivedPaymentFlowRead = await request(app)
    .get(`/api/v1/booking-applications/${archivedFlowApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", archivedFlowKey);
  assert.equal(archivedPaymentFlowRead.status, 404);
  assert.equal(
    (
      await prisma.bookingApplication.findUniqueOrThrow({
        where: { id: archivedFlowApplication.id },
        select: { paymentFlowTokenHash: true }
      })
    ).paymentFlowTokenHash,
    null
  );
  const adminForbidden = await request(app)
    .get("/api/v1/customer/dashboard")
    .set("Cookie", adminCookie);
  assert.equal(adminForbidden.status, 403);
  const applicationLookup = await request(app)
    .get(`/api/v1/admin/booking-applications?referenceCode=${firstApplication.referenceCode}`)
    .set("Cookie", adminCookie);
  assert.equal(applicationLookup.status, 200);
  assert.equal(applicationLookup.body.data.length, 1);
  assert.equal(applicationLookup.body.data[0].id, firstApplication.id);
  assert.equal("idempotencyKey" in applicationLookup.body.data[0], false);
  assert.equal("idempotencyFingerprint" in applicationLookup.body.data[0], false);
  const applicationDetail = await request(app)
    .get(`/api/v1/admin/booking-applications/${firstApplication.id}`)
    .set("Cookie", adminCookie);
  assert.equal(applicationDetail.status, 200);
  assert.equal("idempotencyKey" in applicationDetail.body.data, false);
  assert.equal("idempotencyFingerprint" in applicationDetail.body.data, false);

  const conflictingRestore = await request(app)
    .post(`/api/v1/admin/booking-applications/${archivedApplication.id}/restore`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(conflictingRestore.status, 409);
  assert.equal(conflictingRestore.body.errors.code, "VENUE_SCHEDULE_CONFLICT");
  await prisma.bookingApplication.delete({ where: { id: replacementApplication.id } });
  const successfulRestore = await request(app)
    .post(`/api/v1/admin/booking-applications/${archivedApplication.id}/restore`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(successfulRestore.status, 200);
  assert.equal(successfulRestore.body.data.deletedAt, null);

  const secondWeddingBeforeCredentialRotation = await prisma.wedding.findUniqueOrThrow({
    where: { id: secondApproval.weddingId },
    include: { customerUser: true }
  });
  const secondPasswordReset = await request(app)
    .post(
      `/api/v1/admin/customers/${secondWeddingBeforeCredentialRotation.customerUserId}/reset-password`
    )
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(secondPasswordReset.status, 200);
  assert.equal(typeof secondPasswordReset.body.data.message, "string");
  assert.equal(new URL(secondPasswordReset.body.data.whatsappUrl).search, "");
  assert.equal(
    secondPasswordReset.body.data.whatsappUrl.includes(secondPasswordReset.body.data.message),
    false
  );
  const cancelledSecondActivation = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: {
        weddingId: secondWeddingBeforeCredentialRotation.id,
        kind: "ACCOUNT_ACTIVATION"
      }
    }
  });
  assert.equal(cancelledSecondActivation.status, "CANCELLED");
  assert.equal(cancelledSecondActivation.secretCiphertext, null);
  assert.equal(cancelledSecondActivation.secretIv, null);
  assert.equal(cancelledSecondActivation.secretAuthTag, null);

  const rotatedSecondWedding = await request(app)
    .patch(`/api/v1/admin/weddings/${secondWeddingBeforeCredentialRotation.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: "Elifnur",
      brideLastName: secondWeddingBeforeCredentialRotation.brideLastName,
      bridePhone: secondWeddingBeforeCredentialRotation.bridePhone,
      groomFirstName: secondWeddingBeforeCredentialRotation.groomFirstName,
      groomLastName: secondWeddingBeforeCredentialRotation.groomLastName,
      groomPhone: secondWeddingBeforeCredentialRotation.groomPhone,
      primaryContact: secondWeddingBeforeCredentialRotation.primaryContact,
      primaryEmail: secondWeddingBeforeCredentialRotation.primaryEmail,
      weddingDate: getIstanbulDate(secondWeddingBeforeCredentialRotation.startsAt),
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: secondWeddingBeforeCredentialRotation.venueId,
      packageCode: (secondWeddingBeforeCredentialRotation.packageSummary as { code: string }).code,
      serviceCodes: (
        secondWeddingBeforeCredentialRotation.packageSummary as {
          services: Array<{ code: string }>;
        }
      ).services.map((service) => service.code),
      note: secondWeddingBeforeCredentialRotation.note ?? ""
    });
  assert.equal(rotatedSecondWedding.status, 200);
  assert.equal(rotatedSecondWedding.body.data.credentialsRegenerated, true);
  const cancelledSecondReset = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: {
        weddingId: secondWeddingBeforeCredentialRotation.id,
        kind: "PASSWORD_RESET"
      }
    }
  });
  assert.equal(cancelledSecondReset.status, "CANCELLED");
  assert.equal(cancelledSecondReset.secretCiphertext, null);
  assert.equal(cancelledSecondReset.secretIv, null);
  assert.equal(cancelledSecondReset.secretAuthTag, null);
  const renewedSecondActivation = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: {
        weddingId: secondWeddingBeforeCredentialRotation.id,
        kind: "ACCOUNT_ACTIVATION"
      }
    }
  });
  assert.equal(renewedSecondActivation.status, "PENDING");
  assert.ok(
    renewedSecondActivation.secretCiphertext &&
      renewedSecondActivation.secretIv &&
      renewedSecondActivation.secretAuthTag
  );

  const createdStaff = await request(app)
    .post("/api/v1/admin/staff")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      firstName: "Deniz",
      lastName: "Kamera",
      phone: "05551112233",
      venueId: venue.id,
      specialties: ["PHOTOGRAPHY", "VIDEO"],
      isActive: true
    });
  assert.equal(createdStaff.status, 201);
  staffIds.push(createdStaff.body.data.id as string);
  assert.equal(createdStaff.body.data.phone, "+905551112233");

  const createdManager = await request(app)
    .post("/api/v1/admin/venue-managers")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      username: `sorumlu-${marker}`,
      password: "Manager-Test-2026!",
      venueId: venue.id,
      status: "ACTIVE"
    });
  assert.equal(createdManager.status, 201);
  managerId = createdManager.body.data.id as string;
  await prisma.user.update({
    where: { id: managerId },
    data: {
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: new Date()
    }
  });
  const managerToken = `${marker}-manager-token`;
  const managerCsrfToken = `${marker}-manager-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(managerToken),
      csrfTokenHash: hashToken(managerCsrfToken),
      userId: managerId,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  const managerCookie = `${env.SESSION_COOKIE_NAME}=${managerToken}`;
  const managerAuthCookie = `${managerCookie}; ${CSRF_COOKIE_NAME}=${managerCsrfToken}`;
  const secondaryVenue = await prisma.venue.create({
    data: { slug: `other-${marker}`, name: `Diğer Salon ${marker}` }
  });
  secondaryVenueIds.push(secondaryVenue.id);
  const foreignStaff = await prisma.staff.create({
    data: {
      firstName: "Başka",
      lastName: "Salon",
      phone: "+905559990011",
      specialties: ["VIDEO"],
      venueId: secondaryVenue.id
    }
  });
  staffIds.push(foreignStaff.id);

  await assert.rejects(
    prisma.weddingAssignment.create({
      data: { weddingId: wedding.id, staffId: foreignStaff.id, specialty: "VIDEO" }
    })
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "wedding_assignments" DISABLE TRIGGER "wedding_assignments_venue_match_trigger"'
  );
  assignmentScopeTriggerDisabled = true;
  let legacyCrossVenueAssignmentId = "";
  try {
    const legacyCrossVenueAssignment = await prisma.weddingAssignment.create({
      data: { weddingId: wedding.id, staffId: foreignStaff.id, specialty: "VIDEO" }
    });
    legacyCrossVenueAssignmentId = legacyCrossVenueAssignment.id;
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "wedding_assignments" ENABLE TRIGGER "wedding_assignments_venue_match_trigger"'
    );
    assignmentScopeTriggerDisabled = false;
  }

  const venueOperationsDashboard = await request(app)
    .get("/api/v1/operations/dashboard")
    .set("Cookie", managerCookie);
  assert.equal(venueOperationsDashboard.status, 200);
  assert.equal(venueOperationsDashboard.body.data.venue.id, venue.id);
  for (const dashboardWedding of [
    ...venueOperationsDashboard.body.data.todayWeddings,
    ...venueOperationsDashboard.body.data.weekWeddings
  ]) {
    assertOperationsWeddingContract(dashboardWedding);
  }
  for (const conflict of venueOperationsDashboard.body.data.conflicts) {
    assertOperationsWeddingContract(conflict.firstWedding);
    assertOperationsWeddingContract(conflict.secondWedding);
  }
  const venueOperationsCalendar = await request(app)
    .get(`/api/v1/operations/calendar?month=${weddingDate.slice(0, 7)}`)
    .set("Cookie", managerCookie);
  assert.equal(venueOperationsCalendar.status, 200);
  for (const calendarWedding of venueOperationsCalendar.body.data.weddings) {
    assertOperationsWeddingContract(calendarWedding);
  }
  const venueOperationsWeddings = await request(app)
    .get("/api/v1/operations/weddings")
    .set("Cookie", managerCookie);
  assert.equal(venueOperationsWeddings.status, 200);
  assert.ok(
    venueOperationsWeddings.body.data.some(
      (operationsWedding: { id: string }) => operationsWedding.id === wedding.id
    )
  );
  for (const operationsWedding of venueOperationsWeddings.body.data) {
    assertOperationsWeddingContract(operationsWedding);
  }
  const scopedWeddingDetail = await request(app)
    .get(`/api/v1/operations/weddings/${wedding.id}`)
    .set("Cookie", managerCookie);
  assert.equal(scopedWeddingDetail.status, 200);
  assertOperationsWeddingContract(scopedWeddingDetail.body.data);
  assert.equal(
    scopedWeddingDetail.body.data.assignments.some(
      (assignment: { staffId: string }) => assignment.staffId === foreignStaff.id
    ),
    false
  );
  const crossVenueAdminAssignment = await request(app)
    .post(`/api/v1/admin/weddings/${wedding.id}/assignments`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ staffId: foreignStaff.id, specialty: "VIDEO", allowConflict: false });
  assert.equal(crossVenueAdminAssignment.status, 409);
  assert.equal(crossVenueAdminAssignment.body.errors.code, "VENUE_ASSIGNMENT_MISMATCH");
  await prisma.weddingAssignment.delete({ where: { id: legacyCrossVenueAssignmentId } });
  const operationsScheduleConflict = await request(app)
    .patch(`/api/v1/operations/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", managerAuthCookie)
    .set("X-CSRF-Token", managerCsrfToken)
    .send({
      weddingDate: addCalendarDays(weddingDate, 2),
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      note: "Çakışan salon sorumlusu güncellemesi"
    });
  assert.equal(operationsScheduleConflict.status, 409);
  assert.equal(operationsScheduleConflict.body.errors.code, "VENUE_SCHEDULE_CONFLICT");
  const operationsWeddingUpdate = await request(app)
    .patch(`/api/v1/operations/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", managerAuthCookie)
    .set("X-CSRF-Token", managerCsrfToken)
    .send({
      weddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      note: "Salon sorumlusu operasyon notu"
    });
  assert.equal(operationsWeddingUpdate.status, 200);
  assertOperationsWeddingContract(operationsWeddingUpdate.body.data);
  const applicationAfterOperationsUpdate = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: wedding.applicationId }
  });
  assert.equal(applicationAfterOperationsUpdate.note, "Salon sorumlusu operasyon notu");
  const operationsStaff = await request(app)
    .get("/api/v1/operations/staff")
    .set("Cookie", managerCookie);
  assert.equal(operationsStaff.status, 200);
  assert.equal(
    operationsStaff.body.data.some(
      (staff: { id: string }) => staff.id === createdStaff.body.data.id
    ),
    true
  );
  assert.equal(
    operationsStaff.body.data.some((staff: { id: string }) => staff.id === foreignStaff.id),
    false
  );
  const updatedOwnStaff = await request(app)
    .patch(`/api/v1/operations/staff/${createdStaff.body.data.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", managerAuthCookie)
    .set("X-CSRF-Token", managerCsrfToken)
    .send({ firstName: "Denizcan" });
  assert.equal(updatedOwnStaff.status, 200);
  const rejectedForeignStaff = await request(app)
    .patch(`/api/v1/operations/staff/${foreignStaff.id}`)
    .set("Cookie", managerAuthCookie)
    .set("X-CSRF-Token", managerCsrfToken)
    .send({ firstName: "Erişilmemeli" });
  assert.equal(rejectedForeignStaff.status, 404);

  const invalidStaff = await request(app)
    .post("/api/v1/admin/staff")
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ firstName: "Eksik", lastName: "Uzmanlık", phone: "05551112244", specialties: [] });
  assert.equal(invalidStaff.status, 400);

  const firstAssignment = await request(app)
    .post(`/api/v1/admin/weddings/${wedding.id}/assignments`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      staffId: createdStaff.body.data.id,
      specialty: "PHOTOGRAPHY",
      allowConflict: false
    });
  assert.equal(firstAssignment.status, 201);

  const rejectedCrossVenueAssignment = await request(app)
    .post(`/api/v1/admin/weddings/${secondApproval.weddingId}/assignments`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      staffId: createdStaff.body.data.id,
      specialty: "VIDEO",
      allowConflict: false
    });
  assert.equal(rejectedCrossVenueAssignment.status, 409);
  assert.equal(rejectedCrossVenueAssignment.body.errors.code, "VENUE_ASSIGNMENT_MISMATCH");

  const operationsDashboard = await request(app)
    .get(`/api/v1/admin/dashboard?weekStart=${weddingDate}`)
    .set("Cookie", adminCookie);
  assert.equal(operationsDashboard.status, 200);
  assert.equal(operationsDashboard.body.data.conflicts.length, 0);
  assert.equal(operationsDashboard.body.data.distribution.PHOTOGRAPHY, 1);
  assert.equal(operationsDashboard.body.data.distribution.VIDEO, 0);

  const venueCalendar = await request(app)
    .get(`/api/v1/admin/calendar?month=${weddingDate.slice(0, 7)}&venueId=${venue.id}`)
    .set("Cookie", adminCookie);
  assert.equal(venueCalendar.status, 200);
  assert.equal(venueCalendar.body.data.selectedVenue.id, venue.id);
  assert.equal(venueCalendar.body.data.month, weddingDate.slice(0, 7));
  assert.equal(venueCalendar.body.data.weddings.length, 2);
  assert.equal(
    venueCalendar.body.data.weddings.every(
      (calendarWedding: { venue: { name: string } }) => calendarWedding.venue.name === venue.name
    ),
    true
  );

  const invalidCalendarMonth = await request(app)
    .get("/api/v1/admin/calendar?month=2026-13")
    .set("Cookie", adminCookie);
  assert.equal(invalidCalendarMonth.status, 400);

  const weddingDetail = await request(app)
    .get(`/api/v1/admin/weddings/${wedding.id}`)
    .set("Cookie", adminCookie);
  assert.equal(weddingDetail.status, 200);
  assert.equal(weddingDetail.body.data.assignments.length, 1);
  assert.equal(
    JSON.stringify(weddingDetail.body.data.messageTasks).includes("secretCiphertext"),
    false
  );

  const archivedStaff = await request(app)
    .patch(`/api/v1/admin/staff/${createdStaff.body.data.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ isActive: false });
  assert.equal(archivedStaff.status, 200);
  assert.equal(archivedStaff.body.data.isActive, false);

  const routeVenueSlug = `route-venue-${marker}`;
  const invalidFeaturedVenue = await request(app)
    .post("/api/v1/admin/venues")
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      slug: `invalid-featured-${marker}`,
      name: `Eksik Vitrin Mekânı ${marker}`,
      displayName: null,
      imagePath: null,
      isFeatured: true
    });
  assert.equal(invalidFeaturedVenue.status, 400);
  assert.equal(await prisma.venue.count({ where: { slug: `invalid-featured-${marker}` } }), 0);

  const createdRouteVenue = await request(app)
    .post("/api/v1/admin/venues")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      slug: routeVenueSlug,
      name: `Route Test Mekânı ${marker}`,
      displayName: "API Vitrin Mekânı",
      imagePath: "assets/images/venues/rena.webp",
      displayOrder: 23,
      isFeatured: true,
      isPartner: true,
      isActive: true
    });
  assert.equal(createdRouteVenue.status, 201);
  const routeVenueId = createdRouteVenue.body.data.id as string;
  secondaryVenueIds.push(routeVenueId);

  const publicVenues = await request(app).get("/api/v1/venues");
  assert.equal(publicVenues.status, 200);
  assert.deepEqual(
    publicVenues.body.data.find((item: { id: string }) => item.id === routeVenueId),
    {
      id: routeVenueId,
      slug: routeVenueSlug,
      name: `Route Test Mekânı ${marker}`,
      displayName: "API Vitrin Mekânı",
      imagePath: "assets/images/venues/rena.webp",
      displayOrder: 23,
      isFeatured: true
    }
  );

  const patchedRouteVenue = await request(app)
    .patch(`/api/v1/admin/venues/${routeVenueId}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ displayName: "Güncel Vitrin Mekânı", displayOrder: 3 });
  assert.equal(patchedRouteVenue.status, 200);
  assert.equal(patchedRouteVenue.body.data.displayName, "Güncel Vitrin Mekânı");
  assert.equal(patchedRouteVenue.body.data.displayOrder, 3);

  const emptyRouteVenuePatch = await request(app)
    .patch(`/api/v1/admin/venues/${routeVenueId}`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(emptyRouteVenuePatch.status, 400);

  const referencedRouteVenue = await request(app)
    .post("/api/v1/admin/venues")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      slug: `referenced-venue-${marker}`,
      name: `İlişkili Test Mekânı ${marker}`,
      displayName: "İlişkili Vitrin Mekânı",
      imagePath: "assets/images/venues/bella.webp",
      displayOrder: 24,
      isFeatured: true,
      isPartner: true,
      isActive: true
    });
  assert.equal(referencedRouteVenue.status, 201);
  const referencedRouteVenueId = referencedRouteVenue.body.data.id as string;
  secondaryVenueIds.push(referencedRouteVenueId);
  const referencedVenueStaff = await prisma.staff.create({
    data: {
      firstName: "İlişkili",
      lastName: "Personel",
      phone: `0555${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
      specialties: [],
      venueId: referencedRouteVenueId
    }
  });
  staffIds.push(referencedVenueStaff.id);

  const deactivatedReferencedVenue = await request(app)
    .delete(`/api/v1/admin/venues/${referencedRouteVenueId}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(deactivatedReferencedVenue.status, 200);
  assert.equal(deactivatedReferencedVenue.body.data.isActive, false);
  assert.equal(deactivatedReferencedVenue.body.data.isFeatured, false);
  assert.equal(await prisma.venue.count({ where: { id: referencedRouteVenueId } }), 1);

  const deletedRouteVenue = await request(app)
    .delete(`/api/v1/admin/venues/${routeVenueId}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(deletedRouteVenue.status, 200);
  assert.equal(await prisma.venue.count({ where: { id: routeVenueId } }), 0);

  const routePackageCode = `route-${marker}`;
  const createdRoutePackage = await request(app)
    .post("/api/v1/admin/packages")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      code: routePackageCode,
      name: "Route Test Paketi",
      description: null,
      imagePath: null,
      priceCents: 1_000_000,
      isActive: true
    });
  assert.equal(createdRoutePackage.status, 201);
  const duplicateRoutePackage = await request(app)
    .post("/api/v1/admin/packages")
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      code: routePackageCode,
      name: "Çakışan Route Test Paketi",
      description: null,
      imagePath: null,
      priceCents: 1_100_000,
      isActive: true
    });
  assert.equal(duplicateRoutePackage.status, 409);
  const routePackageId = createdRoutePackage.body.data.id as string;
  const patchedRoutePackage = await request(app)
    .patch(`/api/v1/admin/packages/${routePackageId}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ priceCents: 1_200_000 });
  assert.equal(patchedRoutePackage.status, 200);
  assert.equal(patchedRoutePackage.body.data.priceCents, 1_200_000);
  const emptyRoutePackagePatch = await request(app)
    .patch(`/api/v1/admin/packages/${routePackageId}`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(emptyRoutePackagePatch.status, 400);
  const archivedRoutePackage = await request(app)
    .delete(`/api/v1/admin/packages/${routePackageId}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(archivedRoutePackage.status, 200);
  assert.equal(archivedRoutePackage.body.data.isActive, false);
  assert.equal(await prisma.package.count({ where: { id: routePackageId } }), 0);
  const deactivatedReferencedPackage = await request(app)
    .delete(`/api/v1/admin/packages/${packageRecord.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(deactivatedReferencedPackage.status, 200);
  assert.equal(deactivatedReferencedPackage.body.data.isActive, false);
  assert.equal(
    (await prisma.package.findUniqueOrThrow({ where: { id: packageRecord.id } })).isActive,
    false
  );

  const customerPasswordHashBeforeWeddingUpdate = (
    await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })
  ).passwordHash;
  const updatedWeddingDate = addCalendarDays(weddingDate, 1);
  const adminScheduleConflict = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: wedding.brideFirstName,
      brideLastName: wedding.brideLastName,
      bridePhone: wedding.bridePhone,
      groomFirstName: wedding.groomFirstName,
      groomLastName: wedding.groomLastName,
      groomPhone: wedding.groomPhone,
      primaryContact: wedding.primaryContact,
      primaryEmail: wedding.primaryEmail,
      weddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: secondVenue.id,
      packageCode: (wedding.packageSummary as { code: string }).code,
      serviceCodes: (wedding.packageSummary as { services: Array<{ code: string }> }).services.map(
        (service) => service.code
      ),
      note: wedding.note ?? ""
    });
  assert.equal(adminScheduleConflict.status, 409);
  assert.equal(adminScheduleConflict.body.errors.code, "VENUE_SCHEDULE_CONFLICT");

  const adminVenueAssignmentMismatch = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: wedding.brideFirstName,
      brideLastName: wedding.brideLastName,
      bridePhone: wedding.bridePhone,
      groomFirstName: wedding.groomFirstName,
      groomLastName: wedding.groomLastName,
      groomPhone: wedding.groomPhone,
      primaryContact: wedding.primaryContact,
      primaryEmail: wedding.primaryEmail,
      weddingDate: updatedWeddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: secondVenue.id,
      packageCode: (wedding.packageSummary as { code: string }).code,
      serviceCodes: (wedding.packageSummary as { services: Array<{ code: string }> }).services.map(
        (service) => service.code
      ),
      note: wedding.note ?? ""
    });
  assert.equal(adminVenueAssignmentMismatch.status, 409);
  assert.equal(adminVenueAssignmentMismatch.body.errors.code, "VENUE_ASSIGNMENT_MISMATCH");

  const weddingUpdate = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: wedding.brideFirstName,
      brideLastName: wedding.brideLastName,
      bridePhone: wedding.bridePhone,
      groomFirstName: wedding.groomFirstName,
      groomLastName: wedding.groomLastName,
      groomPhone: "05550001122",
      primaryContact: "DAMAT",
      primaryEmail: wedding.primaryEmail,
      weddingDate: updatedWeddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: wedding.venueId,
      packageCode: (wedding.packageSummary as { code: string }).code,
      serviceCodes: (wedding.packageSummary as { services: Array<{ code: string }> }).services.map(
        (service) => service.code
      ),
      note: wedding.note ?? ""
    });
  assert.equal(weddingUpdate.status, 200);
  assert.equal(weddingUpdate.body.data.credentialsRegenerated, false);
  assert.equal(weddingUpdate.body.data.username, wedding.customerUser.username);
  const applicationAfterAdminUpdate = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: wedding.applicationId }
  });
  assert.equal(applicationAfterAdminUpdate.groomPhone, "+905550001122");
  assert.equal(
    applicationAfterAdminUpdate.weddingStartsAt.toISOString(),
    weddingUpdate.body.data.startsAt
  );
  assert.equal(applicationAfterAdminUpdate.venueId, wedding.venueId);
  const customerAfterWeddingUpdate = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId }
  });
  assert.equal(customerAfterWeddingUpdate.passwordHash, customerPasswordHashBeforeWeddingUpdate);
  const linkedDeliveryAfterWeddingUpdate = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id }
  });
  assert.equal(
    linkedDeliveryAfterWeddingUpdate.dueDate.toISOString().slice(0, 10),
    addCalendarDays(updatedWeddingDate, 21)
  );
  const preparationAfterWeddingUpdate = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: { weddingId: wedding.id, kind: "PREPARATION_UPDATE" }
    }
  });
  assert.equal(preparationAfterWeddingUpdate.recipientPhone, "+905550001122");
  assert.equal(
    preparationAfterWeddingUpdate.dueAt.toISOString(),
    `${addCalendarDays(updatedWeddingDate, 2)}T07:00:00.000Z`
  );

  const driveUrl = "https://drive.google.com/file/d/integration-test";
  const preparedDelivery = await request(app)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ status: "TESLIME_HAZIR", driveUrl });
  assert.equal(preparedDelivery.status, 200);
  assert.equal(preparedDelivery.body.data.status, "TESLIME_HAZIR");
  const encryptedDelivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id }
  });
  assert.ok(
    encryptedDelivery.driveUrlCiphertext &&
      encryptedDelivery.driveUrlIv &&
      encryptedDelivery.driveUrlAuthTag
  );
  assert.equal(encryptedDelivery.driveUrlCiphertext.includes("drive.google.com"), false);
  assert.equal(
    decryptValue(
      {
        ciphertext: encryptedDelivery.driveUrlCiphertext,
        iv: encryptedDelivery.driveUrlIv,
        authTag: encryptedDelivery.driveUrlAuthTag
      },
      deliveryEncryptionAad(encryptedDelivery.id)
    ),
    driveUrl
  );
  const clearedDelivery = await request(app)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ driveUrl: null });
  assert.equal(clearedDelivery.status, 200);
  const deliveryWithoutUrl = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id }
  });
  assert.equal(deliveryWithoutUrl.driveUrlCiphertext, null);
  assert.equal(deliveryWithoutUrl.driveUrlIv, null);
  assert.equal(deliveryWithoutUrl.driveUrlAuthTag, null);
  const restoredDeliveryUrl = await request(app)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ driveUrl });
  assert.equal(restoredDeliveryUrl.status, 200);
  const hiddenDelivery = await request(app)
    .get("/api/v1/customer/delivery")
    .set("Cookie", customerCookie);
  assert.equal(hiddenDelivery.status, 404);
  assert.equal(JSON.stringify(ownDashboard.body).includes("drive.google.com"), false);
  const safeAdminWeddings = await request(app)
    .get("/api/v1/admin/weddings")
    .set("Cookie", adminCookie);
  assert.equal(safeAdminWeddings.status, 200);
  assert.equal(JSON.stringify(safeAdminWeddings.body).includes("driveUrlCiphertext"), false);

  await assert.rejects(
    prisma.delivery.update({
      where: { id: wedding.delivery!.id },
      data: { status: "TESLIM_EDILDI", releasedAt: null }
    })
  );
  const concurrentDeliveries = await Promise.all([
    request(app)
      .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
      .set("X-Correlation-ID", correlationId)
      .set("Cookie", adminAuthCookie)
      .set("X-CSRF-Token", adminCsrfToken)
      .send({}),
    request(app)
      .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
      .set("X-Correlation-ID", correlationId)
      .set("Cookie", adminAuthCookie)
      .set("X-CSRF-Token", adminCsrfToken)
      .send({})
  ]);
  assert.deepEqual(concurrentDeliveries.map((response) => response.status).sort(), [200, 409]);
  const deliveryHistory = await prisma.deliveryStatusHistory.findMany({
    where: { deliveryId: wedding.delivery!.id }
  });
  assert.equal(deliveryHistory.filter((entry) => entry.toStatus === "TESLIM_EDILDI").length, 1);
  await assert.rejects(
    prisma.deliveryStatusHistory.create({
      data: {
        deliveryId: wedding.delivery!.id,
        fromStatus: "TESLIM_EDILDI",
        toStatus: "TESLIM_EDILDI",
        actorUserId: admin.id
      }
    })
  );
  const deliveryMessage = await prisma.messageTask.findUniqueOrThrow({
    where: {
      weddingId_kind: { weddingId: wedding.id, kind: "DELIVERY_READY" }
    }
  });
  assert.equal(deliveryMessage.status, "PENDING");
  const releasedDelivery = await request(app)
    .get("/api/v1/customer/delivery")
    .set("Cookie", customerCookie);
  assert.equal(releasedDelivery.status, 200);
  assert.equal(releasedDelivery.body.data.driveUrl, driveUrl);

  const logout = await request(app)
    .post("/api/v1/auth/logout")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", `${customerCookie}; ${customerCsrfCookie}`)
    .set("X-CSRF-Token", customerCsrfToken)
    .send({});
  assert.equal(logout.status, 200);
  const loggedOutSession = await request(app)
    .get("/api/v1/auth/session")
    .set("Cookie", customerCookie);
  assert.equal(loggedOutSession.status, 401);

  const passwordReset = await request(app)
    .post(`/api/v1/admin/customers/${wedding.customerUserId}/reset-password`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(passwordReset.status, 200);
  assert.equal(passwordReset.headers["cache-control"], "no-store");
  assert.equal(typeof passwordReset.body.data.message, "string");
  assert.equal(new URL(passwordReset.body.data.whatsappUrl).search, "");
  assert.equal(
    passwordReset.body.data.whatsappUrl.includes(passwordReset.body.data.message),
    false
  );
  const resetTaskId = passwordReset.body.data.taskId as string;
  const pendingResetTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: resetTaskId }
  });
  assert.equal(pendingResetTask.status, "PENDING");
  assert.ok(
    pendingResetTask.secretCiphertext && pendingResetTask.secretIv && pendingResetTask.secretAuthTag
  );
  assert.equal(pendingResetTask.encryptionVersion, 2);
  await assert.rejects(
    prisma.messageTask.update({
      where: { id: resetTaskId },
      data: { status: "SENT", sentAt: new Date(), sentById: admin.id }
    })
  );
  const resetCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId }
  });
  assert.equal(resetCustomer.mustChangePassword, true);
  assert.ok(resetCustomer.temporaryPasswordExpiresAt);

  const renderedReset = await request(app)
    .get(`/api/v1/admin/message-tasks/${resetTaskId}/render`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminCookie);
  assert.equal(renderedReset.status, 200);
  assert.equal(renderedReset.headers["cache-control"], "no-store");
  assert.equal(renderedReset.body.data.message.includes("Geçici parolanız"), true);
  assert.equal(new URL(renderedReset.body.data.whatsappUrl).search, "");
  assert.equal(
    renderedReset.body.data.whatsappUrl.includes(renderedReset.body.data.message),
    false
  );
  const secretViewedAudit = await prisma.auditLog.findFirst({
    where: {
      actorUserId: admin.id,
      action: "message.secret_viewed",
      targetType: "MessageTask",
      targetId: resetTaskId,
      correlationId
    }
  });
  assert.ok(secretViewedAudit);
  assert.deepEqual(secretViewedAudit.metadata, {
    weddingId: wedding.id,
    kind: "PASSWORD_RESET"
  });
  const expectedUpdatedAt = renderedReset.body.data.expectedUpdatedAt as string;
  const markedSent = await request(app)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ expectedUpdatedAt });
  assert.equal(markedSent.status, 200);
  const sentResetTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: resetTaskId }
  });
  assert.equal(sentResetTask.status, "SENT");
  assert.equal(sentResetTask.secretCiphertext, null);
  assert.equal(sentResetTask.secretIv, null);
  assert.equal(sentResetTask.secretAuthTag, null);
  const replayedMarkSent = await request(app)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ expectedUpdatedAt });
  assert.equal(replayedMarkSent.status, 409);

  const auditLogs = await prisma.auditLog.findMany({ where: { correlationId } });
  const serializedLogs = JSON.stringify(auditLogs);
  assert.equal(serializedLogs.includes(driveUrl), false);
  assert.equal(serializedLogs.includes(temporaryPassword), false);
  assert.equal(serializedLogs.includes(firstApproval.username), false);
  assert.equal(serializedLogs.includes(applicationInput.bridePhone), false);
  assert.equal(serializedLogs.includes(applicationInput.primaryEmail), false);
  assert.equal(
    wedding.messageTasks.some((task) => task.secretCiphertext === temporaryPassword),
    false
  );

  const availabilityRes = await request(app).get(
    `/api/v1/venues/${venue.id}/availability?date=${weddingDate}`
  );
  assert.equal(availabilityRes.status, 200);
  assert.equal(availabilityRes.body.success, true);
  assert.ok(Array.isArray(availabilityRes.body.data.occupiedSlots));
});
