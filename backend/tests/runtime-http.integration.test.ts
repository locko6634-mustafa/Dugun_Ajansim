import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { assertSafeLocalTestDatabase } from "../src/scripts/testDatabaseGuard.js";

assertSafeLocalTestDatabase();

const ownerDatabaseUrl = process.env.DATABASE_URL;
const runtimeDatabaseUrl = process.env.RUNTIME_DATABASE_URL;
if (!ownerDatabaseUrl || !runtimeDatabaseUrl) {
  throw new Error("DATABASE_URL ve RUNTIME_DATABASE_URL, runtime HTTP testi için zorunludur.");
}

const ownerUrl = new URL(ownerDatabaseUrl);
const runtimeUrl = new URL(runtimeDatabaseUrl);
if (
  ownerUrl.hostname !== runtimeUrl.hostname ||
  ownerUrl.port !== runtimeUrl.port ||
  ownerUrl.pathname !== runtimeUrl.pathname ||
  ownerUrl.username === runtimeUrl.username
) {
  throw new Error(
    "Runtime HTTP testi ayrı bir rolle aynı güvenli test veritabanını kullanmalıdır."
  );
}

process.env.DATABASE_URL = runtimeDatabaseUrl;

const [appModule, prismaModule, cryptoModule, rateLimitModule] = await Promise.all([
  import("../src/app.js"),
  import("../src/config/prisma.js"),
  import("../src/utils/crypto.js"),
  import("../src/middlewares/databaseRateLimitStore.js")
]);

const ownerPrisma = new PrismaClient({ datasourceUrl: ownerDatabaseUrl });
const applicationPrisma = prismaModule.prisma;
const application = appModule.createApp();

await ownerPrisma.$executeRaw`SELECT public.set_rls_enforcement(TRUE)`;

after(async () => {
  await applicationPrisma.$disconnect();
  await ownerPrisma.$disconnect();
});

test("runtime rolü HTTP login ve korumalı route RLS bağlamlarını uçtan uca korur", async (context) => {
  const marker = randomUUID();
  const username = `runtime-http-${marker}`;
  const password = `Runtime-Http-${marker}!`;
  const passwordHash = await cryptoModule.hashPassword(password);
  const user = await ownerPrisma.user.create({
    data: {
      username,
      passwordHash,
      role: "ADMIN",
      mustChangePassword: false
    }
  });
  const rateLimitKeyHashes = [
    rateLimitModule.hashRateLimitKey("auth-login-ip", "127.0.0.1"),
    rateLimitModule.hashRateLimitKey("auth-login-ip", "auth-login-ip:127.0.0.1"),
    rateLimitModule.hashRateLimitKey("auth-login-account", username),
    rateLimitModule.hashRateLimitKey("auth-login-account", `auth-login-account:${username}`)
  ];

  context.after(async () => {
    await ownerPrisma.authSession.deleteMany({ where: { userId: user.id } });
    await ownerPrisma.auditLog.deleteMany({
      where: { OR: [{ actorUserId: user.id }, { targetId: user.id }] }
    });
    await ownerPrisma.user.deleteMany({ where: { id: user.id } });
    await ownerPrisma.rateLimitBucket.deleteMany({
      where: { keyHash: { in: rateLimitKeyHashes } }
    });
  });

  await request(application).get("/api/v1/admin/venue-managers").expect(401);

  const agent = request.agent(application);
  const loginResponse = await agent.post("/api/v1/auth/login").send({
    username,
    password,
    remember: false
  });
  assert.equal(loginResponse.status, 200);
  assert.equal(loginResponse.body.data.role, "ADMIN");

  const adminResponse = await agent.get("/api/v1/admin/venue-managers");
  assert.equal(adminResponse.status, 200);
  assert.equal(Array.isArray(adminResponse.body.data), true);

  await agent.get("/api/v1/operations/staff").expect(403);
});

test("runtime rolü public başvuruyu RLS bağlamıyla atomik oluşturur", async (context) => {
  const marker = randomUUID();
  const idempotencyKey = randomUUID();
  const rejectedIdempotencyKey = randomUUID();
  const venue = await ownerPrisma.venue.create({
    data: {
      slug: `runtime-public-${marker}`,
      name: `Runtime Public ${marker}`,
      displayName: "Runtime Public",
      isPartner: true,
      isActive: true
    }
  });
  const packageRecord = await ownerPrisma.package.create({
    data: {
      code: `runtime-public-${marker}`,
      name: `Runtime Public ${marker}`,
      priceCents: 200_000
    }
  });
  const publicReadPolicies = await ownerPrisma.$queryRaw<Array<{ policyname: string }>>`
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'booking_applications'
      AND cmd = 'SELECT'
      AND policyname = 'booking_applications_public_read'
  `;
  assert.equal(publicReadPolicies.length, 1);

  context.after(async () => {
    const applications = await ownerPrisma.bookingApplication.findMany({
      where: { idempotencyKey: { in: [idempotencyKey, rejectedIdempotencyKey] } },
      select: { id: true }
    });
    await ownerPrisma.auditLog.deleteMany({
      where: { targetId: { in: applications.map(({ id }) => id) } }
    });
    await ownerPrisma.bookingApplication.deleteMany({
      where: { idempotencyKey: { in: [idempotencyKey, rejectedIdempotencyKey] } }
    });
    await ownerPrisma.package.deleteMany({ where: { id: packageRecord.id } });
    await ownerPrisma.venue.deleteMany({ where: { id: venue.id } });
  });

  const publicAgent = request.agent(application);
  const bookingBody = {
    brideFirstName: "Sentetik",
    brideLastName: "Gelin",
    bridePhone: "05550000001",
    groomFirstName: "Sentetik",
    groomLastName: "Damat",
    groomPhone: "05550000002",
    primaryContact: "GELIN",
    primaryEmail: `runtime-public-${marker}@example.invalid`,
    weddingDate: "2099-08-10",
    startTime: "19:00",
    endTime: "23:00",
    endsNextDay: false,
    venueId: venue.id,
    packageCode: packageRecord.code,
    serviceCodes: [],
    paymentMethod: "CASH",
    privacyConsent: true,
    marketingConsent: false
  };
  const response = await publicAgent
    .post("/api/v1/booking-applications")
    .set("Idempotency-Key", idempotencyKey)
    .set("X-Booking-Elapsed-Ms", "5000")
    .send(bookingBody);

  assert.equal(response.status, 201);
  assert.equal(response.body.success, true);
  assert.equal(typeof response.body.data.referenceCode, "string");
  assert.equal(response.body.data.packageCodeSnapshot, packageRecord.code);
  assert.equal(response.body.data.packageNameSnapshot, packageRecord.name);
  assert.equal(response.body.data.packagePriceCents, packageRecord.priceCents);
  assert.deepEqual(response.body.data.services, []);
  assert.equal(await ownerPrisma.bookingApplication.count({ where: { idempotencyKey } }), 1);
  assert.equal(
    await ownerPrisma.auditLog.count({
      where: { action: "booking.created", targetId: response.body.data.id }
    }),
    1
  );
  assert.equal(
    await ownerPrisma.bookingApplicationService.count({
      where: { applicationId: response.body.data.id }
    }),
    0
  );

  const duplicateResponse = await publicAgent
    .post("/api/v1/booking-applications")
    .set("Idempotency-Key", idempotencyKey)
    .set("X-Booking-Elapsed-Ms", "5000")
    .send(bookingBody);
  assert.equal(duplicateResponse.status, 201);
  assert.equal(duplicateResponse.body.data.id, response.body.data.id);
  assert.equal(await ownerPrisma.bookingApplication.count({ where: { idempotencyKey } }), 1);

  const rejectedResponse = await publicAgent
    .post("/api/v1/booking-applications")
    .set("Idempotency-Key", rejectedIdempotencyKey)
    .set("X-Booking-Elapsed-Ms", "5000")
    .send({ ...bookingBody, serviceCodes: [`missing-${marker}`] });
  assert.equal(rejectedResponse.status, 400);
  assert.equal(
    await ownerPrisma.bookingApplication.count({
      where: { idempotencyKey: rejectedIdempotencyKey }
    }),
    0
  );
});
