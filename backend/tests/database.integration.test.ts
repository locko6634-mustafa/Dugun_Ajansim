import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Prisma, type PrismaClient } from "@prisma/client";
import request from "supertest";
import type { Options as RateLimitOptions } from "express-rate-limit";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.config.js";
import { prisma, runWithRlsContext } from "../src/config/prisma.js";
import { CSRF_COOKIE_NAME } from "../src/middlewares/auth.middleware.js";
import {
  DatabaseRateLimitStore,
  hashRateLimitKey
} from "../src/middlewares/databaseRateLimitStore.js";
import { createPublicAvailabilityLimiter } from "../src/routes/public.routes.js";
import { assertSafeLocalTestDatabase } from "../src/scripts/testDatabaseGuard.js";
import {
  approveBookingApplication,
  createBookingApplication,
  expireStalePaymentFlows,
  getVenueAvailability,
  markWhatsappHandoff,
  rejectBookingApplication
} from "../src/services/booking.service.js";
import { synchronizeAutomaticDeliveryStatuses } from "../src/services/delivery-automation.service.js";
import {
  createOpaqueToken,
  decryptValue,
  encryptValue,
  hashPassword,
  hashToken,
  verifyPassword
} from "../src/utils/crypto.js";
import { addCalendarDays, deliveryEncryptionAad, getIstanbulDate } from "../src/utils/domain.js";
import { generateTotpCode, TOTP_PERIOD_SECONDS, totpEncryptionAad } from "../src/utils/totp.js";
import { TRUSTED_DEVICE_COOKIE_NAME } from "../src/utils/trustedDevice.js";
import {
  bookingFingerprintCryptography,
  serializeBookingFingerprintPayload
} from "../src/utils/booking-fingerprint.js";
import {
  decryptBookingApplicationPii,
  decryptMessageTaskPii,
  decryptWeddingPii,
  buildBookingApplicationPiiData,
  buildWeddingPiiData,
  piiCryptography,
  weddingWithDecryptedPii
} from "../src/utils/pii-crypto.js";
import { runDataRetentionBatch } from "../src/utils/dataRetention.js";

assertSafeLocalTestDatabase();

const PAYMENT_FLOW_SWEEP_ADVISORY_LOCK_KEY = 1_940_667_981;
const FORBIDDEN_BOOKING_RESPONSE_FIELDS = new Set([
  "idempotencyKey",
  "idempotencyFingerprint",
  "idempotencyFingerprintHmac",
  "idempotencyFingerprintKeyId",
  "idempotencyFingerprintVersion",
  "paymentFlowTokenHash"
]);

const assertOperationsWeddingContract = (wedding: Record<string, unknown>) => {
  for (const field of [
    "applicationId",
    "customerUserId",
    "primaryContact",
    "primaryEmail",
    "venueId",
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
  assert.ok(wedding.cancelledAt === null || typeof wedding.cancelledAt === "string");
  assert.ok(wedding.deletedAt === null || typeof wedding.deletedAt === "string");
  assert.deepEqual(Object.keys(wedding.packageSummary as object), ["name"]);
  assert.equal(typeof (wedding.packageSummary as { name: unknown }).name, "string");
  assertNoPiiPersistenceMetadata(wedding);
};

const assertBookingApplicationFingerprintMatches = async (applicationId: string) => {
  const application = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      venue: { select: { isPartner: true } },
      services: { select: { codeSnapshot: true }, orderBy: { codeSnapshot: "asc" } }
    }
  });
  assert.ok(application.idempotencyKey);
  const pii = decryptBookingApplicationPii(application.id, application);
  const canonicalPayload = serializeBookingFingerprintPayload({
    source: application.source,
    brideFirstName: pii.brideFirstName,
    brideLastName: pii.brideLastName,
    bridePhone: pii.bridePhone,
    groomFirstName: pii.groomFirstName,
    groomLastName: pii.groomLastName,
    groomPhone: pii.groomPhone,
    primaryContact: application.primaryContact,
    primaryEmail: pii.primaryEmail,
    startsAt: application.weddingStartsAt,
    endsAt: application.weddingEndsAt,
    venueId: application.venue?.isPartner ? application.venueId : null,
    customVenueName: application.venue?.isPartner ? null : pii.customVenueName,
    packageCode: application.packageCodeSnapshot,
    serviceCodes: application.services.map((service) => service.codeSnapshot),
    paymentMethod: application.paymentMethod,
    note: pii.note,
    privacyConsent: application.privacyConsentAt !== null,
    marketingConsent: application.marketingConsentAt !== null
  });
  assert.equal(bookingFingerprintCryptography.verify(canonicalPayload, application), true);
};

const assertNoPiiPersistenceMetadata = (value: unknown): void => {
  if (Array.isArray(value)) {
    value.forEach(assertNoPiiPersistenceMetadata);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    assert.equal(
      FORBIDDEN_BOOKING_RESPONSE_FIELDS.has(key),
      false,
      `API yanıtı dahili başvuru anahtarı sızdırmamalı: ${key}`
    );
    assert.equal(
      /^(pii(Ciphertext|Iv|AuthTag|KeyId|EncryptionVersion|SchemaVersion|Revision)|.*BlindIndex)$/.test(
        key
      ),
      false,
      `API yanıtı PII persistence alanını sızdırmamalı: ${key}`
    );
    assertNoPiiPersistenceMetadata(nestedValue);
  }
};

const assertSerializedRowOmitsPlaintext = (
  serialized: string,
  sentinels: readonly string[]
): void => {
  for (const sentinel of sentinels) {
    assert.equal(serialized.includes(sentinel), false, `DB satırı plaintext içeriyor: ${sentinel}`);
  }
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
  assert.equal(env.ADMIN_SESSION_IDLE_MINUTES, 240);
  assert.equal(env.SALON_SESSION_IDLE_MINUTES, 60);
  assert.equal(env.CUSTOMER_SESSION_IDLE_HOURS, 12);
  assert.equal(env.TEMPORARY_PASSWORD_TTL_HOURS, 24);
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
  assert.deepEqual(catalogResponse.body.data.botProtection, {
    provider: "turnstile",
    enabled: false,
    siteKey: null,
    action: "booking_application"
  });
});

test("RLS politikaları açık enforcement ve transaction-local sunucu bağlamıyla çalışır", async () => {
  const protectedTables = [
    "venues",
    "users",
    "auth_sessions",
    "password_setup_tokens",
    "packages",
    "services",
    "booking_applications",
    "booking_application_services",
    "weddings",
    "staff",
    "wedding_assignments",
    "deliveries",
    "delivery_status_history",
    "message_tasks",
    "audit_logs"
  ];
  const rlsTables = await prisma.$queryRaw<Array<{ tableName: string; enabled: boolean }>>`
    SELECT cls.relname AS "tableName", cls.relrowsecurity AS enabled
    FROM pg_catalog.pg_class AS cls
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = cls.relnamespace
    WHERE namespace.nspname = 'public'
      AND cls.relname IN (${Prisma.join(protectedTables)})
    ORDER BY cls.relname
  `;
  assert.equal(rlsTables.length, protectedTables.length);
  assert.equal(
    rlsTables.every(({ enabled }) => enabled),
    true
  );

  const [state] = await prisma.$queryRaw<Array<{ enabled: boolean }>>`
    SELECT enabled FROM public.rls_enforcement_state WHERE singleton
  `;
  assert.equal(state?.enabled, true);

  const [{ policyCount }] = await prisma.$queryRaw<Array<{ policyCount: bigint }>>`
    SELECT count(*)::bigint AS "policyCount"
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${protectedTables}::text[])
  `;
  assert.equal(Number(policyCount) >= protectedTables.length, true);

  const actorUserId = randomUUID();
  const venueId = randomUUID();
  const [observed] = await runWithRlsContext(
    {
      actorRole: "operations",
      actorUserId,
      venueId,
      purpose: "http.operations",
      resourceId: randomUUID()
    },
    () =>
      prisma.$transaction(
        (transaction) =>
          transaction.$queryRaw<
            Array<{ actorRole: string; actorUserId: string; venueId: string; purpose: string }>
          >`
          SELECT
            current_setting('app.actor_role', true) AS "actorRole",
            current_setting('app.actor_user_id', true) AS "actorUserId",
            current_setting('app.venue_id', true) AS "venueId",
            current_setting('app.purpose', true) AS purpose
        `
      )
  );
  assert.deepEqual(observed, {
    actorRole: "operations",
    actorUserId,
    venueId,
    purpose: "http.operations"
  });

  const [cleared] = await prisma.$transaction(
    (transaction) =>
      transaction.$queryRaw<Array<{ actorRole: string | null }>>`
      SELECT NULLIF(current_setting('app.actor_role', true), '') AS "actorRole"
    `
  );
  assert.equal(cleared?.actorRole, null);

  const [availability] = await runWithRlsContext(
    { actorRole: "public", purpose: "http.public" },
    () =>
      prisma.$queryRaw<Array<{ hasOccupancy: boolean }>>`
        SELECT public.public_venue_has_conflict(
          ${randomUUID()}::text,
          ${new Date("2026-08-20T10:00:00Z")},
          ${new Date("2026-08-20T12:00:00Z")},
          NULL::text,
          NULL::text
        ) AS "hasOccupancy"
      `
  );
  assert.equal(availability?.hasOccupancy, false);
  assert.deepEqual(Object.keys(availability ?? {}), ["hasOccupancy"]);
});

test("çekirdek PII zarf constraintleri doğrulanır ve eksik zarfı reddeder", async (context) => {
  const marker = `pii-constraint-${randomUUID()}`;
  const venue = await prisma.venue.create({
    data: { slug: marker, name: `PII Constraint ${marker}` }
  });
  const packageRecord = await prisma.package.create({
    data: { code: marker, name: `PII Constraint ${marker}`, priceCents: 100_000 }
  });
  let applicationId: string | undefined;
  context.after(async () => {
    if (applicationId) {
      await prisma.bookingApplication.deleteMany({ where: { id: applicationId } });
    }
    await prisma.package.deleteMany({ where: { id: packageRecord.id } });
    await prisma.venue.deleteMany({ where: { id: venue.id } });
  });
  const application = await createBookingApplication(
    {
      brideFirstName: "Ayşe",
      brideLastName: "Yılmaz",
      bridePhone: "05551234567",
      groomFirstName: "Mehmet",
      groomLastName: "Demir",
      groomPhone: "05559876543",
      primaryContact: "GELIN",
      primaryEmail: `${marker}@example.com`,
      weddingDate: addCalendarDays(getIstanbulDate(new Date()), 60),
      startTime: "19:00",
      endTime: "23:00",
      endsNextDay: false,
      venueId: venue.id,
      packageCode: packageRecord.code,
      serviceCodes: [],
      paymentMethod: "DEPOSIT",
      privacyConsent: true,
      marketingConsent: false
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: randomUUID(),
      paymentFlowKey: `${marker}-payment-flow-key`,
      correlationId: marker
    }
  );
  applicationId = application.id;

  const constraints = await prisma.$queryRaw<Array<{ constraintName: string; validated: boolean }>>`
    SELECT conname AS "constraintName", convalidated AS "validated"
    FROM pg_catalog.pg_constraint
    WHERE conname IN (
      'booking_applications_idempotency_fingerprint_check',
      'booking_applications_pii_envelope_check',
      'booking_applications_review_state_check',
      'weddings_pii_envelope_check',
      'message_tasks_pii_envelope_check',
      'staff_pii_envelope_check',
      'deliveries_drive_url_key_check'
    )
    ORDER BY conname
  `;
  assert.deepEqual(constraints, [
    { constraintName: "booking_applications_idempotency_fingerprint_check", validated: true },
    { constraintName: "booking_applications_pii_envelope_check", validated: true },
    { constraintName: "booking_applications_review_state_check", validated: true },
    { constraintName: "deliveries_drive_url_key_check", validated: true },
    { constraintName: "message_tasks_pii_envelope_check", validated: true },
    { constraintName: "staff_pii_envelope_check", validated: true },
    { constraintName: "weddings_pii_envelope_check", validated: true }
  ]);

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "piiIv" = NULL
      WHERE "id" = ${application.id}
    `
  );
  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "piiKeyId" = NULL
      WHERE "id" = ${application.id}
    `
  );
  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "primaryEmailBlindIndex" = NULL
      WHERE "id" = ${application.id}
    `
  );
  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "piiBlindIndexVersion" = NULL
      WHERE "id" = ${application.id}
    `
  );
  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "idempotencyFingerprintHmac" = NULL
      WHERE "id" = ${application.id}
    `
  );
  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "idempotencyFingerprintKeyId" = 'geçersiz anahtar'
      WHERE "id" = ${application.id}
    `
  );
  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "booking_applications"
      SET "idempotencyFingerprintVersion" = NULL
      WHERE "id" = ${application.id}
    `
  );

  await assert.rejects(
    prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        UPDATE "pii_enforcement_state"
        SET "enforced" = true, "enforcedAt" = clock_timestamp()
        WHERE "singleton" = true
      `;
      await transaction.$executeRaw`
        UPDATE "booking_applications"
        SET "primaryEmailBlindIndex" = NULL
        WHERE "id" = ${application.id}
      `;
    })
  );
  const [rolledBackState] = await prisma.$queryRaw<Array<{ enforced: boolean }>>`
    SELECT "enforced" FROM "pii_enforcement_state" WHERE "singleton" = true
  `;
  assert.equal(rolledBackState?.enforced, false);

  const blindMetadata = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: application.id },
    select: { piiBlindIndexKeyId: true, piiBlindIndexVersion: true }
  });
  await prisma.bookingApplication.update({
    where: { id: application.id },
    data: { piiBlindIndexKeyId: null, piiBlindIndexVersion: null }
  });
  await assert.rejects(
    prisma.$queryRaw`SELECT public.enable_data_encryption_enforcement()`,
    /BookingApplication/
  );
  await prisma.bookingApplication.update({
    where: { id: application.id },
    data: blindMetadata
  });

  const unchanged = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: application.id },
    select: { piiCiphertext: true, piiIv: true, piiAuthTag: true }
  });
  assert.ok(unchanged.piiCiphertext && unchanged.piiIv && unchanged.piiAuthTag);
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

  const sessionExpiresAt = new Date(now + 60_000);
  const sessionMfaVerifiedAt = new Date(now - 10_000);
  await assert.rejects(
    prisma.authSession.create({
      data: {
        tokenHash: hashToken(`${marker}-step-up-without-mfa`),
        csrfTokenHash: hashToken(`${marker}-step-up-without-mfa-csrf`),
        userId: user.id,
        expiresAt: sessionExpiresAt,
        adminStepUpVerifiedAt: new Date(now)
      }
    })
  );
  await assert.rejects(
    prisma.authSession.create({
      data: {
        tokenHash: hashToken(`${marker}-step-up-before-mfa`),
        csrfTokenHash: hashToken(`${marker}-step-up-before-mfa-csrf`),
        userId: user.id,
        expiresAt: sessionExpiresAt,
        mfaVerifiedAt: sessionMfaVerifiedAt,
        adminStepUpVerifiedAt: new Date(sessionMfaVerifiedAt.valueOf() - 1)
      }
    })
  );
  await assert.rejects(
    prisma.authSession.create({
      data: {
        tokenHash: hashToken(`${marker}-step-up-at-expiry`),
        csrfTokenHash: hashToken(`${marker}-step-up-at-expiry-csrf`),
        userId: user.id,
        expiresAt: sessionExpiresAt,
        mfaVerifiedAt: sessionMfaVerifiedAt,
        adminStepUpVerifiedAt: sessionExpiresAt
      }
    })
  );
  const validStepUpSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(`${marker}-valid-step-up`),
      csrfTokenHash: hashToken(`${marker}-valid-step-up-csrf`),
      userId: user.id,
      expiresAt: sessionExpiresAt,
      mfaVerifiedAt: sessionMfaVerifiedAt,
      adminStepUpVerifiedAt: new Date(now)
    }
  });
  assert.equal(validStepUpSession.adminStepUpVerifiedAt?.valueOf(), now);

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
  await prisma.rateLimitBucket.deleteMany();
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
    const applications = await prisma.bookingApplication.findMany({
      where: { packageCodeSnapshot: { contains: marker } },
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
    await prisma.auditLog.deleteMany({ where: { correlationId } });
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
    note: `PII notu ${marker}`,
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
  assert.equal(env.PII_ENCRYPTION_MODE, "encrypted");
  const storedApplication = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: firstApplication.id }
  });
  assert.equal(storedApplication.brideFirstName, null);
  assert.equal(storedApplication.bridePhone, null);
  assert.equal(storedApplication.primaryEmail, null);
  assert.equal(storedApplication.note, null);
  assert.ok(
    storedApplication.piiCiphertext &&
      storedApplication.piiIv &&
      storedApplication.piiAuthTag &&
      storedApplication.piiKeyId
  );
  const [rawApplication] = await prisma.$queryRaw<Array<{ serialized: string }>>`
    SELECT to_jsonb(application_row)::text AS "serialized"
    FROM "booking_applications" application_row
    WHERE "id" = ${firstApplication.id}
  `;
  assert.ok(rawApplication);
  assertSerializedRowOmitsPlaintext(rawApplication.serialized, [
    applicationInput.brideFirstName,
    applicationInput.brideLastName,
    "+905551234567",
    applicationInput.groomFirstName,
    applicationInput.groomLastName,
    "+905559876543",
    applicationInput.primaryEmail,
    applicationInput.note
  ]);
  const exactEmailApplication = await prisma.bookingApplication.findFirst({
    where: {
      deletedAt: null,
      primaryEmailBlindIndex: piiCryptography.blindIndex(
        "BookingApplication.primaryEmail",
        `  ${applicationInput.primaryEmail.toUpperCase()} `,
        "email"
      )
    },
    select: { id: true }
  });
  assert.equal(exactEmailApplication?.id, firstApplication.id);
  const exactBridePhoneApplication = await prisma.bookingApplication.findFirst({
    where: {
      deletedAt: null,
      bridePhoneBlindIndex: piiCryptography.blindIndex(
        "BookingApplication.bridePhone",
        "+90 (555) 123 45 67",
        "phone"
      )
    },
    select: { id: true }
  });
  assert.equal(exactBridePhoneApplication?.id, firstApplication.id);
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

  const competingDate = addCalendarDays(weddingDate, 30);
  const competingIdempotencyKeys = [`${marker}-slot-race-a`, `${marker}-slot-race-b`];
  const competingApplications = await Promise.allSettled(
    competingIdempotencyKeys.map((idempotencyKey, index) =>
      createBookingApplication(
        {
          ...applicationInput,
          weddingDate: competingDate,
          brideFirstName: `Yaris${index}`,
          primaryEmail: `slot-race-${index}-${marker}@example.com`
        },
        {
          source: "PUBLIC_FORM",
          idempotencyKey,
          paymentFlowKey: `${marker}-slot-race-${index}-flow-key-1234567890`,
          correlationId
        }
      )
    )
  );
  assert.equal(competingApplications.filter(({ status }) => status === "fulfilled").length, 1);
  const rejectedCompetingApplication = competingApplications.find(
    ({ status }) => status === "rejected"
  );
  assert.ok(rejectedCompetingApplication?.status === "rejected");
  assert.equal((rejectedCompetingApplication.reason as { statusCode?: number }).statusCode, 409);
  assert.equal(
    await prisma.bookingApplication.count({
      where: { idempotencyKey: { in: competingIdempotencyKeys } }
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

  // Aynı salon ve saat aralığında çakışan başvuru kararlı 409 sözleşmesiyle reddedilmelidir.
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
      (error as { statusCode: number }).statusCode === 409
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
  assert.match(firstApproval.decisionTaskId, /^[0-9a-f-]{36}$/i);
  assert.match(firstApproval.activationTaskId, /^[0-9a-f-]{36}$/i);
  assert.match(firstApproval.username, /^m-[a-f0-9]{32}$/);
  assert.match(secondApproval.username, /^m-[a-f0-9]{32}$/);
  assert.equal(firstApproval.username.toLocaleLowerCase("tr-TR").includes("yilmaz"), false);
  assert.equal(firstApproval.username.toLocaleLowerCase("tr-TR").includes("demir"), false);

  const wedding = await prisma.wedding.findUniqueOrThrow({
    where: { id: firstApproval.weddingId },
    include: { customerUser: true, delivery: true, messageTasks: true }
  });
  assert.ok(wedding.delivery);
  assert.equal(wedding.messageTasks.length, 2);
  assert.equal(
    wedding.messageTasks.find((task) => task.kind === "ACCOUNT_ACTIVATION")?.id,
    firstApproval.activationTaskId
  );
  assert.equal(wedding.brideFirstName, null);
  assert.equal(wedding.primaryEmail, null);
  const decryptedWeddingPii = decryptWeddingPii(wedding.id, wedding);
  assert.equal(decryptedWeddingPii.brideFirstName, applicationInput.brideFirstName);
  assert.equal(decryptedWeddingPii.primaryEmail, applicationInput.primaryEmail);
  const [rawWedding] = await prisma.$queryRaw<Array<{ serialized: string }>>`
    SELECT to_jsonb(wedding_row)::text AS "serialized"
    FROM "weddings" wedding_row
    WHERE "id" = ${wedding.id}
  `;
  assert.ok(rawWedding);
  assertSerializedRowOmitsPlaintext(rawWedding.serialized, [
    applicationInput.brideFirstName,
    applicationInput.brideLastName,
    "+905551234567",
    applicationInput.groomFirstName,
    applicationInput.groomLastName,
    "+905559876543",
    applicationInput.primaryEmail,
    applicationInput.note
  ]);
  const exactWedding = await prisma.wedding.findFirst({
    where: {
      deletedAt: null,
      primaryEmailBlindIndex: piiCryptography.blindIndex(
        "Wedding.primaryEmail",
        applicationInput.primaryEmail,
        "email"
      )
    },
    select: { id: true }
  });
  assert.equal(exactWedding?.id, wedding.id);
  const activationTask = wedding.messageTasks.find((task) => task.kind === "ACCOUNT_ACTIVATION");
  assert.ok(activationTask);
  const approvalDecisionTask = await prisma.messageTask.findUniqueOrThrow({
    where: {
      applicationId_kind: {
        applicationId: firstApplication.id,
        kind: "APPLICATION_APPROVED"
      }
    }
  });
  assert.equal(approvalDecisionTask.weddingId, null);
  assert.equal(approvalDecisionTask.applicationId, firstApplication.id);
  assert.ok(approvalDecisionTask.dueAt < activationTask.dueAt);
  assert.equal(
    decryptMessageTaskPii(approvalDecisionTask.id, approvalDecisionTask).recipientPhone,
    "+905551234567"
  );
  assert.equal(activationTask.secretCiphertext, null);
  assert.equal(activationTask.secretIv, null);
  assert.equal(activationTask.secretAuthTag, null);
  assert.equal(activationTask.recipientPhone, null);
  assert.equal(
    decryptMessageTaskPii(activationTask.id, activationTask).recipientPhone,
    "+905551234567"
  );
  const rawMessageTasks = await prisma.$queryRaw<Array<{ serialized: string }>>`
    SELECT to_jsonb(message_row)::text AS "serialized"
    FROM "message_tasks" message_row
    WHERE "weddingId" = ${wedding.id}
  `;
  assert.equal(rawMessageTasks.length, 2);
  rawMessageTasks.forEach((row) =>
    assertSerializedRowOmitsPlaintext(row.serialized, ["+905551234567"])
  );
  const exactMessageTask = await prisma.messageTask.findFirst({
    where: {
      weddingId: wedding.id,
      recipientPhoneBlindIndex: piiCryptography.blindIndex(
        "MessageTask.recipientPhone",
        "+90 (555) 123 45 67",
        "phone"
      )
    },
    select: { id: true }
  });
  assert.ok(exactMessageTask);
  assert.equal(activationTask.encryptionVersion, 2);
  assert.equal(wedding.delivery?.encryptionVersion, 2);
  assert.equal(wedding.customerUser.temporaryPasswordExpiresAt, null);
  assert.equal(wedding.customerUser.mustChangePassword, true);
  assert.ok(wedding.customerUser.activeAt);
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
  app.locals.deliveryLinkAccessVerifier = async () => ({ status: 200, redirectHost: null });
  const approvedPaymentFlowRead = await request(app)
    .get(`/api/v1/booking-applications/${firstApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", paymentFlowKey);
  assert.equal(approvedPaymentFlowRead.status, 404);
  const routePaymentFlowKey = `${marker}-route-payment-flow-key-1234567890`;
  const publicRouteApplication = await request(app)
    .post("/api/v1/booking-applications")
    .set("X-Correlation-ID", correlationId)
    .set("Idempotency-Key", randomUUID())
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
  assert.equal(restoredPaymentFlow.body.data.brideFirstName, "Route");
  assert.equal(restoredPaymentFlow.body.data.brideLastName, applicationInput.brideLastName);
  assert.equal(restoredPaymentFlow.body.data.bridePhone, "+905551234567");
  assert.equal(restoredPaymentFlow.body.data.groomFirstName, "Public");
  assert.equal(restoredPaymentFlow.body.data.groomPhone, "+905559876543");
  assert.equal(restoredPaymentFlow.body.data.primaryEmail, `route-${marker}@example.com`);
  assert.equal(restoredPaymentFlow.body.data.note, applicationInput.note);
  assertNoPiiPersistenceMetadata(restoredPaymentFlow.body.data);

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
  assert.equal(updatedPaymentFlow.body.data.note, "Ödeme akışı güncellendi");
  assertNoPiiPersistenceMetadata(updatedPaymentFlow.body.data);
  const storedUpdatedPaymentFlow = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: publicRouteApplicationId }
  });
  assert.equal(storedUpdatedPaymentFlow.note, null);
  const [rawUpdatedPaymentFlow] = await prisma.$queryRaw<Array<{ serialized: string }>>`
    SELECT to_jsonb(application_row)::text AS "serialized"
    FROM "booking_applications" application_row
    WHERE "id" = ${publicRouteApplicationId}
  `;
  assert.ok(rawUpdatedPaymentFlow);
  assertSerializedRowOmitsPlaintext(rawUpdatedPaymentFlow.serialized, [
    "Route",
    "Public",
    `route-${marker}@example.com`,
    "Ödeme akışı güncellendi"
  ]);

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
      bridePhone: "+90 (555) 444 33 22",
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
  const rejectedStoredApplication = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: rejectedFlowApplication.id }
  });
  assert.equal(rejectedStoredApplication.rejectionReason, null);
  assert.equal(
    decryptBookingApplicationPii(rejectedStoredApplication.id, rejectedStoredApplication)
      .rejectionReason,
    "Ödeme doğrulanamadı"
  );
  const rejectionAudit = await prisma.auditLog.findFirstOrThrow({
    where: {
      action: "booking.rejected",
      targetId: rejectedFlowApplication.id,
      correlationId
    },
    orderBy: { createdAt: "desc" }
  });
  assert.equal(JSON.stringify(rejectionAudit.metadata).includes("Ödeme doğrulanamadı"), false);
  const rejectionDecisionTask = await prisma.messageTask.findUniqueOrThrow({
    where: {
      applicationId_kind: {
        applicationId: rejectedFlowApplication.id,
        kind: "APPLICATION_REJECTED"
      }
    }
  });
  assert.equal(rejectionDecisionTask.weddingId, null);
  assert.equal(
    decryptMessageTaskPii(rejectionDecisionTask.id, rejectionDecisionTask).recipientPhone,
    "+905554443322"
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
  const invalidKeyUpdate = await request(app)
    .patch(`/api/v1/booking-applications/${publicRouteApplicationId}/payment-flow`)
    .set("Payment-Flow-Key", `${marker}-invalid-update-key-1234567890`)
    .send(applicationInput);
  assert.equal(invalidKeyUpdate.status, 404);
  assert.equal(await prisma.bookingApplication.count({ where: { id: expiringApplication.id } }), 1);
  const invalidKeyHandoff = await request(app)
    .post(`/api/v1/booking-applications/${publicRouteApplicationId}/whatsapp-handoff`)
    .set("Payment-Flow-Key", `${marker}-invalid-handoff-key-1234567890`)
    .send({});
  assert.equal(invalidKeyHandoff.status, 404);
  assert.equal(await prisma.bookingApplication.count({ where: { id: expiringApplication.id } }), 1);
  const invalidKeyRead = await request(app)
    .get(`/api/v1/booking-applications/${publicRouteApplicationId}/payment-flow`)
    .set("Payment-Flow-Key", `${marker}-invalid-sweep-key-1234567890`);
  assert.equal(invalidKeyRead.status, 404);
  assert.equal(await prisma.bookingApplication.count({ where: { id: expiringApplication.id } }), 1);
  const missingApplicationRead = await request(app)
    .get("/api/v1/booking-applications/00000000-0000-4000-8000-000000000000/payment-flow")
    .set("Payment-Flow-Key", expiringFlowKey);
  assert.equal(missingApplicationRead.status, 404);
  assert.equal(await prisma.bookingApplication.count({ where: { id: expiringApplication.id } }), 1);
  const expiringSweep = await expireStalePaymentFlows(new Date(), correlationId);
  assert.equal(expiringSweep.archivedAbandonedCount, 1);
  assert.equal(expiringSweep.physicalDeletedCount, 0);
  const expiredApplication = await prisma.bookingApplication.findUnique({
    where: { id: expiringApplication.id }
  });
  assert.ok(expiredApplication);
  assert.equal(expiredApplication.status, "IPTAL_EDILDI");
  assert.ok(expiredApplication.deletedAt);
  assert.ok(expiredApplication.paymentFlowExpiredAt);
  assert.equal(expiredApplication.paymentFlowTokenHash, null);
  const expiredAvailability = await getVenueAvailability(venue.id, expiringDate);
  assert.equal(
    expiredAvailability.occupiedSlots.some(
      (slot) => slot.startTime === "10:00" && slot.endTime === "12:00"
    ),
    false
  );
  const expiredApplicationAudits = await prisma.auditLog.findMany({
    where: { targetType: "BookingApplication", targetId: expiringApplication.id },
    select: { action: true, metadata: true },
    orderBy: { createdAt: "asc" }
  });
  assert.deepEqual(
    expiredApplicationAudits.map((entry) => entry.action),
    ["booking.created", "booking.payment_flow_expired"]
  );
  const expiryAuditMetadata = expiredApplicationAudits.at(-1)?.metadata as {
    expiredAt?: string;
    reason?: string;
    physicalDelete?: boolean;
  } | null;
  assert.equal(expiryAuditMetadata?.reason, "no_handoff_or_payment_evidence_before_deadline");
  assert.equal(expiryAuditMetadata?.physicalDelete, false);
  assert.ok(expiryAuditMetadata?.expiredAt);
  assert.equal(
    JSON.stringify(expiredApplicationAudits).includes(`expiring-${marker}@example.com`),
    false
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
  assert.equal(await prisma.venue.count({ where: { name: customVenueName } }), 0);
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
  assert.equal(await prisma.venue.count({ where: { name: customVenueName } }), 0);
  assert.equal(await prisma.venue.count({ where: { name: updatedCustomVenueName } }), 0);
  await prisma.bookingApplication.update({
    where: { id: customVenueApplication.id },
    data: { paymentFlowExpiresAt: new Date(Date.now() - 1_000) }
  });

  const customVenueSweep = await expireStalePaymentFlows(new Date(), correlationId);
  assert.equal(customVenueSweep.archivedAbandonedCount, 1);
  assert.equal(customVenueSweep.physicalDeletedCount, 0);
  assert.equal(
    await prisma.bookingApplication.count({ where: { id: customVenueApplication.id } }),
    1
  );
  assert.equal(await prisma.venue.count({ where: { name: updatedCustomVenueName } }), 0);
  assert.deepEqual(
    (
      await prisma.auditLog.findMany({
        where: { targetType: "BookingApplication", targetId: customVenueApplication.id },
        select: { action: true },
        orderBy: { createdAt: "asc" }
      })
    ).map((entry) => entry.action),
    ["booking.created", "booking.payment_flow_updated", "booking.payment_flow_expired"]
  );

  const overflowVenue = await prisma.venue.create({
    data: {
      name: `Toplu Temizlik Salonu ${marker}`,
      slug: `${marker}-bulk-expiry`,
      isPartner: false
    }
  });
  secondaryVenueIds.push(overflowVenue.id);
  const overflowApplicationIds = Array.from({ length: 101 }, () => randomUUID());
  await prisma.bookingApplication.createMany({
    data: overflowApplicationIds.map((id, index) => ({
      id,
      referenceCode: `EXP-${marker}-${index}`,
      source: "PUBLIC_FORM",
      status: "ONAY_BEKLIYOR",
      brideFirstName: "Toplu",
      brideLastName: "Temizlik",
      bridePhone: "05550000001",
      groomFirstName: "Güvenlik",
      groomLastName: "Testi",
      groomPhone: "05550000002",
      primaryContact: "GELIN",
      primaryEmail: `bulk-expiry-${index}-${marker}@example.com`,
      weddingStartsAt: new Date(Date.now() + (index + 60) * 86_400_000),
      weddingEndsAt: new Date(Date.now() + (index + 60) * 86_400_000 + 7_200_000),
      venueId: overflowVenue.id,
      packageId: packageRecord.id,
      packageCodeSnapshot: packageRecord.code,
      packageNameSnapshot: packageRecord.name,
      packagePriceCents: packageRecord.priceCents,
      totalPriceCents: packageRecord.priceCents,
      paymentMethod: "CASH",
      payableNowCents: packageRecord.priceCents,
      paymentFlowTokenHash: hashToken(`${marker}-bulk-expiry-${index}`),
      paymentFlowExpiresAt: new Date(Date.now() - 1_000),
      privacyConsentAt: new Date()
    }))
  });
  await prisma.auditLog.createMany({
    data: overflowApplicationIds.map((id) => ({
      action: "booking.created",
      targetType: "BookingApplication",
      targetId: id,
      correlationId
    }))
  });

  const firstBulkSweep = await expireStalePaymentFlows(new Date(), correlationId);
  assert.equal(firstBulkSweep.archivedAbandonedCount, 100);
  assert.equal(firstBulkSweep.retainedCount, 100);
  assert.equal(firstBulkSweep.physicalDeletedCount, 0);
  assert.equal(
    await prisma.bookingApplication.count({ where: { id: { in: overflowApplicationIds } } }),
    101
  );
  assert.equal(await prisma.venue.count({ where: { id: overflowVenue.id } }), 1);
  assert.equal(
    await prisma.auditLog.count({
      where: {
        targetType: "BookingApplication",
        targetId: { in: overflowApplicationIds },
        action: "booking.created"
      }
    }),
    101
  );
  assert.equal(
    await prisma.auditLog.count({
      where: {
        targetType: "BookingApplication",
        targetId: { in: overflowApplicationIds },
        action: "booking.payment_flow_expired"
      }
    }),
    100
  );
  const secondBulkSweep = await expireStalePaymentFlows(new Date(), correlationId);
  assert.equal(secondBulkSweep.archivedAbandonedCount, 1);
  assert.equal(secondBulkSweep.physicalDeletedCount, 0);
  assert.equal(
    await prisma.bookingApplication.count({ where: { id: { in: overflowApplicationIds } } }),
    101
  );
  assert.equal(await prisma.venue.count({ where: { id: overflowVenue.id } }), 1);
  assert.equal(
    await prisma.auditLog.count({
      where: {
        targetType: "BookingApplication",
        targetId: { in: overflowApplicationIds },
        action: "booking.payment_flow_expired"
      }
    }),
    101
  );

  const advisoryLockApplicationId = randomUUID();
  await prisma.bookingApplication.create({
    data: {
      id: advisoryLockApplicationId,
      referenceCode: `LOCK-${marker}`,
      source: "PUBLIC_FORM",
      status: "ONAY_BEKLIYOR",
      brideFirstName: "Advisory",
      brideLastName: "Lock",
      bridePhone: "05550000003",
      groomFirstName: "Bounded",
      groomLastName: "Sweep",
      groomPhone: "05550000004",
      primaryContact: "GELIN",
      primaryEmail: `advisory-lock-${marker}@example.com`,
      weddingStartsAt: new Date(Date.now() + 200 * 86_400_000),
      weddingEndsAt: new Date(Date.now() + 200 * 86_400_000 + 7_200_000),
      venueId: venue.id,
      packageId: packageRecord.id,
      packageCodeSnapshot: packageRecord.code,
      packageNameSnapshot: packageRecord.name,
      packagePriceCents: packageRecord.priceCents,
      totalPriceCents: packageRecord.priceCents,
      paymentMethod: "CASH",
      payableNowCents: packageRecord.priceCents,
      paymentFlowTokenHash: hashToken(`${marker}-advisory-lock-flow-key`),
      paymentFlowExpiresAt: new Date(Date.now() - 1_000),
      privacyConsentAt: new Date()
    }
  });
  let notifyLockAcquired: (() => void) | undefined;
  let releaseAdvisoryLock: (() => void) | undefined;
  const advisoryLockAcquired = new Promise<void>((resolve) => {
    notifyLockAcquired = resolve;
  });
  const advisoryLockRelease = new Promise<void>((resolve) => {
    releaseAdvisoryLock = resolve;
  });
  const heldAdvisoryLock = prisma.$transaction(
    async (transaction) => {
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(
          ${PAYMENT_FLOW_SWEEP_ADVISORY_LOCK_KEY}::bigint
        )::text AS "lock"
      `;
      notifyLockAcquired?.();
      await advisoryLockRelease;
    },
    { timeout: 10_000 }
  );
  await advisoryLockAcquired;
  try {
    const lockedSweep = await expireStalePaymentFlows(new Date(), correlationId);
    assert.equal(lockedSweep.selectedCount, 0);
    assert.equal(
      await prisma.bookingApplication.count({ where: { id: advisoryLockApplicationId } }),
      1
    );
  } finally {
    releaseAdvisoryLock?.();
    await heldAdvisoryLock;
  }
  const unlockedSweep = await expireStalePaymentFlows(new Date(), correlationId);
  assert.equal(unlockedSweep.archivedAbandonedCount, 1);
  assert.equal(unlockedSweep.physicalDeletedCount, 0);
  assert.equal(
    await prisma.bookingApplication.count({ where: { id: advisoryLockApplicationId } }),
    1
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
  const handedOffExpiredAvailability = await getVenueAvailability(venue.id, handedOffExpiringDate);
  assert.equal(
    handedOffExpiredAvailability.occupiedSlots.some(
      (slot) => slot.startTime === "13:00" && slot.endTime === "15:00"
    ),
    true
  );
  await assert.rejects(
    createBookingApplication(
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
    ),
    (error: unknown) =>
      error instanceof Error &&
      "statusCode" in error &&
      (error as { statusCode: number }).statusCode === 409
  );
  const handedOffSweep = await expireStalePaymentFlows(new Date(), correlationId);
  assert.equal(handedOffSweep.preservedEvidenceCount, 1);
  assert.equal(handedOffSweep.publicAccessClosedCount, 1);
  assert.equal(handedOffSweep.physicalDeletedCount, 0);
  const expiredHandedOffApplication = await prisma.bookingApplication.findUnique({
    where: { id: handedOffExpiringApplication.id }
  });
  assert.ok(expiredHandedOffApplication);
  assert.equal(expiredHandedOffApplication.status, "ONAY_BEKLIYOR");
  assert.equal(expiredHandedOffApplication.deletedAt, null);
  assert.equal(expiredHandedOffApplication.paymentFlowTokenHash, null);
  assert.deepEqual(
    (
      await prisma.auditLog.findMany({
        where: {
          targetId: handedOffExpiringApplication.id,
          targetType: "BookingApplication"
        },
        select: { action: true },
        orderBy: { createdAt: "asc" }
      })
    ).map((entry) => entry.action),
    ["booking.created", "booking.whatsapp_handoff_started", "booking.payment_flow_access_closed"]
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
  const approvalAfterHandoffExpiry = await approveBookingApplication(
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
  );
  assert.equal(approvalExpiryWasForced, true);
  assert.equal(approvalAfterHandoffExpiry.applicationId, approvalExpiryRaceApplication.id);
  assert.equal(
    await prisma.wedding.count({ where: { applicationId: approvalExpiryRaceApplication.id } }),
    1
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

  const activationAdminToken = `${marker}-activation-admin-token`;
  const activationAdminCsrf = `${marker}-activation-admin-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(activationAdminToken),
      csrfTokenHash: hashToken(activationAdminCsrf),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      mfaVerifiedAt: new Date(),
      adminStepUpVerifiedAt: new Date()
    }
  });
  const activationAdminCookie = `${env.SESSION_COOKIE_NAME}=${activationAdminToken}; ${CSRF_COOKIE_NAME}=${activationAdminCsrf}`;

  const preparedApprovalDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${approvalDecisionTask.id}/render`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(preparedApprovalDecision.status, 200);
  const verifiedApprovalDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${approvalDecisionTask.id}/verify`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(verifiedApprovalDecision.status, 200);
  assert.equal(
    String(verifiedApprovalDecision.body.data.message).includes(firstApplication.referenceCode),
    true
  );
  assert.equal(
    String(verifiedApprovalDecision.body.data.message).includes(
      rejectedFlowApplication.referenceCode
    ),
    false
  );

  const preparedRejectionDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${rejectionDecisionTask.id}/render`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(preparedRejectionDecision.status, 200);
  const verifiedRejectionDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${rejectionDecisionTask.id}/verify`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(verifiedRejectionDecision.status, 200);
  assert.equal(
    String(verifiedRejectionDecision.body.data.message).includes(
      rejectedFlowApplication.referenceCode
    ),
    true
  );
  assert.equal(
    String(verifiedRejectionDecision.body.data.message).includes("Ödeme doğrulanamadı"),
    false
  );
  const failedRejectionDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${rejectionDecisionTask.id}/mark-failed`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({
      expectedUpdatedAt: verifiedRejectionDecision.body.data.expectedUpdatedAt,
      reason: "Sentetik WhatsApp gönderim hatası"
    });
  assert.equal(failedRejectionDecision.status, 200);
  assert.equal(failedRejectionDecision.body.data.status, "FAILED");
  const earlyRetry = await request(app)
    .post(`/api/v1/admin/message-tasks/${rejectionDecisionTask.id}/render`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(earlyRetry.status, 409);
  await prisma.messageTask.update({
    where: { id: rejectionDecisionTask.id },
    data: { nextAttemptAt: new Date(Date.now() - 1_000) }
  });
  const retriedRejectionDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${rejectionDecisionTask.id}/render`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(retriedRejectionDecision.status, 200);
  const cancelledRejectionDecision = await request(app)
    .post(`/api/v1/admin/message-tasks/${rejectionDecisionTask.id}/cancel`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({ reason: "Sentetik retry görevi güvenli iptal testi" });
  assert.equal(cancelledRejectionDecision.status, 200);
  assert.equal(cancelledRejectionDecision.body.data.status, "CANCELLED");

  const preparedActivation = await request(app)
    .post(`/api/v1/admin/message-tasks/${activationTask.id}/render`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(preparedActivation.status, 200);
  assert.equal(preparedActivation.body.data.status, "PREPARED");
  const earlyActivationVerification = await request(app)
    .post(`/api/v1/admin/message-tasks/${activationTask.id}/verify`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(earlyActivationVerification.status, 409);
  const activationOverride = await request(app)
    .post(`/api/v1/admin/message-tasks/${activationTask.id}/override-due`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({ reason: "Sentetik erken aktivasyon kabul testi" });
  assert.equal(activationOverride.status, 200);
  const verifiedActivation = await request(app)
    .post(`/api/v1/admin/message-tasks/${activationTask.id}/verify`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({});
  assert.equal(verifiedActivation.status, 200);
  assert.equal(verifiedActivation.body.data.status, "READY_TO_SEND");
  assert.equal(verifiedActivation.body.data.customerActivatedEarly, false);
  const activationSetupToken = String(verifiedActivation.body.data.message).match(
    /#setup=([A-Za-z0-9_-]{43})&purpose=ACCOUNT_ACTIVATION/
  )?.[1];
  assert.ok(activationSetupToken);
  const initialCustomerPassword = "ilk-kurulum-icin-kalici-guvenli-parola";
  const wrongPurposeSetup = await request(app).post("/api/v1/auth/password/setup").send({
    token: activationSetupToken,
    purpose: "PASSWORD_RESET",
    newPassword: initialCustomerPassword
  });
  assert.equal(wrongPurposeSetup.status, 410);
  const openedEarlyActivation = await request(app)
    .post(`/api/v1/admin/message-tasks/${activationTask.id}/verify`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({ activateCustomerNow: true });
  assert.equal(openedEarlyActivation.status, 200);
  assert.equal(openedEarlyActivation.body.data.customerActivatedEarly, true);
  const earlyActivatedCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId },
    select: { activeAt: true }
  });
  assert.ok(earlyActivatedCustomer.activeAt);
  assert.ok(earlyActivatedCustomer.activeAt <= new Date());
  const markedActivationSent = await request(app)
    .post(`/api/v1/admin/message-tasks/${activationTask.id}/mark-sent`)
    .set("Cookie", activationAdminCookie)
    .set("X-CSRF-Token", activationAdminCsrf)
    .send({ expectedUpdatedAt: openedEarlyActivation.body.data.expectedUpdatedAt });
  assert.equal(markedActivationSent.status, 200);
  const passwordSetup = await request(app)
    .post("/api/v1/auth/password/setup")
    .set("X-Correlation-ID", correlationId)
    .send({
      token: activationSetupToken,
      purpose: "ACCOUNT_ACTIVATION",
      newPassword: initialCustomerPassword
    });
  assert.equal(passwordSetup.status, 200);
  assert.equal(passwordSetup.body.data.username, wedding.customerUser.username);
  const replayedPasswordSetup = await request(app).post("/api/v1/auth/password/setup").send({
    token: activationSetupToken,
    purpose: "ACCOUNT_ACTIVATION",
    newPassword: "yeniden-kullanilamayacak-guvenli-parola"
  });
  assert.equal(replayedPasswordSetup.status, 410);
  const expiredSetupToken = createOpaqueToken();
  await prisma.passwordSetupToken.create({
    data: {
      tokenHash: hashToken(expiredSetupToken),
      userId: wedding.customerUserId,
      purpose: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() - 60_000),
      createdById: admin.id
    }
  });
  const expiredPasswordSetup = await request(app).post("/api/v1/auth/password/setup").send({
    token: expiredSetupToken,
    purpose: "PASSWORD_RESET",
    newPassword: "suresi-dolmus-link-icin-guvenli-parola"
  });
  assert.equal(expiredPasswordSetup.status, 410);

  const login = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Correlation-ID", correlationId)
    .send({
      username: wedding.customerUser.username,
      password: initialCustomerPassword,
      remember: true
    });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.mustChangePassword, false);
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
  assert.equal(forcedPasswordChange.status, 200);

  const passwordHashBeforeCsrfFailure = (
    await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })
  ).passwordHash;
  const csrfRejectedPasswordChange = await request(app)
    .post("/api/v1/auth/password/change")
    .set("Cookie", `${customerCookie}; ${customerCsrfCookie}`)
    .send({
      currentPassword: initialCustomerPassword,
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
      currentPassword: initialCustomerPassword,
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

  const completedActivationTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: activationTask.id }
  });
  assert.equal(completedActivationTask.status, "SENT");
  assert.equal(completedActivationTask.secretCiphertext, null);
  assert.equal(completedActivationTask.secretIv, null);
  assert.equal(completedActivationTask.secretAuthTag, null);
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
  const foreignDashboard = await request(app)
    .get(`/api/v1/customer/dashboard?weddingId=${secondApproval.weddingId}`)
    .set("Cookie", customerCookie);
  assert.equal(foreignDashboard.status, 404);
  const ownDashboard = await request(app)
    .get(`/api/v1/customer/dashboard?weddingId=${wedding.id}`)
    .set("Cookie", customerCookie);
  assert.equal(ownDashboard.status, 200);
  assert.equal(ownDashboard.body.data.couple.bride, "Ayşe Yılmaz");
  assertNoPiiPersistenceMetadata(ownDashboard.body.data);
  const adminToken = `${marker}-admin-session-token`;
  const adminCsrfToken = `${marker}-admin-csrf`;
  const adminMfaVerifiedAt = new Date(Date.now() - 1_000);
  const adminSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(adminToken),
      csrfTokenHash: hashToken(adminCsrfToken),
      userId: admin.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      mfaVerifiedAt: adminMfaVerifiedAt,
      adminStepUpVerifiedAt: new Date()
    }
  });
  await prisma.rateLimitBucket.deleteMany();
  const adminCookie = `${env.SESSION_COOKIE_NAME}=${adminToken}`;
  const adminAuthCookie = `${adminCookie}; ${CSRF_COOKIE_NAME}=${adminCsrfToken}`;
  const lifecycleApp = createApp();
  const cancellationAttempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(lifecycleApp)
        .post(`/api/v1/admin/weddings/${wedding.id}/cancel`)
        .set("X-Correlation-ID", correlationId)
        .set("Cookie", adminAuthCookie)
        .set("X-CSRF-Token", adminCsrfToken)
        .send({ reason: "Entegrasyon iptal yaşam döngüsü doğrulaması." })
    )
  );
  assert.deepEqual(cancellationAttempts.map((response) => response.status).sort(), [200, 409]);
  const cancelledWeddingDashboard = await request(lifecycleApp)
    .get("/api/v1/customer/dashboard")
    .set("Cookie", customerCookie);
  assert.equal(cancelledWeddingDashboard.status, 404);
  const reinstatementAttempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(lifecycleApp)
        .post(`/api/v1/admin/weddings/${wedding.id}/reinstate`)
        .set("X-Correlation-ID", correlationId)
        .set("Cookie", adminAuthCookie)
        .set("X-CSRF-Token", adminCsrfToken)
        .send({ reason: "Entegrasyon iptalini kontrollü biçimde geri alma." })
    )
  );
  assert.deepEqual(reinstatementAttempts.map((response) => response.status).sort(), [200, 409]);
  assert.equal(
    (await prisma.bookingApplication.findUniqueOrThrow({ where: { id: wedding.applicationId } }))
      .status,
    "ONAYLANDI"
  );
  const anonymousCatalogConstraints = await request(app).get(
    "/api/v1/admin/catalog-form-constraints"
  );
  assert.equal(anonymousCatalogConstraints.status, 401);
  const catalogConstraints = await request(app)
    .get("/api/v1/admin/catalog-form-constraints")
    .set("Cookie", adminCookie);
  assert.equal(catalogConstraints.status, 200);
  assert.deepEqual(catalogConstraints.body.data.priceCents, {
    minimum: 0,
    maximum: 100_000_000,
    step: 1
  });
  assert.equal(catalogConstraints.body.data.description.maxLength, 2_000);
  assert.equal(catalogConstraints.body.data.venue.displayOrder.maximum, 10_000);
  const postHandoffArchive = await request(lifecycleApp)
    .post(`/api/v1/admin/booking-applications/${publicRouteApplicationId}/archive`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(postHandoffArchive.status, 200);
  const postHandoffRestore = await request(lifecycleApp)
    .post(`/api/v1/admin/booking-applications/${publicRouteApplicationId}/restore`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(postHandoffRestore.status, 200);
  const postHandoffApproval = await request(lifecycleApp)
    .post(`/api/v1/admin/booking-applications/${publicRouteApplicationId}/approve`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(postHandoffApproval.status, 200);

  const customRestoreKey = `${marker}-custom-restore-key-1234567890`;
  const customRestoreApplication = await createBookingApplication(
    {
      ...applicationInput,
      venueId: undefined,
      customVenueName: `Restore Özel Salon ${marker}`,
      weddingDate: addCalendarDays(weddingDate, 12),
      primaryEmail: `custom-restore-${marker}@example.com`
    },
    {
      source: "PUBLIC_FORM",
      idempotencyKey: `${marker}-custom-restore`,
      paymentFlowKey: customRestoreKey,
      correlationId
    }
  );
  const customArchived = await request(lifecycleApp)
    .post(`/api/v1/admin/booking-applications/${customRestoreApplication.id}/archive`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(customArchived.status, 200);
  const customRestored = await request(lifecycleApp)
    .post(`/api/v1/admin/booking-applications/${customRestoreApplication.id}/restore`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(customRestored.status, 200);
  assert.equal(customRestored.body.data.venueId, null);
  const customRestoredFlow = await request(lifecycleApp)
    .get(`/api/v1/booking-applications/${customRestoreApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", customRestoreKey);
  assert.equal(customRestoredFlow.status, 200);

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
  const archivedFlowAttempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(app)
        .post(`/api/v1/admin/booking-applications/${archivedFlowApplication.id}/archive`)
        .set("X-Correlation-ID", correlationId)
        .set("Cookie", adminAuthCookie)
        .set("X-CSRF-Token", adminCsrfToken)
        .send({})
    )
  );
  assert.deepEqual(archivedFlowAttempts.map((response) => response.status).sort(), [200, 409]);
  const archivedFlow = archivedFlowAttempts.find((response) => response.status === 200)!;
  assertNoPiiPersistenceMetadata(archivedFlow.body.data);
  const archivedPaymentFlowRead = await request(app)
    .get(`/api/v1/booking-applications/${archivedFlowApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", archivedFlowKey);
  assert.equal(archivedPaymentFlowRead.status, 404);
  assert.ok(
    (
      await prisma.bookingApplication.findUniqueOrThrow({
        where: { id: archivedFlowApplication.id },
        select: { paymentFlowTokenHash: true }
      })
    ).paymentFlowTokenHash
  );
  const restoreFlowAttempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(app)
        .post(`/api/v1/admin/booking-applications/${archivedFlowApplication.id}/restore`)
        .set("X-Correlation-ID", correlationId)
        .set("Cookie", adminAuthCookie)
        .set("X-CSRF-Token", adminCsrfToken)
        .send({})
    )
  );
  assert.deepEqual(restoreFlowAttempts.map((response) => response.status).sort(), [200, 409]);
  const resumedArchivedFlow = await request(app)
    .get(`/api/v1/booking-applications/${archivedFlowApplication.id}/payment-flow`)
    .set("Payment-Flow-Key", archivedFlowKey);
  assert.equal(resumedArchivedFlow.status, 200);
  const adminForbidden = await request(app)
    .get("/api/v1/customer/dashboard")
    .set("Cookie", adminCookie);
  assert.equal(adminForbidden.status, 403);
  const applicationLookup = await request(app)
    .get(
      `/api/v1/admin/booking-applications?referenceCode=${firstApplication.referenceCode}&pageSize=1`
    )
    .set("Cookie", adminCookie);
  assert.equal(applicationLookup.status, 200);
  assert.equal(applicationLookup.body.data.items.length, 1);
  assert.equal(applicationLookup.body.data.items[0].id, firstApplication.id);
  assert.equal("idempotencyKey" in applicationLookup.body.data.items[0], false);
  assert.equal("idempotencyFingerprint" in applicationLookup.body.data.items[0], false);
  assert.equal(applicationLookup.body.data.pagination.pageSize, 1);
  assertNoPiiPersistenceMetadata(applicationLookup.body.data.items);
  const invalidApplicationCursor = await request(app)
    .get("/api/v1/admin/booking-applications?cursor=gecersiz-imlec-degeri-123456")
    .set("Cookie", adminCookie);
  assert.equal(invalidApplicationCursor.status, 400);
  const applicationDetail = await request(app)
    .get(`/api/v1/admin/booking-applications/${firstApplication.id}`)
    .set("Cookie", adminCookie);
  assert.equal(applicationDetail.status, 200);
  assert.equal("idempotencyKey" in applicationDetail.body.data, false);
  assert.equal("idempotencyFingerprint" in applicationDetail.body.data, false);
  assertNoPiiPersistenceMetadata(applicationDetail.body.data);

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
  assertNoPiiPersistenceMetadata(successfulRestore.body.data);

  const secondWeddingBeforeCredentialRotationRow = await prisma.wedding.findUniqueOrThrow({
    where: { id: secondApproval.weddingId },
    include: { customerUser: true }
  });
  const secondWeddingBeforeCredentialRotation = weddingWithDecryptedPii(
    secondWeddingBeforeCredentialRotationRow
  );
  const secondPasswordReset = await request(app)
    .post(
      `/api/v1/admin/customers/${secondWeddingBeforeCredentialRotation.customerUserId}/reset-password`
    )
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      confirmText: secondWeddingBeforeCredentialRotation.customerUser.username,
      reason: "Müşteri parola erişimini kaybetti."
    });
  assert.equal(secondPasswordReset.status, 200);
  assert.equal(secondPasswordReset.body.data.status, "PLANNED");
  assert.equal(typeof secondPasswordReset.body.data.taskId, "string");
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
  assert.equal(renewedSecondActivation.status, "PLANNED");
  assert.equal(renewedSecondActivation.secretCiphertext, null);
  assert.equal(renewedSecondActivation.secretIv, null);
  assert.equal(renewedSecondActivation.secretAuthTag, null);

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
  const duplicateActiveStaff = await request(app)
    .post("/api/v1/admin/staff")
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      firstName: "Tekrar",
      lastName: "Telefon",
      phone: "0 (555) 111 22 33",
      venueId: venue.id,
      specialties: ["VIDEO"],
      isActive: true
    });
  assert.equal(duplicateActiveStaff.status, 409);

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
    venueOperationsWeddings.body.data.items.some(
      (operationsWedding: { id: string }) => operationsWedding.id === wedding.id
    )
  );
  for (const operationsWedding of venueOperationsWeddings.body.data.items) {
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
  assert.equal(applicationAfterOperationsUpdate.note, null);
  assert.equal(
    decryptWeddingPii(
      wedding.id,
      await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id } })
    ).note,
    "Salon sorumlusu operasyon notu"
  );
  await assertBookingApplicationFingerprintMatches(wedding.applicationId);
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

  const assignmentRaceApp = createApp();
  const assignmentAttempts = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(assignmentRaceApp)
        .post(`/api/v1/operations/weddings/${wedding.id}/assignments`)
        .set("X-Correlation-ID", correlationId)
        .set("Cookie", managerAuthCookie)
        .set("X-CSRF-Token", managerCsrfToken)
        .send({ staffId: createdStaff.body.data.id, specialty: "PHOTOGRAPHY" })
    )
  );
  assert.deepEqual(assignmentAttempts.map((response) => response.status).sort(), [201, 409]);

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
  const expectedVenueCalendarWeddingCount =
    2 +
    Number(approvalExpiryRaceDate.slice(0, 7) === weddingDate.slice(0, 7)) +
    Number(addCalendarDays(weddingDate, 4).slice(0, 7) === weddingDate.slice(0, 7));
  assert.equal(venueCalendar.body.data.weddings.length, expectedVenueCalendarWeddingCount);
  assert.equal(
    venueCalendar.body.data.weddings.every(
      (calendarWedding: { venue: { name: string } }) => calendarWedding.venue.name === venue.name
    ),
    true
  );

  const allVenuesCalendar = await request(app)
    .get(`/api/v1/admin/calendar?month=${weddingDate.slice(0, 7)}`)
    .set("Cookie", adminCookie);
  assert.equal(allVenuesCalendar.status, 200);
  assert.equal(allVenuesCalendar.body.data.selectedVenue, null);
  assert.ok(
    allVenuesCalendar.body.data.weddings.some(
      (calendarWedding: { id: string }) => calendarWedding.id === wedding.id
    )
  );
  assert.ok(allVenuesCalendar.body.data.weddings.length >= venueCalendar.body.data.weddings.length);

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
  assertNoPiiPersistenceMetadata(weddingDetail.body.data);
  const messageTaskList = await request(app)
    .get("/api/v1/admin/message-tasks")
    .set("Cookie", adminCookie);
  assert.equal(messageTaskList.status, 200);
  const listedActivationTask = messageTaskList.body.data.items.find(
    (task: { id: string }) => task.id === activationTask.id
  );
  assert.ok(listedActivationTask);
  assert.equal(listedActivationTask.recipientPhone, "+905551234567");
  assert.equal("encryptionVersion" in listedActivationTask, false);
  assertNoPiiPersistenceMetadata(messageTaskList.body.data.items);

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
    .send({
      confirmText: `İlişkili Test Mekânı ${marker}`,
      reason: "İlişkili mekân artık hizmet vermiyor."
    });
  assert.equal(deactivatedReferencedVenue.status, 200);
  assert.equal(deactivatedReferencedVenue.body.data.isActive, false);
  assert.equal(deactivatedReferencedVenue.body.data.isFeatured, false);
  assert.equal(await prisma.venue.count({ where: { id: referencedRouteVenueId } }), 1);

  const deletedRouteVenue = await request(app)
    .delete(`/api/v1/admin/venues/${routeVenueId}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      confirmText: `Route Test Mekânı ${marker}`,
      reason: "Test mekânı kalıcı olarak kaldırılıyor."
    });
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
    .send({
      confirmText: "Route Test Paketi",
      reason: "Test paketi kalıcı olarak kaldırılıyor."
    });
  assert.equal(archivedRoutePackage.status, 200);
  assert.equal(archivedRoutePackage.body.data.isActive, false);
  assert.equal(await prisma.package.count({ where: { id: routePackageId } }), 0);
  const deactivatedReferencedPackage = await request(app)
    .delete(`/api/v1/admin/packages/${packageRecord.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      confirmText: `Test Paketi ${marker}`,
      reason: "İlişkili paket artık satışta olmayacak."
    });
  assert.equal(deactivatedReferencedPackage.status, 200);
  assert.equal(deactivatedReferencedPackage.body.data.isActive, false);
  assert.equal(
    (await prisma.package.findUniqueOrThrow({ where: { id: packageRecord.id } })).isActive,
    false
  );

  const customerPasswordHashBeforeWeddingUpdate = (
    await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })
  ).passwordHash;
  const currentWeddingPiiForAdmin = decryptWeddingPii(
    wedding.id,
    await prisma.wedding.findUniqueOrThrow({ where: { id: wedding.id } })
  );
  const updatedWeddingDate = addCalendarDays(weddingDate, 1);
  const adminScheduleConflict = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: currentWeddingPiiForAdmin.brideFirstName,
      brideLastName: currentWeddingPiiForAdmin.brideLastName,
      bridePhone: currentWeddingPiiForAdmin.bridePhone,
      groomFirstName: currentWeddingPiiForAdmin.groomFirstName,
      groomLastName: currentWeddingPiiForAdmin.groomLastName,
      groomPhone: currentWeddingPiiForAdmin.groomPhone,
      primaryContact: wedding.primaryContact,
      primaryEmail: currentWeddingPiiForAdmin.primaryEmail,
      weddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: secondVenue.id,
      packageCode: (wedding.packageSummary as { code: string }).code,
      serviceCodes: (wedding.packageSummary as { services: Array<{ code: string }> }).services.map(
        (service) => service.code
      ),
      note: currentWeddingPiiForAdmin.note ?? ""
    });
  assert.equal(adminScheduleConflict.status, 409);
  assert.equal(adminScheduleConflict.body.errors.code, "VENUE_SCHEDULE_CONFLICT");

  const adminVenueAssignmentMismatch = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: currentWeddingPiiForAdmin.brideFirstName,
      brideLastName: currentWeddingPiiForAdmin.brideLastName,
      bridePhone: currentWeddingPiiForAdmin.bridePhone,
      groomFirstName: currentWeddingPiiForAdmin.groomFirstName,
      groomLastName: currentWeddingPiiForAdmin.groomLastName,
      groomPhone: currentWeddingPiiForAdmin.groomPhone,
      primaryContact: wedding.primaryContact,
      primaryEmail: currentWeddingPiiForAdmin.primaryEmail,
      weddingDate: updatedWeddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: secondVenue.id,
      packageCode: (wedding.packageSummary as { code: string }).code,
      serviceCodes: (wedding.packageSummary as { services: Array<{ code: string }> }).services.map(
        (service) => service.code
      ),
      note: currentWeddingPiiForAdmin.note ?? ""
    });
  assert.equal(adminVenueAssignmentMismatch.status, 409);
  assert.equal(adminVenueAssignmentMismatch.body.errors.code, "VENUE_ASSIGNMENT_MISMATCH");

  const weddingUpdate = await request(app)
    .patch(`/api/v1/admin/weddings/${wedding.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      brideFirstName: currentWeddingPiiForAdmin.brideFirstName,
      brideLastName: currentWeddingPiiForAdmin.brideLastName,
      bridePhone: currentWeddingPiiForAdmin.bridePhone,
      groomFirstName: currentWeddingPiiForAdmin.groomFirstName,
      groomLastName: currentWeddingPiiForAdmin.groomLastName,
      groomPhone: "05550001122",
      primaryContact: "DAMAT",
      primaryEmail: currentWeddingPiiForAdmin.primaryEmail,
      weddingDate: updatedWeddingDate,
      startTime: "20:00",
      endTime: "02:00",
      endsNextDay: true,
      venueId: wedding.venueId,
      packageCode: (wedding.packageSummary as { code: string }).code,
      serviceCodes: (wedding.packageSummary as { services: Array<{ code: string }> }).services.map(
        (service) => service.code
      ),
      note: currentWeddingPiiForAdmin.note ?? ""
    });
  assert.equal(weddingUpdate.status, 200);
  assert.equal(weddingUpdate.body.data.credentialsRegenerated, false);
  assert.equal(weddingUpdate.body.data.username, wedding.customerUser.username);
  await assertBookingApplicationFingerprintMatches(wedding.applicationId);
  assert.equal(weddingUpdate.body.data.groomPhone, "+905550001122");
  assertNoPiiPersistenceMetadata(weddingUpdate.body.data);
  const applicationAfterAdminUpdate = await prisma.bookingApplication.findUniqueOrThrow({
    where: { id: wedding.applicationId }
  });
  assert.equal(applicationAfterAdminUpdate.groomPhone, null);
  assert.equal(
    decryptBookingApplicationPii(applicationAfterAdminUpdate.id, applicationAfterAdminUpdate)
      .groomPhone,
    "+905550001122"
  );
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
  assert.equal(preparationAfterWeddingUpdate.recipientPhone, null);
  assert.equal(
    decryptMessageTaskPii(preparationAfterWeddingUpdate.id, preparationAfterWeddingUpdate)
      .recipientPhone,
    "+905550001122"
  );
  assert.equal(
    (
      await prisma.bookingApplication.findFirst({
        where: {
          id: wedding.applicationId,
          groomPhoneBlindIndex: piiCryptography.blindIndex(
            "BookingApplication.groomPhone",
            "0 (555) 000 11 22",
            "phone"
          )
        },
        select: { id: true }
      })
    )?.id,
    wedding.applicationId
  );
  assert.equal(
    (
      await prisma.messageTask.findFirst({
        where: {
          id: preparationAfterWeddingUpdate.id,
          recipientPhoneBlindIndex: piiCryptography.blindIndex(
            "MessageTask.recipientPhone",
            "0 (555) 000 11 22",
            "phone"
          )
        },
        select: { id: true }
      })
    )?.id,
    preparationAfterWeddingUpdate.id
  );
  assert.equal(
    preparationAfterWeddingUpdate.dueAt.toISOString(),
    `${addCalendarDays(updatedWeddingDate, 2)}T07:00:00.000Z`
  );

  const phaseFourApp = createApp();
  phaseFourApp.locals.deliveryLinkAccessVerifier = app.locals.deliveryLinkAccessVerifier;
  const driveUrl = "https://drive.google.com/file/d/integration-test";
  const invalidDeliveryJump = await request(phaseFourApp)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ status: "TESLIME_HAZIR", driveUrl });
  assert.equal(invalidDeliveryJump.status, 409);
  const manualMontage = await request(phaseFourApp)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ status: "MONTAJ" });
  assert.equal(manualMontage.status, 409);

  await runWithRlsContext(
    { actorRole: "maintenance", purpose: "maintenance.delivery-status" },
    () =>
      synchronizeAutomaticDeliveryStatuses(
        new Date(`${addCalendarDays(updatedWeddingDate, 5)}T09:00:00+03:00`)
      )
  );
  assert.equal(
    (await prisma.delivery.findUniqueOrThrow({ where: { id: wedding.delivery!.id } })).status,
    "MONTAJ"
  );
  await runWithRlsContext(
    { actorRole: "maintenance", purpose: "maintenance.delivery-status" },
    () =>
      synchronizeAutomaticDeliveryStatuses(
        new Date(`${addCalendarDays(updatedWeddingDate, 8)}T09:00:00+03:00`)
      )
  );
  assert.equal(
    (await prisma.delivery.findUniqueOrThrow({ where: { id: wedding.delivery!.id } })).status,
    "KONTROL"
  );
  await runWithRlsContext(
    { actorRole: "maintenance", purpose: "maintenance.delivery-status" },
    () =>
      synchronizeAutomaticDeliveryStatuses(
        new Date(`${addCalendarDays(updatedWeddingDate, 5)}T09:00:00+03:00`)
      )
  );
  assert.equal(
    (await prisma.delivery.findUniqueOrThrow({ where: { id: wedding.delivery!.id } })).status,
    "KONTROL"
  );
  const readyTransition = await request(phaseFourApp)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ status: "TESLIME_HAZIR", driveUrl });
  assert.equal(readyTransition.status, 200);
  const preparedDelivery = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id }
  });
  assert.equal(preparedDelivery.status, "TESLIME_HAZIR");
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
  const clearedDelivery = await request(phaseFourApp)
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
  const restoredDeliveryUrl = await request(phaseFourApp)
    .patch(`/api/v1/admin/deliveries/${wedding.delivery!.id}`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ driveUrl });
  assert.equal(restoredDeliveryUrl.status, 200);
  const hiddenDelivery = await request(phaseFourApp)
    .get("/api/v1/customer/delivery")
    .set("Cookie", customerCookie);
  assert.equal(hiddenDelivery.status, 404);
  assert.equal(JSON.stringify(ownDashboard.body).includes("drive.google.com"), false);
  const safeAdminWeddings = await request(phaseFourApp)
    .get("/api/v1/admin/weddings")
    .set("Cookie", adminCookie);
  assert.equal(safeAdminWeddings.status, 200);
  assert.equal(JSON.stringify(safeAdminWeddings.body).includes("driveUrlCiphertext"), false);
  assertNoPiiPersistenceMetadata(safeAdminWeddings.body.data.items);

  await assert.rejects(
    prisma.delivery.update({
      where: { id: wedding.delivery!.id },
      data: { status: "TESLIM_EDILDI", releasedAt: null }
    })
  );
  const unconfirmedDelivery = await request(phaseFourApp)
    .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(unconfirmedDelivery.status, 400);
  const concurrentDeliveries = await Promise.all([
    request(phaseFourApp)
      .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
      .set("X-Correlation-ID", correlationId)
      .set("Cookie", adminAuthCookie)
      .set("X-CSRF-Token", adminCsrfToken)
      .send({ sharingConfirmed: true, sharingConfirmation: "ERİŞİMİ DOĞRULADIM" }),
    request(phaseFourApp)
      .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/deliver`)
      .set("X-Correlation-ID", correlationId)
      .set("Cookie", adminAuthCookie)
      .set("X-CSRF-Token", adminCsrfToken)
      .send({ sharingConfirmed: true, sharingConfirmation: "ERİŞİMİ DOĞRULADIM" })
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
  assert.equal(deliveryMessage.status, "PLANNED");
  const finalApp = createApp();
  finalApp.locals.deliveryLinkAccessVerifier = app.locals.deliveryLinkAccessVerifier;
  const releasedDelivery = await request(finalApp)
    .get("/api/v1/customer/delivery")
    .set("Cookie", customerCookie);
  assert.equal(releasedDelivery.status, 200);
  assert.equal(releasedDelivery.body.data.driveUrl, driveUrl);
  await prisma.rateLimitBucket.deleteMany();
  const foreignDelivery = await request(finalApp)
    .get(`/api/v1/customer/delivery?deliveryId=${randomUUID()}`)
    .set("Cookie", customerCookie);
  assert.equal(foreignDelivery.status, 404);
  const releasedDeliveryRecord = await prisma.delivery.findUniqueOrThrow({
    where: { id: wedding.delivery!.id }
  });
  assert.ok(releasedDeliveryRecord.accessExpiresAt);
  assert.ok(releasedDeliveryRecord.accessExpiresAt > releasedDeliveryRecord.releasedAt!);
  await prisma.delivery.update({
    where: { id: wedding.delivery!.id },
    data: {
      releasedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000),
      accessExpiresAt: new Date(Date.now() - 24 * 60 * 60 * 1_000)
    }
  });
  const expiredDelivery = await request(finalApp)
    .get("/api/v1/customer/delivery")
    .set("Cookie", customerCookie);
  assert.equal(expiredDelivery.status, 404);
  await prisma.delivery.update({
    where: { id: wedding.delivery!.id },
    data: {
      releasedAt: releasedDeliveryRecord.releasedAt,
      accessExpiresAt: releasedDeliveryRecord.accessExpiresAt
    }
  });
  await prisma.authSession.update({
    where: { id: adminSession.id },
    data: { adminStepUpVerifiedAt: new Date() }
  });
  const revokedDelivery = await request(finalApp)
    .post(`/api/v1/admin/deliveries/${wedding.delivery!.id}/revoke`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ reason: "Sentetik teslimat erişimi geri çekme testi" });
  assert.equal(revokedDelivery.status, 200);
  const deliveryAfterRevoke = await request(finalApp)
    .get("/api/v1/customer/delivery")
    .set("Cookie", customerCookie);
  assert.equal(deliveryAfterRevoke.status, 404);

  const logout = await request(finalApp)
    .post("/api/v1/auth/logout")
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", `${customerCookie}; ${customerCsrfCookie}`)
    .set("X-CSRF-Token", customerCsrfToken)
    .send({});
  assert.equal(logout.status, 200);
  const loggedOutSession = await request(finalApp)
    .get("/api/v1/auth/session")
    .set("Cookie", customerCookie);
  assert.equal(loggedOutSession.status, 401);

  const recoveryTotpSecret = "ABCDEFGHIJKLMNOPQRSTUVWX234567AB";
  const encryptedRecoveryTotp = encryptValue(
    recoveryTotpSecret,
    totpEncryptionAad(wedding.customerUserId)
  );
  await prisma.user.update({
    where: { id: wedding.customerUserId },
    data: {
      totpSecretCiphertext: encryptedRecoveryTotp.ciphertext,
      totpSecretIv: encryptedRecoveryTotp.iv,
      totpSecretAuthTag: encryptedRecoveryTotp.authTag,
      totpKeyId: null,
      totpEnrollmentExpiresAt: null,
      totpEnabledAt: new Date(),
      totpLastUsedStep: 1n
    }
  });
  const recoverySessionTokens = [`${marker}-recovery-session-1`, `${marker}-recovery-session-2`];
  const recoverySessions = await Promise.all(
    recoverySessionTokens.map((token, index) =>
      prisma.authSession.create({
        data: {
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(`${token}-csrf`),
          userId: wedding.customerUserId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          mfaVerifiedAt: index === 0 ? new Date() : null
        }
      })
    )
  );
  const recoverySetupToken = createOpaqueToken();
  const pendingRecoverySetupToken = await prisma.passwordSetupToken.create({
    data: {
      tokenHash: hashToken(recoverySetupToken),
      userId: wedding.customerUserId,
      purpose: "PASSWORD_RESET",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      createdById: admin.id
    }
  });
  const customerCannotResetMfa = await request(finalApp)
    .post(`/api/v1/admin/customers/${wedding.customerUserId}/reset-mfa`)
    .set("Cookie", `${env.SESSION_COOKIE_NAME}=${recoverySessionTokens[0]}`)
    .send({
      confirmText: wedding.customerUser.username,
      reason: "Müşteri doğrulama cihazını kaybetti."
    });
  assert.equal(customerCannotResetMfa.status, 403);

  await prisma.authSession.update({
    where: { id: adminSession.id },
    data: { adminStepUpVerifiedAt: new Date() }
  });
  const resetMfa = await request(finalApp)
    .post(`/api/v1/admin/customers/${wedding.customerUserId}/reset-mfa`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      confirmText: wedding.customerUser.username,
      reason: "Müşteri hesaplarında MFA desteklenmiyor."
    });
  assert.equal(resetMfa.status, 404);
  const unchangedCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId }
  });
  assert.notEqual(unchangedCustomer.totpEnabledAt, null);
  assert.equal(
    await prisma.authSession.count({ where: { userId: wedding.customerUserId, revokedAt: null } }),
    recoverySessions.length
  );
  assert.equal(
    (
      await prisma.passwordSetupToken.findUniqueOrThrow({
        where: { id: pendingRecoverySetupToken.id }
      })
    ).revokedAt,
    null
  );

  const passwordReset = await request(finalApp)
    .post(`/api/v1/admin/customers/${wedding.customerUserId}/reset-password`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({
      confirmText: wedding.customerUser.username,
      reason: "Müşteri parola erişimini kaybetti."
    });
  assert.equal(passwordReset.status, 200);
  assert.equal(passwordReset.headers["cache-control"], "no-store");
  const resetTaskId = passwordReset.body.data.taskId as string;
  assert.equal(passwordReset.body.data.status, "PLANNED");
  const pendingResetTask = await prisma.messageTask.findUniqueOrThrow({
    where: { id: resetTaskId }
  });
  assert.equal(pendingResetTask.status, "PLANNED");
  assert.equal(pendingResetTask.secretCiphertext, null);
  assert.equal(pendingResetTask.secretIv, null);
  assert.equal(pendingResetTask.secretAuthTag, null);
  assert.equal(pendingResetTask.encryptionVersion, 2);
  const sentWithoutPreparedLink = await request(finalApp)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ expectedUpdatedAt: pendingResetTask.updatedAt.toISOString() });
  assert.equal(sentWithoutPreparedLink.status, 409);
  await assert.rejects(
    prisma.messageTask.update({
      where: { id: resetTaskId },
      data: { status: "SENT", sentAt: null, sentById: admin.id }
    })
  );
  const resetCustomer = await prisma.user.findUniqueOrThrow({
    where: { id: wedding.customerUserId }
  });
  assert.equal(resetCustomer.mustChangePassword, true);
  assert.equal(resetCustomer.temporaryPasswordExpiresAt, null);

  const setupTokenCountBeforeRejectedRender = await prisma.passwordSetupToken.count({
    where: { userId: wedding.customerUserId }
  });
  await prisma.authSession.update({
    where: { id: adminSession.id },
    data: { adminStepUpVerifiedAt: null }
  });
  const rejectedSensitiveRender = await request(finalApp)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/render`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(rejectedSensitiveRender.status, 428);
  assert.equal(rejectedSensitiveRender.body.details.code, "ADMIN_STEP_UP_REQUIRED");
  assert.equal(
    await prisma.passwordSetupToken.count({ where: { userId: wedding.customerUserId } }),
    setupTokenCountBeforeRejectedRender
  );
  await prisma.authSession.update({
    where: { id: adminSession.id },
    data: { adminStepUpVerifiedAt: new Date() }
  });
  const concurrentResetRenders = await Promise.all([
    request(finalApp)
      .post(`/api/v1/admin/message-tasks/${resetTaskId}/render`)
      .set("X-Correlation-ID", correlationId)
      .set("Cookie", adminAuthCookie)
      .set("X-CSRF-Token", adminCsrfToken)
      .send({}),
    request(finalApp)
      .post(`/api/v1/admin/message-tasks/${resetTaskId}/render`)
      .set("X-Correlation-ID", correlationId)
      .set("Cookie", adminAuthCookie)
      .set("X-CSRF-Token", adminCsrfToken)
      .send({})
  ]);
  assert.deepEqual(concurrentResetRenders.map((response) => response.status).sort(), [200, 409]);
  const renderedReset = concurrentResetRenders.find((response) => response.status === 200)!;
  assert.equal(renderedReset.status, 200);
  assert.equal(renderedReset.headers["cache-control"], "no-store");
  assert.equal(renderedReset.body.data.status, "PREPARED");
  const sentBeforeVerification = await request(finalApp)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ expectedUpdatedAt: renderedReset.body.data.expectedUpdatedAt });
  assert.equal(sentBeforeVerification.status, 409);
  const verifiedReset = await request(finalApp)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/verify`)
    .set("X-Correlation-ID", correlationId)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({});
  assert.equal(verifiedReset.status, 200);
  assert.equal(verifiedReset.body.data.status, "READY_TO_SEND");
  assert.equal(verifiedReset.body.data.message.includes("Tek kullanımlık parola"), true);
  const latestResetToken = String(verifiedReset.body.data.message).match(
    /#setup=([A-Za-z0-9_-]{43})&purpose=PASSWORD_RESET/
  )?.[1];
  assert.ok(latestResetToken);
  assert.equal(
    new URL(verifiedReset.body.data.whatsappUrl).searchParams.get("text"),
    verifiedReset.body.data.message
  );
  const setupLinkAudit = await prisma.auditLog.findFirst({
    where: {
      actorUserId: admin.id,
      action: "message.password_setup_link_issued",
      targetType: "MessageTask",
      targetId: resetTaskId,
      correlationId
    }
  });
  assert.ok(setupLinkAudit);
  assert.deepEqual(setupLinkAudit.metadata, {
    weddingId: wedding.id,
    kind: "PASSWORD_RESET"
  });
  const expectedUpdatedAt = verifiedReset.body.data.expectedUpdatedAt as string;
  const markedSent = await request(finalApp)
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
  const replayedMarkSent = await request(finalApp)
    .post(`/api/v1/admin/message-tasks/${resetTaskId}/mark-sent`)
    .set("Cookie", adminAuthCookie)
    .set("X-CSRF-Token", adminCsrfToken)
    .send({ expectedUpdatedAt });
  assert.equal(replayedMarkSent.status, 409);

  const revokedResetSetup = await request(finalApp).post("/api/v1/auth/password/setup").send({
    token: recoverySetupToken,
    purpose: "PASSWORD_RESET",
    newPassword: "eski-link-kullanilamayacak-guvenli-parola"
  });
  assert.equal(revokedResetSetup.status, 410);
  const resetPassword = "reset-sonrasi-yeni-kalici-guvenli-parola";
  const resetSetup = await request(finalApp)
    .post("/api/v1/auth/password/setup")
    .send({ token: latestResetToken, purpose: "PASSWORD_RESET", newPassword: resetPassword });
  assert.equal(resetSetup.status, 200);
  const replayedResetSetup = await request(finalApp).post("/api/v1/auth/password/setup").send({
    token: latestResetToken,
    purpose: "PASSWORD_RESET",
    newPassword: "ikinci-kez-kullanilamayacak-guvenli-parola"
  });
  assert.equal(replayedResetSetup.status, 410);
  assert.equal(
    await verifyPassword(
      (await prisma.user.findUniqueOrThrow({ where: { id: wedding.customerUserId } })).passwordHash,
      resetPassword
    ),
    true
  );

  const auditLogs = await prisma.auditLog.findMany({ where: { correlationId } });
  const serializedLogs = JSON.stringify(auditLogs);
  assert.equal(serializedLogs.includes(driveUrl), false);
  assert.equal(serializedLogs.includes(activationSetupToken), false);
  assert.equal(serializedLogs.includes(latestResetToken), false);
  assert.equal(serializedLogs.includes(firstApproval.username), false);
  assert.equal(serializedLogs.includes(applicationInput.bridePhone), false);
  assert.equal(serializedLogs.includes(applicationInput.primaryEmail), false);
  assert.equal(
    wedding.messageTasks.some((task) => task.secretCiphertext !== null),
    false
  );

  const currentWeddingSchedule = await prisma.wedding.findUniqueOrThrow({
    where: { id: wedding.id },
    select: { startsAt: true }
  });
  const currentWeddingDate = getIstanbulDate(currentWeddingSchedule.startsAt);
  const availabilityRes = await request(finalApp).get(
    `/api/v1/venues/${venue.id}/availability?date=${currentWeddingDate}`
  );
  assert.equal(availabilityRes.status, 200);
  assert.equal(availabilityRes.body.success, true);
  assert.equal(availabilityRes.headers["cache-control"], "no-store");
  assert.deepEqual(availabilityRes.body.data, {
    date: currentWeddingDate,
    hasOccupancy: true
  });
  assert.equal("occupiedSlots" in availabilityRes.body.data, false);

  const outOfHorizonAvailabilityRes = await request(finalApp).get(
    `/api/v1/venues/${venue.id}/availability?date=${addCalendarDays(getIstanbulDate(new Date()), 367)}`
  );
  assert.equal(outOfHorizonAvailabilityRes.status, 400);
  assert.equal(outOfHorizonAvailabilityRes.body.success, false);
});

test("ayrıcalıklı TOTP enrollment, login replay koruması ve disable akışı uçtan uca çalışır", async (context) => {
  await prisma.rateLimitBucket.deleteMany();
  const marker = `mfa-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
  const password = "Mfa-Entegrasyon!Mor-Bulut-2026";
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
    await prisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: user.id }, { targetType: "User", targetId: user.id }] }
    });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  await assert.rejects(
    prisma.user.update({
      where: { id: user.id },
      data: { totpSecretCiphertext: "eksik-durum" }
    })
  );

  const sessionToken = `${marker}-session`;
  const csrfToken = `${marker}-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  const sessionCookie = `${env.SESSION_COOKIE_NAME}=${sessionToken}`;
  const csrfCookie = `${CSRF_COOKIE_NAME}=${csrfToken}`;
  const authCookies = `${sessionCookie}; ${csrfCookie}`;
  const app = createApp();
  const mfaLoginClientIp = "198.51.100.42";
  app.set("trust proxy", 1);

  const csrfRejectedEnrollment = await request(app)
    .post("/api/v1/auth/mfa/enroll")
    .set("Cookie", authCookies)
    .send({ currentPassword: password });
  assert.equal(csrfRejectedEnrollment.status, 403);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).totpSecretCiphertext,
    null
  );

  const enrollment = await request(app)
    .post("/api/v1/auth/mfa/enroll")
    .set("Cookie", authCookies)
    .set("X-CSRF-Token", csrfToken)
    .send({ currentPassword: password });
  assert.equal(enrollment.status, 200);
  assert.equal(enrollment.headers["cache-control"], "no-store");
  const secret = enrollment.body.data.secret as string;
  assert.match(secret, /^[A-Z2-7]{32}$/);
  assert.equal(new URL(enrollment.body.data.otpauthUri).searchParams.get("secret"), secret);
  const pendingUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.notEqual(pendingUser.totpSecretCiphertext, secret);
  assert.equal(pendingUser.totpKeyId, env.DATA_ENCRYPTION_ACTIVE_KEY_ID);
  assert.equal(
    decryptValue(
      {
        ciphertext: pendingUser.totpSecretCiphertext!,
        iv: pendingUser.totpSecretIv!,
        authTag: pendingUser.totpSecretAuthTag!
      },
      totpEncryptionAad(user.id)
    ),
    secret
  );
  assert.throws(() =>
    decryptValue(
      {
        ciphertext: pendingUser.totpSecretCiphertext!,
        iv: pendingUser.totpSecretIv!,
        authTag: pendingUser.totpSecretAuthTag!
      },
      totpEncryptionAad(`${user.id}-baska`)
    )
  );

  const confirmationStep = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS));
  const confirmationCode = generateTotpCode(secret, confirmationStep);
  const confirmation = await request(app)
    .post("/api/v1/auth/mfa/confirm")
    .set("Cookie", authCookies)
    .set("X-CSRF-Token", csrfToken)
    .send({ currentPassword: password, totpCode: confirmationCode });
  assert.equal(confirmation.status, 200);
  assert.equal(confirmation.headers["cache-control"], "no-store");
  const confirmedCookies = confirmation.headers["set-cookie"] as unknown as string[];
  assert.ok(confirmedCookies.some((cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`)));
  assert.ok(confirmedCookies.some((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`)));

  const enabledUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.ok(enabledUser.totpEnabledAt);
  assert.equal(enabledUser.totpEnrollmentExpiresAt, null);
  assert.equal(enabledUser.totpLastUsedStep, confirmationStep);
  assert.equal(
    (await request(app).get("/api/v1/auth/session").set("Cookie", sessionCookie)).status,
    401
  );

  const activeSessionsBeforeMissingCode = await prisma.authSession.count({
    where: { userId: user.id, revokedAt: null }
  });
  const missingCodeLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", mfaLoginClientIp)
    .send({
      username: user.username,
      password,
      remember: true
    });
  assert.equal(missingCodeLogin.status, 401);
  assert.equal(missingCodeLogin.body.errors.code, "MFA_REQUIRED");
  assert.equal(missingCodeLogin.headers["set-cookie"], undefined);
  assert.equal(
    await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }),
    activeSessionsBeforeMissingCode
  );

  const replayedLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", mfaLoginClientIp)
    .send({
      username: user.username,
      password,
      totpCode: confirmationCode,
      remember: true
    });
  assert.equal(replayedLogin.status, 401);
  assert.equal(
    await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }),
    activeSessionsBeforeMissingCode
  );

  const mfaBruteForceIp = "198.51.100.43";
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rejectedAttempt = await request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", mfaBruteForceIp)
      .send({ username: user.username, password, totpCode: confirmationCode });
    assert.equal(rejectedAttempt.status, 401);
  }
  const rateLimitedMfaAttempt = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", mfaBruteForceIp)
    .send({ username: user.username, password, totpCode: confirmationCode });
  assert.equal(rateLimitedMfaAttempt.status, 429);

  const loginStep = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS));
  await prisma.user.update({
    where: { id: user.id },
    data: { totpLastUsedStep: loginStep - 1n, totpKeyId: null }
  });
  const loginBody = {
    username: user.username,
    password,
    totpCode: generateTotpCode(secret, loginStep),
    remember: true,
    trustDevice: true
  };
  const concurrentLogins = await Promise.all([
    request(app)
      .post("/api/v1/auth/login")
      .set("X-Forwarded-For", mfaLoginClientIp)
      .send(loginBody),
    request(app).post("/api/v1/auth/login").set("X-Forwarded-For", mfaLoginClientIp).send(loginBody)
  ]);
  assert.deepEqual(concurrentLogins.map((response) => response.status).sort(), [200, 401]);
  const successfulLogin = concurrentLogins.find((response) => response.status === 200)!;
  assert.equal(successfulLogin.status, 200);
  assert.equal(successfulLogin.body.data.mfaEnabled, true);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).totpKeyId,
    env.DATA_ENCRYPTION_ACTIVE_KEY_ID
  );
  const successfulLoginCookies = successfulLogin.headers["set-cookie"] as unknown as string[];
  const loginSessionCookie = successfulLoginCookies
    .find((cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const loginCsrfCookie = successfulLoginCookies
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const loginCsrfToken = loginCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);
  const adminSessionCookieHeader = successfulLoginCookies.find((cookie) =>
    cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`)
  )!;
  assert.match(adminSessionCookieHeader, /Max-Age=28800/i);
  const trustedDeviceCookie = successfulLoginCookies
    .find((cookie) => cookie.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  assert.ok(trustedDeviceCookie);
  const trustedDevice = await prisma.trustedDevice.findFirstOrThrow({
    where: { userId: user.id, revokedAt: null }
  });
  assert.equal(trustedDevice.trusted, true);
  assert.ok(
    trustedDevice.expiresAt.valueOf() - trustedDevice.createdAt.valueOf() <=
      30 * 24 * 60 * 60 * 1_000
  );

  const recognizedDeviceLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", "198.51.100.44")
    .set("Cookie", trustedDeviceCookie)
    .send({ username: user.username, password, remember: false });
  assert.equal(recognizedDeviceLogin.status, 200);
  const recognizedCookies = recognizedDeviceLogin.headers["set-cookie"] as unknown as string[];
  const recognizedSessionCookie = recognizedCookies
    .find((cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const recognizedCsrfCookie = recognizedCookies
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const recognizedCsrfToken = recognizedCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);
  const revokedTrustedDevice = await request(app)
    .delete(`/api/v1/auth/devices/${trustedDevice.id}`)
    .set("Cookie", `${recognizedSessionCookie}; ${recognizedCsrfCookie}; ${trustedDeviceCookie}`)
    .set("X-CSRF-Token", recognizedCsrfToken)
    .send({});
  assert.equal(revokedTrustedDevice.status, 200);
  assert.ok(
    (await prisma.trustedDevice.findUniqueOrThrow({ where: { id: trustedDevice.id } })).revokedAt
  );
  const revokedDeviceLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", "198.51.100.45")
    .set("Cookie", trustedDeviceCookie)
    .send({ username: user.username, password, remember: false });
  assert.equal(revokedDeviceLogin.status, 401);
  assert.equal(revokedDeviceLogin.body.errors.code, "MFA_REQUIRED");
  const expiredDeviceToken = createOpaqueToken();
  await prisma.trustedDevice.create({
    data: {
      tokenHash: hashToken(expiredDeviceToken),
      userId: user.id,
      name: "Sentetik süresi dolmuş cihaz",
      userAgentHash: hashToken("bilinmeyen-tarayici"),
      trusted: true,
      lastMfaAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000),
      expiresAt: new Date(Date.now() - 1_000)
    }
  });
  const expiredDeviceLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", "198.51.100.46")
    .set("Cookie", `${TRUSTED_DEVICE_COOKIE_NAME}=${expiredDeviceToken}`)
    .send({ username: user.username, password, remember: false });
  assert.equal(expiredDeviceLogin.status, 401);
  assert.equal(expiredDeviceLogin.body.errors.code, "MFA_REQUIRED");

  const loginSessionToken = loginSessionCookie.slice(`${env.SESSION_COOKIE_NAME}=`.length);
  const loginSessionBeforeStepUp = await prisma.authSession.findUniqueOrThrow({
    where: { tokenHash: hashToken(loginSessionToken) }
  });
  const secondAdminSessionToken = `${marker}-second-admin-session`;
  const secondAdminCsrfToken = `${marker}-second-admin-csrf`;
  const secondAdminSession = await prisma.authSession.create({
    data: {
      tokenHash: hashToken(secondAdminSessionToken),
      csrfTokenHash: hashToken(secondAdminCsrfToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      mfaVerifiedAt: new Date()
    }
  });
  const distributedStepUpBody = {
    currentPassword: `${password}-yanlis`,
    totpCode: "000000"
  };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const rejectedAttempt = await request(app)
      .post("/api/v1/auth/admin-step-up")
      .set("X-Forwarded-For", `198.51.${attempt}.10`)
      .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
      .set("X-CSRF-Token", loginCsrfToken)
      .send(distributedStepUpBody);
    assert.equal(rejectedAttempt.status, 401);
  }
  const accountLimitedStepUp = await request(app)
    .post("/api/v1/auth/admin-step-up")
    .set("X-Forwarded-For", "203.0.113.10")
    .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
    .set("X-CSRF-Token", loginCsrfToken)
    .send(distributedStepUpBody);
  assert.equal(accountLimitedStepUp.status, 429);
  await prisma.rateLimitBucket.deleteMany({
    where: {
      keyHash: hashRateLimitKey("auth-admin-step-up-account", user.id)
    }
  });
  const stepUpStep = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS));
  await prisma.user.update({
    where: { id: user.id },
    data: { totpLastUsedStep: stepUpStep - 1n }
  });
  const stepUpCode = generateTotpCode(secret, stepUpStep);
  const currentWindowCodes = new Set([
    generateTotpCode(secret, stepUpStep - 1n),
    stepUpCode,
    generateTotpCode(secret, stepUpStep + 1n)
  ]);
  let invalidStepUpCode = "000000";
  while (currentWindowCodes.has(invalidStepUpCode)) {
    invalidStepUpCode = String(Number(invalidStepUpCode) + 1).padStart(6, "0");
  }
  const stepUpBody = { currentPassword: password, totpCode: stepUpCode };

  const csrfRejectedStepUp = await request(app)
    .post("/api/v1/auth/admin-step-up")
    .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
    .send(stepUpBody);
  assert.equal(csrfRejectedStepUp.status, 403);

  const wrongPasswordStepUp = await request(app)
    .post("/api/v1/auth/admin-step-up")
    .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
    .set("X-CSRF-Token", loginCsrfToken)
    .send({ currentPassword: `${password}-yanlis`, totpCode: stepUpCode });
  assert.equal(wrongPasswordStepUp.status, 401);
  const wrongTotpStepUp = await request(app)
    .post("/api/v1/auth/admin-step-up")
    .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
    .set("X-CSRF-Token", loginCsrfToken)
    .send({ currentPassword: password, totpCode: invalidStepUpCode });
  assert.equal(wrongTotpStepUp.status, 401);

  const concurrentStepUps = await Promise.all([
    request(app)
      .post("/api/v1/auth/admin-step-up")
      .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
      .set("X-CSRF-Token", loginCsrfToken)
      .send(stepUpBody),
    request(app)
      .post("/api/v1/auth/admin-step-up")
      .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
      .set("X-CSRF-Token", loginCsrfToken)
      .send(stepUpBody)
  ]);
  assert.deepEqual(concurrentStepUps.map((response) => response.status).sort(), [200, 401]);
  const successfulStepUp = concurrentStepUps.find((response) => response.status === 200)!;
  const stepUpCookies = successfulStepUp.headers["set-cookie"] as unknown as string[];
  const stepUpSessionCookie = stepUpCookies
    .find((cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const stepUpCsrfCookie = stepUpCookies
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const stepUpCsrfToken = stepUpCsrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);
  assert.notEqual(stepUpSessionCookie, loginSessionCookie);
  assert.notEqual(stepUpCsrfCookie, loginCsrfCookie);
  const validUntilMs = new Date(successfulStepUp.body.data.validUntil as string).valueOf();
  assert.ok(validUntilMs > Date.now());
  assert.ok(validUntilMs - Date.now() <= 5 * 60 * 1000);
  assert.equal(
    (
      await request(app)
        .get("/api/v1/auth/session")
        .set("Cookie", `${loginSessionCookie}; ${loginCsrfCookie}`)
    ).status,
    401
  );
  assert.equal(
    (
      await request(app)
        .get("/api/v1/auth/session")
        .set("Cookie", `${stepUpSessionCookie}; ${stepUpCsrfCookie}`)
    ).status,
    200
  );
  const steppedUpSession = await prisma.authSession.findUniqueOrThrow({
    where: { id: loginSessionBeforeStepUp.id }
  });
  assert.ok(steppedUpSession.adminStepUpVerifiedAt);
  assert.equal(
    (await prisma.authSession.findUniqueOrThrow({ where: { id: secondAdminSession.id } }))
      .adminStepUpVerifiedAt,
    null
  );
  const replayedStepUp = await request(app)
    .post("/api/v1/auth/admin-step-up")
    .set("Cookie", `${stepUpSessionCookie}; ${stepUpCsrfCookie}`)
    .set("X-CSRF-Token", stepUpCsrfToken)
    .send(stepUpBody);
  assert.equal(replayedStepUp.status, 401);

  const disableStep = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS));
  await prisma.user.update({
    where: { id: user.id },
    data: { totpLastUsedStep: disableStep - 1n }
  });
  const disabled = await request(app)
    .post("/api/v1/auth/mfa/disable")
    .set("Cookie", `${stepUpSessionCookie}; ${stepUpCsrfCookie}`)
    .set("X-CSRF-Token", stepUpCsrfToken)
    .send({ currentPassword: password, totpCode: generateTotpCode(secret, disableStep) });
  assert.equal(disabled.status, 200);
  assert.ok(
    (disabled.headers["set-cookie"] as unknown as string[]).some((cookie) =>
      cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`)
    )
  );
  const disabledUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.equal(disabledUser.totpSecretCiphertext, null);
  assert.equal(disabledUser.totpSecretIv, null);
  assert.equal(disabledUser.totpSecretAuthTag, null);
  assert.equal(disabledUser.totpKeyId, null);
  assert.equal(disabledUser.totpEnabledAt, null);
  assert.equal(disabledUser.totpLastUsedStep, null);
  assert.equal(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }), 0);
  assert.equal(
    await prisma.trustedDevice.count({ where: { userId: user.id, revokedAt: null } }),
    0
  );

  const auditLogs = await prisma.auditLog.findMany({
    where: { actorUserId: user.id },
    select: { action: true, metadata: true }
  });
  assert.deepEqual(auditLogs.map((entry) => entry.action).sort(), [
    "auth.admin_step_up",
    "auth.login",
    "auth.login",
    "auth.mfa_disabled",
    "auth.mfa_enabled",
    "auth.mfa_enrollment_started",
    "auth.trusted_device_revoked"
  ]);
  assert.equal(JSON.stringify(auditLogs).includes(secret), false);
  assert.equal(JSON.stringify(auditLogs).includes(confirmationCode), false);
  assert.equal(JSON.stringify(auditLogs).includes(stepUpCode), false);
  assert.equal(JSON.stringify(auditLogs).includes(password), false);
});

test("müşteri hesabı eski MFA kaydı bulunsa bile MFA kullanmaz veya yönetemez", async (context) => {
  await prisma.rateLimitBucket.deleteMany();
  const marker = `customer-mfa-${randomUUID()}`;
  const password = "Musteri-Mfa!Guvenli-Parola-2026";
  const user = await prisma.user.create({
    data: {
      username: marker,
      passwordHash: await hashPassword(password),
      role: "MUSTERI",
      status: "ACTIVE",
      mustChangePassword: false,
      temporaryPasswordExpiresAt: null,
      passwordChangedAt: new Date()
    }
  });
  context.after(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
    await prisma.user.deleteMany({ where: { id: user.id } });
  });

  const sessionToken = `${marker}-session`;
  const csrfToken = `${marker}-csrf`;
  await prisma.authSession.create({
    data: {
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      userId: user.id,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    }
  });
  const authCookies = `${env.SESSION_COOKIE_NAME}=${sessionToken}; ${CSRF_COOKIE_NAME}=${csrfToken}`;
  const app = createApp();
  app.set("trust proxy", 1);

  const enrollment = await request(app)
    .post("/api/v1/auth/mfa/enroll")
    .set("Cookie", authCookies)
    .set("X-CSRF-Token", csrfToken)
    .send({ currentPassword: password });
  assert.equal(enrollment.status, 403);
  const secret = "ABCDEFGHIJKLMNOPQRSTUVWX234567AB";
  const encryptedSecret = encryptValue(secret, totpEncryptionAad(user.id));
  await prisma.user.update({
    where: { id: user.id },
    data: {
      totpSecretCiphertext: encryptedSecret.ciphertext,
      totpSecretIv: encryptedSecret.iv,
      totpSecretAuthTag: encryptedSecret.authTag,
      totpKeyId: null,
      totpEnabledAt: new Date(),
      totpLastUsedStep: 1n
    }
  });

  const confirmationStep = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS));
  const confirmationCode = generateTotpCode(secret, confirmationStep);
  const confirmation = await request(app)
    .post("/api/v1/auth/mfa/confirm")
    .set("Cookie", authCookies)
    .set("X-CSRF-Token", csrfToken)
    .send({ currentPassword: password, totpCode: confirmationCode });
  assert.equal(confirmation.status, 403);

  const loginIp = "203.0.113.61";
  const missingCodeLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", loginIp)
    .send({ username: marker, password, remember: true });
  assert.equal(missingCodeLogin.status, 200);
  assert.equal(missingCodeLogin.body.data.mfaEnabled, false);

  const replayedCodeLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", loginIp)
    .send({ username: marker, password, remember: true, totpCode: confirmationCode });
  assert.equal(replayedCodeLogin.status, 200);

  const loginStep = BigInt(Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS));
  await prisma.user.update({
    where: { id: user.id },
    data: { totpLastUsedStep: loginStep - 1n }
  });
  const successfulLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", loginIp)
    .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0")
    .send({
      username: marker,
      password,
      remember: true,
      trustDevice: true,
      totpCode: generateTotpCode(secret, loginStep)
    });
  assert.equal(successfulLogin.status, 200);
  assert.equal(successfulLogin.body.data.role, "MUSTERI");
  assert.equal(successfulLogin.body.data.mfaEnabled, false);
  const loginCookies = successfulLogin.headers["set-cookie"] as unknown as string[];
  const sessionCookie = loginCookies
    .find((cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const csrfCookie = loginCookies
    .find((cookie) => cookie.startsWith(`${CSRF_COOKIE_NAME}=`))!
    .split(";", 1)[0];
  const rotatedCsrfToken = csrfCookie.slice(`${CSRF_COOKIE_NAME}=`.length);
  assert.equal(
    loginCookies.find((cookie) => cookie.startsWith("dugunajansim_trusted_device=")),
    undefined
  );
  assert.equal(await prisma.trustedDevice.count({ where: { userId: user.id } }), 0);
  const trustedDeviceCookie = "dugunajansim_trusted_device=legacy-customer-device";
  assert.match(
    loginCookies.find((cookie) => cookie.startsWith(`${env.SESSION_COOKIE_NAME}=`))!,
    /Max-Age=2592000/i
  );

  const recognizedDeviceLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", "198.51.100.44")
    .set("User-Agent", "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0")
    .set("Cookie", trustedDeviceCookie)
    .send({ username: marker, password, remember: true });
  assert.equal(recognizedDeviceLogin.status, 200);

  const suspiciousDeviceLogin = await request(app)
    .post("/api/v1/auth/login")
    .set("X-Forwarded-For", loginIp)
    .set("User-Agent", "Mozilla/5.0 (Android 16) Firefox/142.0")
    .set("Cookie", trustedDeviceCookie)
    .send({ username: marker, password, remember: true });
  assert.equal(suspiciousDeviceLogin.status, 200);

  const devices = await request(app)
    .get("/api/v1/auth/devices")
    .set("Cookie", `${sessionCookie}; ${csrfCookie}; ${trustedDeviceCookie}`);
  assert.equal(devices.status, 403);

  const managedDeviceToken = `${marker}-managed-device`;
  const managedDevice = await prisma.trustedDevice.create({
    data: {
      tokenHash: hashToken(managedDeviceToken),
      userId: user.id,
      name: "Chrome / Windows",
      userAgentHash: hashToken("Mozilla/5.0 (Windows NT 10.0) Chrome/140.0"),
      trusted: true,
      lastMfaAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });
  const managedDevices = await request(app)
    .get("/api/v1/auth/devices")
    .set(
      "Cookie",
      `${sessionCookie}; ${csrfCookie}; dugunajansim_trusted_device=${managedDeviceToken}`
    );
  assert.equal(managedDevices.status, 403);
  const revokedDevice = await request(app)
    .delete(`/api/v1/auth/devices/${managedDevice.id}`)
    .set(
      "Cookie",
      `${sessionCookie}; ${csrfCookie}; dugunajansim_trusted_device=${managedDeviceToken}`
    )
    .set("X-CSRF-Token", rotatedCsrfToken);
  assert.equal(revokedDevice.status, 403);
  await prisma.trustedDevice.create({
    data: {
      tokenHash: hashToken(`${managedDeviceToken}-second`),
      userId: user.id,
      name: "Firefox / Android",
      userAgentHash: hashToken("Mozilla/5.0 (Android 16) Firefox/142.0"),
      trusted: true,
      lastMfaAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
    }
  });
  const revokedAllDevices = await request(app)
    .post("/api/v1/auth/devices/revoke-all")
    .set("Cookie", `${sessionCookie}; ${csrfCookie}`)
    .set("X-CSRF-Token", rotatedCsrfToken)
    .send({});
  assert.equal(revokedAllDevices.status, 403);

  const disableStep = loginStep + 1n;
  const disabled = await request(app)
    .post("/api/v1/auth/mfa/disable")
    .set("Cookie", `${sessionCookie}; ${csrfCookie}`)
    .set("X-CSRF-Token", rotatedCsrfToken)
    .send({
      currentPassword: password,
      totpCode: generateTotpCode(secret, disableStep)
    });
  assert.equal(disabled.status, 403);
  assert.ok(await prisma.authSession.count({ where: { userId: user.id, revokedAt: null } }));
  const disabledUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  assert.notEqual(disabledUser.totpEnabledAt, null);
  assert.notEqual(disabledUser.totpSecretCiphertext, null);
});

test("rate limit sayaçları farklı uygulama süreçleri arasında atomik paylaşılır", async () => {
  const namespace = `integration-${randomUUID()}`;
  const key = "203.0.113.9";
  const firstStore = new DatabaseRateLimitStore(namespace);
  const secondStore = new DatabaseRateLimitStore(namespace);
  const options = { windowMs: 60_000 } as RateLimitOptions;
  firstStore.init(options);
  secondStore.init(options);

  const increments = await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      (index % 2 === 0 ? firstStore : secondStore).increment(key)
    )
  );
  assert.deepEqual(
    increments.map(({ totalHits }) => totalHits).sort((left, right) => left - right),
    Array.from({ length: 50 }, (_, index) => index + 1)
  );
  assert.ok(increments.every(({ resetTime }) => resetTime instanceof Date));

  await Promise.all([firstStore.decrement(key), secondStore.decrement(key)]);
  const third = await secondStore.increment(key);
  assert.equal(third.totalHits, 49);

  await secondStore.resetKey(key);
  const reset = await firstStore.increment(key);
  assert.equal(reset.totalHits, 1);
  await firstStore.resetKey(key);
});

test("public uygunluk kotası iki bağımsız uygulama örneğinde ortak tüketilir", async (context) => {
  const keyHash = hashRateLimitKey("public-availability-ip", "127.0.0.1");
  await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
  context.after(async () => {
    await prisma.rateLimitBucket.deleteMany({ where: { keyHash } });
  });

  const createAvailabilityApp = () =>
    createApp((application) => {
      application.get(
        "/api/v1/test-public-availability",
        createPublicAvailabilityLimiter(),
        (_req, res) => res.status(204).end()
      );
    });
  const firstApp = createAvailabilityApp();
  const secondApp = createAvailabilityApp();
  const responses = [];

  for (let index = 0; index < 31; index += 1) {
    responses.push(
      await request(index % 2 === 0 ? firstApp : secondApp).get("/api/v1/test-public-availability")
    );
  }

  assert.equal(
    responses.slice(0, 30).every((response) => response.status === 204),
    true
  );
  assert.equal(responses[30]?.status, 429);
  assert.equal(responses[30]?.body.message, "Çok fazla uygunluk sorgusu yaptınız.");
});

test("retention gerçek PostgreSQL üzerinde süre, batch, izolasyon ve audit toplamını korur", async (context) => {
  const marker = `retention-${randomUUID()}`;
  const now = new Date();
  const expiredAt = new Date(now.valueOf() - 60 * 24 * 60 * 60 * 1_000);
  const futureWeddingStart = new Date(now.valueOf() + 60 * 24 * 60 * 60 * 1_000);
  const futureWeddingEnd = new Date(futureWeddingStart.valueOf() + 4 * 60 * 60 * 1_000);
  const auditStartedAt = new Date(Date.now() - 1_000);
  const auditLogIds: string[] = [];
  const venue = await prisma.venue.create({
    data: { slug: marker, name: `Retention ${marker}` }
  });
  const packageRecord = await prisma.package.create({
    data: { code: marker, name: `Retention ${marker}`, priceCents: 100_000 }
  });
  const expiredBucketKey = marker.replaceAll("-", "").padEnd(64, "0").slice(0, 64);
  const freshBucketKey = `${expiredBucketKey.slice(0, 63)}1`;

  context.after(async () => {
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { id: { in: auditLogIds } },
          { action: "maintenance.data_retention", createdAt: { gte: auditStartedAt } }
        ]
      }
    });
    await prisma.wedding.deleteMany({
      where: { application: { referenceCode: { startsWith: marker } } }
    });
    await prisma.bookingApplication.deleteMany({
      where: { referenceCode: { startsWith: marker } }
    });
    await prisma.user.deleteMany({ where: { username: { startsWith: marker } } });
    await prisma.rateLimitBucket.deleteMany({
      where: { keyHash: { in: [expiredBucketKey, freshBucketKey] } }
    });
    await prisma.package.deleteMany({ where: { id: packageRecord.id } });
    await prisma.venue.deleteMany({ where: { id: venue.id } });
  });

  const createApplication = (
    suffix: string,
    overrides: Partial<Prisma.BookingApplicationUncheckedCreateInput> = {}
  ) => {
    const id = randomUUID();
    return prisma.bookingApplication.create({
      data: {
        id,
        ...buildBookingApplicationPiiData(
          id,
          {
            brideFirstName: "Retention",
            brideLastName: "Gelin",
            bridePhone: "+905551234567",
            groomFirstName: "Retention",
            groomLastName: "Damat",
            groomPhone: "+905559876543",
            primaryEmail: `${suffix}-${marker}@example.com`,
            note: null,
            rejectionReason: null,
            customVenueName: null
          },
          1,
          "encrypted"
        ),
        referenceCode: `${marker}-${suffix}`,
        source: "PUBLIC_FORM",
        status: "IPTAL_EDILDI",
        primaryContact: "GELIN",
        weddingStartsAt: futureWeddingStart,
        weddingEndsAt: futureWeddingEnd,
        venueId: venue.id,
        packageId: packageRecord.id,
        packageCodeSnapshot: packageRecord.code,
        packageNameSnapshot: packageRecord.name,
        packagePriceCents: packageRecord.priceCents,
        totalPriceCents: packageRecord.priceCents,
        paymentMethod: "CASH",
        payableNowCents: packageRecord.priceCents,
        paymentFlowExpiredAt: expiredAt,
        privacyConsentAt: expiredAt,
        updatedAt: expiredAt,
        ...overrides
      }
    });
  };

  const expiredPublicApplications = await Promise.all([
    createApplication("public-expired-1", { updatedAt: new Date(expiredAt.valueOf() - 3_000) }),
    createApplication("public-expired-2", { updatedAt: new Date(expiredAt.valueOf() - 2_000) }),
    createApplication("public-expired-3", { updatedAt: new Date(expiredAt.valueOf() - 1_000) })
  ]);
  const freshPublicApplication = await createApplication("public-fresh", { updatedAt: now });
  const archivedApplication = await createApplication("archived-expired", {
    source: "ADMIN",
    deletedAt: expiredAt
  });
  const freshArchivedApplication = await createApplication("archived-fresh", {
    source: "ADMIN",
    deletedAt: now,
    updatedAt: now
  });
  const archivedWeddingApplication = await createApplication("wedding-expired", {
    source: "ADMIN"
  });
  const freshWeddingApplication = await createApplication("wedding-fresh", {
    source: "ADMIN",
    updatedAt: now
  });
  const archivedCustomer = await prisma.user.create({
    data: {
      username: `${marker}-customer-expired`,
      passwordHash: "retention-integration-not-for-authentication",
      role: "MUSTERI",
      status: "ACTIVE",
      mustChangePassword: false,
      passwordChangedAt: expiredAt
    }
  });
  const freshCustomer = await prisma.user.create({
    data: {
      username: `${marker}-customer-fresh`,
      passwordHash: "retention-integration-not-for-authentication",
      role: "MUSTERI",
      status: "ACTIVE",
      mustChangePassword: false,
      passwordChangedAt: now
    }
  });
  const archivedWeddingId = randomUUID();
  const archivedWedding = await prisma.wedding.create({
    data: {
      id: archivedWeddingId,
      ...buildWeddingPiiData(
        archivedWeddingId,
        {
          brideFirstName: "Retention",
          brideLastName: "Gelin",
          bridePhone: "+905551234567",
          groomFirstName: "Retention",
          groomLastName: "Damat",
          groomPhone: "+905559876543",
          primaryEmail: `wedding-expired-${marker}@example.com`,
          note: null
        },
        1,
        "encrypted"
      ),
      applicationId: archivedWeddingApplication.id,
      customerUserId: archivedCustomer.id,
      primaryContact: "GELIN",
      startsAt: futureWeddingStart,
      endsAt: futureWeddingEnd,
      venueId: venue.id,
      packageSummary: { name: packageRecord.name },
      deletedAt: expiredAt
    }
  });
  const freshWeddingId = randomUUID();
  const freshWedding = await prisma.wedding.create({
    data: {
      id: freshWeddingId,
      ...buildWeddingPiiData(
        freshWeddingId,
        {
          brideFirstName: "Retention",
          brideLastName: "Gelin",
          bridePhone: "+905551234568",
          groomFirstName: "Retention",
          groomLastName: "Damat",
          groomPhone: "+905559876544",
          primaryEmail: `wedding-fresh-${marker}@example.com`,
          note: null
        },
        1,
        "encrypted"
      ),
      applicationId: freshWeddingApplication.id,
      customerUserId: freshCustomer.id,
      primaryContact: "GELIN",
      startsAt: new Date(futureWeddingStart.valueOf() + 24 * 60 * 60 * 1_000),
      endsAt: new Date(futureWeddingEnd.valueOf() + 24 * 60 * 60 * 1_000),
      venueId: venue.id,
      packageSummary: { name: packageRecord.name },
      deletedAt: now
    }
  });
  await prisma.rateLimitBucket.createMany({
    data: [
      { keyHash: expiredBucketKey, hits: 1, expiresAt: expiredAt },
      { keyHash: freshBucketKey, hits: 1, expiresAt: new Date(now.valueOf() + 60_000) }
    ]
  });

  let observedIsolation: string | undefined;
  const retentionClient = {
    $transaction: async (
      operation: (transaction: Prisma.TransactionClient) => Promise<unknown>,
      options: { isolationLevel: Prisma.TransactionIsolationLevel }
    ) =>
      prisma.$transaction(async (transaction) => {
        const isolationRows = await transaction.$queryRaw<Array<{ isolation: string }>>`
          SELECT current_setting('transaction_isolation') AS "isolation"
        `;
        observedIsolation = isolationRows[0]?.isolation;
        return operation(transaction);
      }, options)
  } as unknown as PrismaClient;
  const result = await runDataRetentionBatch(
    retentionClient,
    {
      publicApplicationDays: 30,
      archivedApplicationDays: 30,
      archivedWeddingDays: 30,
      securityArtifactDays: 30,
      batchSize: 2
    },
    now
  );

  assert.equal(observedIsolation, "serializable");
  assert.deepEqual(result, {
    rateLimitBuckets: 1,
    authSessions: 0,
    trustedDevices: 0,
    passwordSetupTokens: 0,
    publicApplications: 2,
    archivedApplications: 2,
    archivedWeddings: 1,
    customerUsers: 1
  });
  assert.equal(
    await prisma.bookingApplication.count({
      where: { id: { in: expiredPublicApplications.map(({ id }) => id) } }
    }),
    1
  );
  assert.equal(
    await prisma.bookingApplication.count({
      where: { id: { in: [freshPublicApplication.id, freshArchivedApplication.id] } }
    }),
    2
  );
  assert.equal(await prisma.bookingApplication.count({ where: { id: archivedApplication.id } }), 0);
  assert.equal(await prisma.wedding.count({ where: { id: archivedWedding.id } }), 0);
  assert.equal(await prisma.user.count({ where: { id: archivedCustomer.id } }), 0);
  assert.equal(await prisma.wedding.count({ where: { id: freshWedding.id } }), 1);
  assert.equal(await prisma.user.count({ where: { id: freshCustomer.id } }), 1);
  assert.equal(await prisma.rateLimitBucket.count({ where: { keyHash: expiredBucketKey } }), 0);
  assert.equal(await prisma.rateLimitBucket.count({ where: { keyHash: freshBucketKey } }), 1);

  const auditLog = await prisma.auditLog.findFirstOrThrow({
    where: { action: "maintenance.data_retention", createdAt: { gte: auditStartedAt } },
    orderBy: { createdAt: "desc" }
  });
  auditLogIds.push(auditLog.id);
  assert.deepEqual(auditLog.metadata, { deleted: result });

  const retentionIndexes = await prisma.$queryRaw<Array<{ indexName: string }>>`
    SELECT indexname AS "indexName"
    FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'auth_sessions_retention_expires_created_idx',
        'auth_sessions_retention_revoked_created_idx',
        'password_setup_tokens_retention_expires_created_idx',
        'password_setup_tokens_retention_used_created_idx',
        'password_setup_tokens_retention_revoked_created_idx',
        'booking_applications_retention_public_updated_idx',
        'booking_applications_retention_archived_idx',
        'weddings_retention_archived_idx'
      )
  `;
  assert.equal(retentionIndexes.length, 8);
});
