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
  throw new Error("Runtime HTTP testi ayrı bir rolle aynı güvenli test veritabanını kullanmalıdır.");
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
