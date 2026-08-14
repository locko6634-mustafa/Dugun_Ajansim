import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Prisma, PrismaClient } from "@prisma/client";
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

after(async () => {
  await runtimePrisma.$disconnect();
  await ownerPrisma.$disconnect();
});

type RuntimeContext = {
  actorRole: "admin" | "operations" | "montage" | "customer" | "public" | "auth" | "maintenance";
  actorUserId?: string;
  venueId?: string;
  purpose: string;
  resourceId?: string;
  applicationId?: string;
};

const withRuntimeContext = <Result>(
  securityContext: RuntimeContext,
  operation: (transaction: Prisma.TransactionClient) => Promise<Result>
): Promise<Result> =>
  runtimePrisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(Prisma.sql`
      SELECT
        set_config('app.actor_role', ${securityContext.actorRole}, true),
        set_config('app.actor_user_id', ${securityContext.actorUserId ?? ""}, true),
        set_config('app.venue_id', ${securityContext.venueId ?? ""}, true),
        set_config('app.purpose', ${securityContext.purpose}, true),
        set_config('app.resource_id', ${securityContext.resourceId ?? ""}, true),
        set_config('app.application_id', ${securityContext.applicationId ?? ""}, true)
    `);
    return operation(transaction);
  });

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

  const auditLog = await withRuntimeContext(
    { actorRole: "admin", purpose: "http.admin" },
    (transaction) =>
      transaction.auditLog.create({
        data: {
          action: "runtime-role.integration",
          targetType: "RuntimeRoleTest",
          targetId: marker,
          correlationId: marker
        }
      })
  );
  auditLogId = auditLog.id;
  assert.equal(
    await withRuntimeContext({ actorRole: "admin", purpose: "http.admin" }, (transaction) =>
      transaction.auditLog
        .findUniqueOrThrow({ where: { id: auditLog.id } })
        .then((row) => row.action)
    ),
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

test("admin dışı HTTP bağlamları audit kaydı ekler ancak kaydı okuyamaz", async (context) => {
  const marker = randomUUID();
  const actorContexts: RuntimeContext[] = [
    { actorRole: "auth", purpose: "http.auth" },
    { actorRole: "operations", purpose: "http.operations" },
    { actorRole: "montage", purpose: "http.montage" },
    { actorRole: "customer", purpose: "http.customer" },
    { actorRole: "public", purpose: "http.public" }
  ];
  const targetIds = actorContexts.map(({ actorRole }) => `${marker}:${actorRole}`);

  context.after(async () => {
    await ownerPrisma.auditLog.deleteMany({
      where: { targetType: "RuntimeAuditInsertTest", targetId: { in: targetIds } }
    });
  });

  for (const [index, actorContext] of actorContexts.entries()) {
    const targetId = targetIds[index]!;
    const inserted = await withRuntimeContext(actorContext, (transaction) =>
      transaction.auditLog.createMany({
        data: {
          action: "runtime-role.audit-insert",
          targetType: "RuntimeAuditInsertTest",
          targetId,
          correlationId: marker
        }
      })
    );
    assert.equal(inserted.count, 1);
    assert.equal(
      await withRuntimeContext(actorContext, (transaction) =>
        transaction.auditLog.findFirst({ where: { targetId } })
      ),
      null
    );
  }

  assert.equal(
    await ownerPrisma.auditLog.count({
      where: { targetType: "RuntimeAuditInsertTest", targetId: { in: targetIds } }
    }),
    actorContexts.length
  );
});

test("RLS enforcement salon, montaj, müşteri, public, auth ve maintenance bağlamlarını ayırır", async (context) => {
  const marker = randomUUID();
  const startsAt = new Date("2026-09-20T15:00:00Z");
  const endsAt = new Date("2026-09-20T18:00:00Z");
  const fixture = await ownerPrisma.$transaction(async (transaction) => {
    const packageRecord = await transaction.package.create({
      data: {
        code: `rls-${marker}`,
        name: `RLS ${marker}`,
        priceCents: 100_000
      }
    });
    const venues = await Promise.all(
      ["a", "b", "c"].map((suffix) =>
        transaction.venue.create({
          data: {
            slug: `rls-${suffix}-${marker}`,
            name: `RLS ${suffix.toUpperCase()} ${marker}`,
            isPartner: true,
            isActive: true
          }
        })
      )
    );
    const managers = await Promise.all(
      venues.map((venue, index) =>
        transaction.user.create({
          data: {
            username: `rls-manager-${index}-${marker}`,
            passwordHash: "synthetic-runtime-role-hash",
            role: "SALON_YETKILISI",
            mustChangePassword: false,
            venueId: venue.id,
            managedVenueAssignments: {
              create: (index === 0 ? venues.slice(0, 2) : [venue]).map((managedVenue) => ({
                venueId: managedVenue.id
              }))
            }
          }
        })
      )
    );
    const customers = await Promise.all(
      venues.map((_venue, index) =>
        transaction.user.create({
          data: {
            username: `rls-customer-${index}-${marker}`,
            passwordHash: "synthetic-runtime-role-hash",
            role: "MUSTERI",
            mustChangePassword: false
          }
        })
      )
    );
    const montageUser = await transaction.user.create({
      data: {
        username: `rls-montage-${marker}`,
        passwordHash: "synthetic-runtime-role-hash",
        role: "MONTAJCI",
        mustChangePassword: false
      }
    });
    const applications = [];
    const weddings = [];
    const deliveries = [];
    const staff = [];
    const assignments = [];
    for (const [index, venue] of venues.entries()) {
      const application = await transaction.bookingApplication.create({
        data: {
          referenceCode: `RLS-${index}-${marker}`,
          idempotencyKey: randomUUID(),
          idempotencyFingerprint: `${index}${marker.replaceAll("-", "")}`.padEnd(64, "0"),
          source: "PUBLIC_FORM",
          status: "ONAY_BEKLIYOR",
          brideFirstName: "Rls",
          brideLastName: `Bride${index}`,
          bridePhone: `+90555000000${index}`,
          groomFirstName: "Rls",
          groomLastName: `Groom${index}`,
          groomPhone: `+90555000001${index}`,
          primaryContact: "GELIN",
          primaryEmail: `rls-${index}-${marker}@example.invalid`,
          weddingStartsAt: new Date(startsAt.valueOf() + index * 24 * 60 * 60 * 1000),
          weddingEndsAt: new Date(endsAt.valueOf() + index * 24 * 60 * 60 * 1000),
          venueId: venue.id,
          packageId: packageRecord.id,
          packageCodeSnapshot: packageRecord.code,
          packageNameSnapshot: packageRecord.name,
          packagePriceCents: packageRecord.priceCents,
          totalPriceCents: packageRecord.priceCents,
          paymentMethod: "CASH",
          payableNowCents: packageRecord.priceCents,
          privacyConsentAt: new Date("2026-08-10T00:00:00Z"),
          paymentFlowExpiresAt: new Date("2026-09-21T00:00:00Z")
        }
      });
      applications.push(application);
      const wedding = await transaction.wedding.create({
        data: {
          applicationId: application.id,
          customerUserId: customers[index]!.id,
          brideFirstName: application.brideFirstName,
          brideLastName: application.brideLastName,
          bridePhone: application.bridePhone,
          groomFirstName: application.groomFirstName,
          groomLastName: application.groomLastName,
          groomPhone: application.groomPhone,
          primaryContact: application.primaryContact,
          primaryEmail: application.primaryEmail,
          startsAt: application.weddingStartsAt,
          endsAt: application.weddingEndsAt,
          venueId: venue.id,
          packageSummary: { name: packageRecord.name }
        }
      });
      weddings.push(wedding);
      deliveries.push(
        await transaction.delivery.create({
          data: {
            weddingId: wedding.id,
            dueDate: new Date("2026-10-20T00:00:00Z")
          }
        })
      );
      const staffMember = await transaction.staff.create({
        data: {
          firstName: "Rls",
          lastName: `Staff${index}`,
          phone: `+90555000002${index}`,
          specialties: ["PHOTOGRAPHY"],
          venueId: venue.id,
          venueAssignments: {
            create: (index === 0 ? venues.slice(0, 2) : [venue]).map((staffVenue) => ({
              venueId: staffVenue.id
            }))
          }
        }
      });
      staff.push(staffMember);
      assignments.push(
        await transaction.weddingAssignment.create({
          data: {
            weddingId: wedding.id,
            staffId: staffMember.id,
            specialty: "PHOTOGRAPHY"
          }
        })
      );
    }
    return {
      packageRecord,
      venues,
      managers,
      montageUser,
      customers,
      applications,
      weddings,
      deliveries,
      staff,
      assignments
    };
  });

  context.after(async () => {
    await ownerPrisma.delivery.deleteMany({
      where: { id: { in: fixture.deliveries.map(({ id }) => id) } }
    });
    await ownerPrisma.wedding.deleteMany({
      where: { id: { in: fixture.weddings.map(({ id }) => id) } }
    });
    await ownerPrisma.bookingApplication.deleteMany({
      where: { id: { in: fixture.applications.map(({ id }) => id) } }
    });
    await ownerPrisma.staff.deleteMany({
      where: { id: { in: fixture.staff.map(({ id }) => id) } }
    });
    await ownerPrisma.user.deleteMany({
      where: {
        id: {
          in: [...fixture.managers, fixture.montageUser, ...fixture.customers].map(({ id }) => id)
        }
      }
    });
    await ownerPrisma.package.deleteMany({ where: { id: fixture.packageRecord.id } });
    await ownerPrisma.venue.deleteMany({
      where: { id: { in: fixture.venues.map(({ id }) => id) } }
    });
  });

  assert.equal(await runtimePrisma.venue.count(), 0, "Eksik bağlam fail-closed olmalıdır.");

  const operationsContext: RuntimeContext = {
    actorRole: "operations",
    actorUserId: fixture.managers[0]!.id,
    venueId: fixture.venues[0]!.id,
    purpose: "http.operations"
  };
  assert.deepEqual(
    await withRuntimeContext(operationsContext, (transaction) =>
      transaction.wedding.findMany({ select: { id: true }, orderBy: { id: "asc" } })
    ),
    fixture.weddings
      .slice(0, 2)
      .map(({ id }) => ({ id }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
  assert.deepEqual(
    await withRuntimeContext(operationsContext, (transaction) =>
      transaction.staffVenueAssignment.findMany({
        where: { staffId: fixture.staff[0]!.id },
        select: { venueId: true },
        orderBy: { venueId: "asc" }
      })
    ),
    fixture.venues
      .slice(0, 2)
      .map(({ id }) => ({ venueId: id }))
      .sort((left, right) => left.venueId.localeCompare(right.venueId))
  );
  assert.equal(
    await withRuntimeContext(operationsContext, (transaction) =>
      transaction.staffVenueAssignment.deleteMany({
        where: { staffId: fixture.staff[0]!.id }
      })
    ).then(({ count }) => count),
    0
  );
  assert.equal(
    await withRuntimeContext(operationsContext, (transaction) =>
      transaction.staff.updateMany({
        where: { id: fixture.staff[2]!.id },
        data: { firstName: "Forbidden" }
      })
    ).then(({ count }) => count),
    0
  );

  const montageContext: RuntimeContext = {
    actorRole: "montage",
    actorUserId: fixture.montageUser.id,
    purpose: "http.montage"
  };
  assert.deepEqual(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.wedding.findMany({ select: { id: true }, orderBy: { id: "asc" } })
    ),
    fixture.weddings
      .map(({ id }) => ({ id }))
      .sort((left, right) => left.id.localeCompare(right.id))
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) => transaction.delivery.count()),
    fixture.deliveries.length
  );
  assert.deepEqual(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.venue.findMany({
        where: { id: { in: fixture.venues.map(({ id }) => id) } },
        select: { id: true },
        orderBy: { id: "asc" }
      })
    ),
    fixture.venues.map(({ id }) => ({ id })).sort((left, right) => left.id.localeCompare(right.id))
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) => transaction.staff.count()),
    fixture.staff.length
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.weddingAssignment.count()
    ),
    fixture.assignments.length
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.bookingApplication.count()
    ),
    0
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) => transaction.user.count()),
    1
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.wedding.updateMany({
        where: { id: fixture.weddings[0]!.id },
        data: { startsAt: new Date("2026-09-21T15:00:00Z") }
      })
    ).then(({ count }) => count),
    0
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.staff.updateMany({
        where: { id: fixture.staff[0]!.id },
        data: { firstName: "Forbidden" }
      })
    ).then(({ count }) => count),
    0
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.weddingAssignment.deleteMany({
        where: { id: fixture.assignments[0]!.id }
      })
    ).then(({ count }) => count),
    0
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.delivery.updateMany({
        where: { id: fixture.deliveries[0]!.id },
        data: { status: "KONTROL" }
      })
    ).then(({ count }) => count),
    1
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.deliveryStatusHistory.createMany({
        data: {
          deliveryId: fixture.deliveries[0]!.id,
          fromStatus: "HAZIRLANIYOR",
          toStatus: "KONTROL",
          actorUserId: fixture.montageUser.id
        }
      })
    ).then(({ count }) => count),
    1
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.deliveryStatusHistory.count()
    ),
    0
  );
  assert.equal(
    await withRuntimeContext(montageContext, (transaction) =>
      transaction.delivery.deleteMany({ where: { id: fixture.deliveries[0]!.id } })
    ).then(({ count }) => count),
    0
  );

  const customerContext: RuntimeContext = {
    actorRole: "customer",
    actorUserId: fixture.customers[0]!.id,
    purpose: "http.customer"
  };
  assert.deepEqual(
    await withRuntimeContext(customerContext, (transaction) =>
      transaction.wedding.findMany({ select: { id: true } })
    ),
    [{ id: fixture.weddings[0]!.id }]
  );
  assert.deepEqual(
    await withRuntimeContext(customerContext, (transaction) =>
      transaction.delivery.findMany({ select: { id: true } })
    ),
    [{ id: fixture.deliveries[0]!.id }]
  );
  assert.equal(
    await withRuntimeContext(customerContext, (transaction) => transaction.user.count()),
    1
  );

  const publicContext: RuntimeContext = {
    actorRole: "public",
    purpose: "http.public",
    applicationId: fixture.applications[0]!.id
  };
  assert.equal(
    await withRuntimeContext(publicContext, (transaction) => transaction.wedding.count()),
    0
  );
  assert.deepEqual(
    await withRuntimeContext(publicContext, (transaction) =>
      transaction.bookingApplication.findMany({ select: { id: true } })
    ),
    [{ id: fixture.applications[0]!.id }]
  );
  assert.equal(
    await withRuntimeContext(publicContext, (transaction) =>
      transaction.$queryRaw<Array<{ occupied: boolean }>>`
        SELECT public.public_venue_has_conflict(
          ${fixture.venues[0]!.id}::text,
          ${startsAt},
          ${endsAt},
          NULL::text,
          NULL::text
        ) AS occupied
      `.then((rows) => rows[0]?.occupied)
    ),
    true
  );

  assert.equal(
    await withRuntimeContext({ actorRole: "auth", purpose: "http.auth" }, (transaction) =>
      transaction.wedding.count()
    ),
    0
  );
  assert.equal(
    await withRuntimeContext({ actorRole: "auth", purpose: "http.auth" }, (transaction) =>
      transaction.venue.count()
    ),
    0
  );

  assert.equal(
    await withRuntimeContext(
      { actorRole: "maintenance", purpose: "maintenance.retention" },
      (transaction) =>
        transaction.wedding.count({ where: { id: { in: fixture.weddings.map(({ id }) => id) } } })
    ),
    fixture.weddings.length
  );
  assert.equal(
    await withRuntimeContext(
      { actorRole: "maintenance", purpose: "maintenance.retention" },
      (transaction) =>
        transaction.staff.count({ where: { id: { in: fixture.staff.map(({ id }) => id) } } })
    ),
    0
  );

  assert.equal(
    await withRuntimeContext(
      { actorRole: "admin", actorUserId: randomUUID(), purpose: "http.admin" },
      (transaction) =>
        transaction.wedding.count({ where: { id: { in: fixture.weddings.map(({ id }) => id) } } })
    ),
    fixture.weddings.length
  );
});
