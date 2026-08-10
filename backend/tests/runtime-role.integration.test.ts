import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { prisma as ownerPrisma } from "../src/config/prisma.js";
import { assertSafeLocalTestDatabase } from "../src/scripts/testDatabaseGuard.js";

assertSafeLocalTestDatabase();

const runtimeDatabaseUrl = process.env.RUNTIME_DATABASE_URL;
const runtimeDatabaseRole = process.env.RUNTIME_DATABASE_ROLE;
if (!runtimeDatabaseUrl || !runtimeDatabaseRole) {
  throw new Error(
    "RUNTIME_DATABASE_URL ve RUNTIME_DATABASE_ROLE gerçek runtime rolü testi için zorunludur."
  );
}

const runtimePrisma = new PrismaClient({ datasourceUrl: runtimeDatabaseUrl });

const expectPermissionDenied = async (operation: () => Promise<unknown>): Promise<void> => {
  await assert.rejects(operation, (error: unknown) => {
    const serialized = JSON.stringify(error);
    return (
      serialized.includes("42501") ||
      serialized.toLowerCase().includes("permission denied") ||
      serialized.toLowerCase().includes("must be owner")
    );
  });
};

test("sentetik runtime rolü uygulama CRUD yetkilerini korur ve yönetim işlemlerini reddeder", async (context) => {
  const marker = randomUUID();
  const keyHash = marker.replaceAll("-", "").padEnd(64, "0");
  let auditLogId: string | undefined;
  context.after(async () => {
    await ownerPrisma.$executeRawUnsafe('DROP TABLE IF EXISTS public."runtime_role_forbidden_ddl"');
    if (auditLogId) await ownerPrisma.auditLog.deleteMany({ where: { id: auditLogId } });
    await ownerPrisma.rateLimitBucket.deleteMany({ where: { keyHash } });
    await runtimePrisma.$disconnect();
    await ownerPrisma.$disconnect();
  });

  const roleState = await ownerPrisma.$queryRaw<
    Array<{
      superuser: boolean;
      createDatabase: boolean;
      createRole: boolean;
      replication: boolean;
      bypassRls: boolean;
    }>
  >`
    SELECT
      rolsuper AS "superuser",
      rolcreatedb AS "createDatabase",
      rolcreaterole AS "createRole",
      rolreplication AS "replication",
      rolbypassrls AS "bypassRls"
    FROM pg_catalog.pg_roles
    WHERE rolname = ${runtimeDatabaseRole}
  `;
  assert.deepEqual(roleState, [
    {
      superuser: false,
      createDatabase: false,
      createRole: false,
      replication: false,
      bypassRls: false
    }
  ]);

  await runtimePrisma.rateLimitBucket.create({
    data: { keyHash, hits: 1, expiresAt: new Date(Date.now() + 60_000) }
  });
  await runtimePrisma.rateLimitBucket.update({ where: { keyHash }, data: { hits: 2 } });
  assert.equal(
    (await runtimePrisma.rateLimitBucket.findUniqueOrThrow({ where: { keyHash } })).hits,
    2
  );
  await runtimePrisma.rateLimitBucket.delete({ where: { keyHash } });

  const auditLog = await runtimePrisma.auditLog.create({
    data: {
      action: "runtime-role.integration",
      targetType: "RuntimeRoleTest",
      targetId: marker,
      correlationId: marker
    }
  });
  auditLogId = auditLog.id;
  assert.equal(
    (await runtimePrisma.auditLog.findUniqueOrThrow({ where: { id: auditLog.id } })).action,
    "runtime-role.integration"
  );

  await expectPermissionDenied(() =>
    runtimePrisma.$executeRawUnsafe(
      'CREATE TABLE public."runtime_role_forbidden_ddl" ("id" integer)'
    )
  );
  await expectPermissionDenied(
    () =>
      runtimePrisma.$executeRaw`UPDATE "audit_logs" SET "action" = 'forbidden' WHERE "id" = ${auditLog.id}`
  );
  await expectPermissionDenied(
    () => runtimePrisma.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${auditLog.id}`
  );
  await expectPermissionDenied(() =>
    runtimePrisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs"')
  );
  await expectPermissionDenied(() =>
    runtimePrisma.$queryRawUnsafe('SELECT migration_name FROM "_prisma_migrations" LIMIT 1')
  );
  await expectPermissionDenied(() =>
    runtimePrisma.$queryRawUnsafe("SELECT enabled FROM public.rls_enforcement_state")
  );
  await expectPermissionDenied(() =>
    runtimePrisma.$queryRawUnsafe("SELECT public.set_rls_enforcement(false)")
  );

  assert.equal(
    await ownerPrisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.runtime_role_forbidden_ddl') IS NOT NULL AS "exists"
    `.then((rows) => rows[0]?.exists),
    false
  );
  assert.equal(
    (await ownerPrisma.auditLog.findUniqueOrThrow({ where: { id: auditLog.id } })).action,
    "runtime-role.integration"
  );
});
