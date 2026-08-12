import { Prisma, type StaffSpecialty } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import {
  authenticate,
  requireChangedPassword,
  requireRole,
  verifyCsrf
} from "../middlewares/auth.middleware.js";
import { validateRequest } from "../middlewares/validate.middleware.js";
import {
  assignmentBodySchema,
  calendarQuerySchema,
  dashboardQuerySchema,
  operationalWeddingUpdateBodySchema,
  uuidParamsSchema,
  venueStaffBodySchema,
  venueStaffUpdateBodySchema
} from "../schemas/api.schemas.js";
import {
  assertVenueScheduleAvailable,
  createAudit
} from "../services/booking.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { findBoundedIntervalConflicts } from "../utils/intervalConflicts.js";
import {
  addCalendarDays,
  atIstanbulTime,
  createWeddingRange,
  getIstanbulDate,
  normalizePhone
} from "../utils/domain.js";
import {
  buildBookingApplicationPiiData,
  buildStaffPiiData,
  buildWeddingPiiData,
  decryptBookingApplicationPii,
  decryptWeddingPii,
  staffWithDecryptedPii
} from "../utils/pii-crypto.js";

const router = Router();
router.use(authenticate, requireChangedPassword, requireRole("SALON_YETKILISI"));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const emptyQuery = z.object({}).strict();
const emptyBody = z.object({}).strict();
const uuidRequest = z.object({ body: emptyBody, query: emptyQuery, params: uuidParamsSchema });
const assignmentParamsSchema = z
  .object({ id: z.string().uuid(), assignmentId: z.string().uuid() })
  .strict();

const venueIdOf = (venueId: string | null | undefined): string => {
  if (!venueId) throw new AppError("Salon sorumlusu hesabına salon atanmamış.", 403);
  return venueId;
};

const staffNameCollator = new Intl.Collator("tr-TR", { sensitivity: "base" });
const sortStaffByName = <StaffMember extends { firstName: string; lastName: string }>(
  staff: StaffMember[]
): StaffMember[] =>
  [...staff].sort(
    (left, right) =>
      staffNameCollator.compare(left.lastName, right.lastName) ||
      staffNameCollator.compare(left.firstName, right.firstName)
  );

const sortStaffByStatusAndName = <
  StaffMember extends { firstName: string; lastName: string; isActive: boolean }
>(staff: StaffMember[]): StaffMember[] =>
  [...staff].sort(
    (left, right) =>
      Number(right.isActive) - Number(left.isActive) ||
      staffNameCollator.compare(left.lastName, right.lastName) ||
      staffNameCollator.compare(left.firstName, right.firstName)
  );

const mondayOf = (date: string): string => {
  const probe = new Date(`${date}T12:00:00.000Z`);
  const day = probe.getUTCDay() || 7;
  return addCalendarDays(date, 1 - day);
};

const nextMonthOf = (month: string): string => {
  const probe = new Date(`${month}-01T12:00:00.000Z`);
  probe.setUTCMonth(probe.getUTCMonth() + 1);
  return probe.toISOString().slice(0, 7);
};

const weddingPiiRecordSelect = {
  id: true,
  brideFirstName: true,
  brideLastName: true,
  bridePhone: true,
  groomFirstName: true,
  groomLastName: true,
  groomPhone: true,
  primaryEmail: true,
  note: true,
  piiCiphertext: true,
  piiIv: true,
  piiAuthTag: true,
  piiKeyId: true,
  piiEncryptionVersion: true,
  piiSchemaVersion: true
} satisfies Prisma.WeddingSelect;

const bookingApplicationPiiRecordSelect = {
  id: true,
  brideFirstName: true,
  brideLastName: true,
  bridePhone: true,
  groomFirstName: true,
  groomLastName: true,
  groomPhone: true,
  primaryEmail: true,
  note: true,
  rejectionReason: true,
  piiCiphertext: true,
  piiIv: true,
  piiAuthTag: true,
  piiKeyId: true,
  piiEncryptionVersion: true,
  piiSchemaVersion: true
} satisfies Prisma.BookingApplicationSelect;

type SelectedWeddingPiiRecord = Prisma.WeddingGetPayload<{
  select: typeof weddingPiiRecordSelect;
}>;

const decryptSelectedWeddingPii = (wedding: SelectedWeddingPiiRecord) =>
  decryptWeddingPii(wedding.id, {
    brideFirstName: wedding.brideFirstName ?? undefined,
    brideLastName: wedding.brideLastName ?? undefined,
    bridePhone: wedding.bridePhone ?? undefined,
    groomFirstName: wedding.groomFirstName ?? undefined,
    groomLastName: wedding.groomLastName ?? undefined,
    groomPhone: wedding.groomPhone ?? undefined,
    primaryEmail: wedding.primaryEmail ?? undefined,
    note: wedding.note,
    piiCiphertext: wedding.piiCiphertext,
    piiIv: wedding.piiIv,
    piiAuthTag: wedding.piiAuthTag,
    piiKeyId: wedding.piiKeyId,
    piiEncryptionVersion: wedding.piiEncryptionVersion,
    piiSchemaVersion: wedding.piiSchemaVersion
  });

const weddingSelectForVenue = (venueId: string) => ({
  ...weddingPiiRecordSelect,
  startsAt: true,
  endsAt: true,
  packageSummary: true,
  assignments: {
    where: { staff: { venueId } },
    include: { staff: true },
    orderBy: { createdAt: "asc" as const }
  }
}) satisfies Prisma.WeddingSelect;

type VenueOperationsWedding = Prisma.WeddingGetPayload<{
  select: ReturnType<typeof weddingSelectForVenue>;
}>;

const venueOperationsWeddingDto = (wedding: VenueOperationsWedding) => {
  const pii = decryptSelectedWeddingPii(wedding);
  return {
    id: wedding.id,
    brideFirstName: pii.brideFirstName,
    bridePhone: pii.bridePhone,
    groomFirstName: pii.groomFirstName,
    groomPhone: pii.groomPhone,
    startsAt: wedding.startsAt,
    endsAt: wedding.endsAt,
    packageSummary: {
      name:
        wedding.packageSummary &&
        typeof wedding.packageSummary === "object" &&
        !Array.isArray(wedding.packageSummary) &&
        typeof wedding.packageSummary.name === "string"
          ? wedding.packageSummary.name
          : null
    },
    note: pii.note,
    assignments: wedding.assignments.map((assignment) => ({
      ...assignment,
      staff: staffWithDecryptedPii(assignment.staff)
    }))
  };
};

router.get(
  "/dashboard",
  validateRequest(z.object({ body: emptyBody, query: dashboardQuerySchema, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const today = getIstanbulDate(new Date());
    const tomorrow = addCalendarDays(today, 1);
    const weekStart = mondayOf(req.query.weekStart ? String(req.query.weekStart) : today);
    const weekEnd = addCalendarDays(weekStart, 7);
    const todayStart = atIstanbulTime(today, "00:00");
    const tomorrowStart = atIstanbulTime(tomorrow, "00:00");
    const weekStartsAt = atIstanbulTime(weekStart, "00:00");
    const weekEndsAt = atIstanbulTime(weekEnd, "00:00");

    const [venue, todayWeddings, weekWeddings, activeStaff] = await Promise.all([
      prisma.venue.findUnique({ where: { id: venueId }, select: { id: true, name: true } }),
      prisma.wedding.findMany({
        where: {
          venueId,
          cancelledAt: null,
          deletedAt: null,
          startsAt: { lt: tomorrowStart },
          endsAt: { gt: todayStart }
        },
        select: weddingSelectForVenue(venueId),
        orderBy: { startsAt: "asc" }
      }),
      prisma.wedding.findMany({
        where: {
          venueId,
          cancelledAt: null,
          deletedAt: null,
          startsAt: { lt: weekEndsAt },
          endsAt: { gt: weekStartsAt }
        },
        select: weddingSelectForVenue(venueId),
        orderBy: { startsAt: "asc" }
      }),
      prisma.staff.findMany({
        where: { venueId, isActive: true },
        include: {
          assignments: {
            where: {
              wedding: {
                venueId,
                cancelledAt: null,
                deletedAt: null,
                startsAt: { lt: tomorrowStart },
                endsAt: { gt: todayStart }
              }
            },
            select: { id: true }
          }
        }
      })
    ]);
    if (!venue) throw new AppError("Salon bulunamadı.", 404);

    const todayWeddingDtos = todayWeddings.map(venueOperationsWeddingDto);
    const weekWeddingDtos = weekWeddings.map(venueOperationsWeddingDto);
    const safeActiveStaff = sortStaffByName(
      activeStaff.map(({ assignments: staffAssignments, ...staff }) => ({
        ...staffWithDecryptedPii(staff),
        assignments: staffAssignments
      }))
    );
    const assignments = weekWeddingDtos.flatMap((wedding) =>
      wedding.assignments.map((assignment) => ({ assignment, wedding }))
    );
    const conflictResult = findBoundedIntervalConflicts(assignments, {
      groupKey: ({ assignment }) => assignment.staffId,
      startsAt: ({ wedding }) => wedding.startsAt,
      endsAt: ({ wedding }) => wedding.endsAt
    });
    const conflicts = conflictResult.pairs.map(([left, right]) => ({
      staff: left.assignment.staff,
      firstWedding: left.wedding,
      secondWedding: right.wedding
    }));

    res.json({
      success: true,
      data: {
        venue,
        today,
        weekStart,
        weekEnd: addCalendarDays(weekEnd, -1),
        metrics: {
          todayWeddings: todayWeddings.length,
          weekWeddings: weekWeddings.length,
          activeStaff: activeStaff.length,
          unassignedWeddings: weekWeddingDtos.filter((wedding) => wedding.assignments.length === 0)
            .length
        },
        todayWeddings: todayWeddingDtos,
        weekWeddings: weekWeddingDtos,
        idleStaff: safeActiveStaff
          .filter((staff) => staff.assignments.length === 0)
          .map(({ assignments: _assignments, ...staff }) => staff),
        conflicts,
        conflictsTruncated: conflictResult.truncated
      },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/calendar",
  validateRequest(
    z.object({
      body: emptyBody,
      query: calendarQuerySchema.omit({ venueId: true }),
      params: z.object({})
    })
  ),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const today = getIstanbulDate(new Date());
    const month = req.query.month ? String(req.query.month) : today.slice(0, 7);
    const venue = await prisma.venue.findUnique({
      where: { id: venueId },
      select: { id: true, name: true }
    });
    if (!venue) throw new AppError("Salon bulunamadı.", 404);
    const weddings = await prisma.wedding.findMany({
      where: {
        venueId,
        cancelledAt: null,
        deletedAt: null,
        startsAt: { lt: atIstanbulTime(`${nextMonthOf(month)}-01`, "00:00") },
        endsAt: { gt: atIstanbulTime(`${month}-01`, "00:00") }
      },
      select: weddingSelectForVenue(venueId),
      orderBy: { startsAt: "asc" }
    });
    res.json({
      success: true,
      data: { month, today, venue, weddings: weddings.map(venueOperationsWeddingDto) },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/staff",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const staff = await prisma.staff.findMany({
      where: { venueId },
      include: {
        venue: { select: { id: true, name: true } },
        assignments: {
          where: {
            wedding: {
              venueId,
              cancelledAt: null,
              deletedAt: null,
              endsAt: { gt: new Date() }
            }
          },
          select: {
            id: true,
            specialty: true,
            wedding: {
              select: {
                ...weddingPiiRecordSelect,
                startsAt: true,
                endsAt: true
              }
            }
          },
          orderBy: { wedding: { startsAt: "asc" } },
          take: 5
        }
      }
    });
    const staffDtos = sortStaffByStatusAndName(
      staff.map(({ assignments, ...staffMember }) => ({
        ...staffWithDecryptedPii(staffMember),
        assignments: assignments.map((assignment) => {
          const weddingPii = decryptSelectedWeddingPii(assignment.wedding);
          return {
            id: assignment.id,
            specialty: assignment.specialty,
            wedding: {
              id: assignment.wedding.id,
              brideFirstName: weddingPii.brideFirstName,
              groomFirstName: weddingPii.groomFirstName,
              startsAt: assignment.wedding.startsAt,
              endsAt: assignment.wedding.endsAt
            }
          };
        })
      }))
    );
    res.json({ success: true, data: staffDtos, correlationId: req.correlationId });
  })
);

router.post(
  "/staff",
  verifyCsrf,
  validateRequest(
    z.object({ body: venueStaffBodySchema, query: emptyQuery, params: z.object({}) })
  ),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const staff = await prisma.$transaction(async (transaction) => {
      const staffId = randomUUID();
      const created = await transaction.staff.create({
        data: {
          id: staffId,
          ...buildStaffPiiData(
            staffId,
            {
              firstName: req.body.firstName,
              lastName: req.body.lastName,
              phone: normalizePhone(req.body.phone)
            },
            1
          ),
          specialties: [...new Set(req.body.specialties)] as StaffSpecialty[],
          isActive: req.body.isActive,
          venueId
        }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "venue_staff.created",
        targetType: "Staff",
        targetId: created.id,
        correlationId: req.correlationId,
        metadata: { venueId }
      });
      return staffWithDecryptedPii(created);
    });
    res.status(201).json({ success: true, data: staff, correlationId: req.correlationId });
  })
);

router.patch(
  "/staff/:id",
  verifyCsrf,
  validateRequest(
    z.object({ body: venueStaffUpdateBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const staff = await prisma.$transaction(async (transaction) => {
      const current = await transaction.staff.findFirst({ where: { id: req.params.id, venueId } });
      if (!current) throw new AppError("Personel bulunamadı.", 404);
      const currentPii = staffWithDecryptedPii(current);
      const updated = await transaction.staff.update({
        where: { id: current.id, piiRevision: current.piiRevision },
        data: {
          ...buildStaffPiiData(
            current.id,
            {
              firstName: req.body.firstName ?? currentPii.firstName,
              lastName: req.body.lastName ?? currentPii.lastName,
              phone: req.body.phone ? normalizePhone(req.body.phone) : currentPii.phone
            },
            current.piiRevision + 1
          ),
          ...(req.body.specialties
            ? { specialties: [...new Set(req.body.specialties)] as StaffSpecialty[] }
            : {}),
          ...(req.body.isActive === undefined ? {} : { isActive: req.body.isActive })
        }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "venue_staff.updated",
        targetType: "Staff",
        targetId: updated.id,
        correlationId: req.correlationId,
        metadata: { venueId }
      });
      return staffWithDecryptedPii(updated);
    });
    res.json({ success: true, data: staff, correlationId: req.correlationId });
  })
);

router.get(
  "/weddings",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const weddings = await prisma.wedding.findMany({
      where: { venueId, deletedAt: null },
      select: weddingSelectForVenue(venueId),
      orderBy: { startsAt: "desc" },
      take: 200
    });
    res.json({
      success: true,
      data: weddings.map(venueOperationsWeddingDto),
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/weddings/:id",
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const wedding = await prisma.wedding.findFirst({
      where: { id: req.params.id, venueId, deletedAt: null },
      select: weddingSelectForVenue(venueId)
    });
    if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);
    const availableStaff = await prisma.staff.findMany({
      where: {
        venueId,
        isActive: true,
        assignments: {
          none: {
            wedding: {
              id: { not: wedding.id },
              cancelledAt: null,
              deletedAt: null,
              startsAt: { lt: wedding.endsAt },
              endsAt: { gt: wedding.startsAt }
            }
          }
        }
      }
    });
    res.json({
      success: true,
      data: {
        ...venueOperationsWeddingDto(wedding),
        availableStaff: sortStaffByName(
          availableStaff.map((member) => staffWithDecryptedPii(member))
        )
      },
      correlationId: req.correlationId
    });
  })
);

router.patch(
  "/weddings/:id",
  verifyCsrf,
  validateRequest(
    z.object({
      body: operationalWeddingUpdateBodySchema,
      query: emptyQuery,
      params: uuidParamsSchema
    })
  ),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const range = createWeddingRange(
      req.body.weddingDate,
      req.body.startTime,
      req.body.endTime,
      req.body.endsNextDay
    );
    const wedding = await prisma
      .$transaction(
        async (transaction) => {
          const current = await transaction.wedding.findFirst({
            where: { id: req.params.id, venueId, deletedAt: null, cancelledAt: null },
            select: {
              ...weddingPiiRecordSelect,
              applicationId: true,
              startsAt: true,
              updatedAt: true,
              piiRevision: true,
              delivery: {
                select: { id: true, status: true, releasedAt: true }
              },
              application: {
                select: {
                  ...bookingApplicationPiiRecordSelect,
                  updatedAt: true,
                  piiRevision: true
                }
              }
            }
          });
          if (!current) throw new AppError("Düğün kaydı bulunamadı.", 404);

          await assertVenueScheduleAvailable(transaction, {
            venueId,
            startsAt: range.startsAt,
            endsAt: range.endsAt,
            excludeWeddingId: current.id,
            excludeApplicationId: current.applicationId
          });

          const dateChanged = getIstanbulDate(current.startsAt) !== req.body.weddingDate;
          const nextNote = req.body.note || null;
          const weddingPii = decryptSelectedWeddingPii(current);
          const applicationPii = decryptBookingApplicationPii(current.application.id, {
            brideFirstName: current.application.brideFirstName ?? undefined,
            brideLastName: current.application.brideLastName ?? undefined,
            bridePhone: current.application.bridePhone ?? undefined,
            groomFirstName: current.application.groomFirstName ?? undefined,
            groomLastName: current.application.groomLastName ?? undefined,
            groomPhone: current.application.groomPhone ?? undefined,
            primaryEmail: current.application.primaryEmail ?? undefined,
            note: current.application.note,
            rejectionReason: current.application.rejectionReason,
            piiCiphertext: current.application.piiCiphertext,
            piiIv: current.application.piiIv,
            piiAuthTag: current.application.piiAuthTag,
            piiKeyId: current.application.piiKeyId,
            piiEncryptionVersion: current.application.piiEncryptionVersion,
            piiSchemaVersion: current.application.piiSchemaVersion
          });
          const nextWeddingPii = buildWeddingPiiData(
            current.id,
            { ...weddingPii, note: nextNote },
            current.piiRevision + 1
          );
          const nextApplicationPii = buildBookingApplicationPiiData(
            current.application.id,
            { ...applicationPii, note: nextNote },
            current.application.piiRevision + 1
          );
          const claimed = await transaction.wedding.updateMany({
            where: {
              id: current.id,
              updatedAt: current.updatedAt,
              piiRevision: current.piiRevision,
              deletedAt: null,
              cancelledAt: null
            },
            data: {
              startsAt: range.startsAt,
              endsAt: range.endsAt,
              ...nextWeddingPii
            }
          });
          if (claimed.count !== 1) {
            throw new AppError("Düğün kaydı başka bir işlemde güncellendi.", 409);
          }
          const applicationClaimed = await transaction.bookingApplication.updateMany({
            where: {
              id: current.applicationId,
              updatedAt: current.application.updatedAt,
              piiRevision: current.application.piiRevision
            },
            data: {
              weddingStartsAt: range.startsAt,
              weddingEndsAt: range.endsAt,
              ...nextApplicationPii
            }
          });
          if (applicationClaimed.count !== 1) {
            throw new AppError("Başvuru kaydı başka bir işlemde güncellendi.", 409);
          }
          if (dateChanged) {
            if (
              current.delivery &&
              current.delivery.status !== "TESLIM_EDILDI" &&
              !current.delivery.releasedAt
            ) {
              await transaction.delivery.update({
                where: { id: current.delivery.id },
                data: {
                  dueDate: new Date(`${addCalendarDays(req.body.weddingDate, 21)}T00:00:00.000Z`)
                }
              });
            }
            await transaction.messageTask.updateMany({
              where: {
                weddingId: current.id,
                kind: "PREPARATION_UPDATE",
                status: "PLANNED"
              },
              data: { dueAt: atIstanbulTime(addCalendarDays(req.body.weddingDate, 2), "10:00") }
            });
          }
          const updated = await transaction.wedding.findUniqueOrThrow({
            where: { id: current.id },
            select: weddingSelectForVenue(venueId)
          });
          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: "venue_wedding.schedule_updated",
            targetType: "Wedding",
            targetId: updated.id,
            correlationId: req.correlationId,
            metadata: { venueId, dateChanged }
          });
          return updated;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
      .catch((error: unknown) => {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
          throw new AppError("Düğün takvimi başka bir işlemde güncellendi. Tekrar deneyin.", 409);
        }
        throw error;
      });
    res.json({
      success: true,
      data: venueOperationsWeddingDto(wedding),
      correlationId: req.correlationId
    });
  })
);

router.post(
  "/weddings/:id/assignments",
  verifyCsrf,
  validateRequest(
    z.object({ body: assignmentBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const assignment = await prisma.$transaction(
      async (transaction) => {
        const [wedding, staff] = await Promise.all([
          transaction.wedding.findFirst({
            where: { id: req.params.id, venueId, deletedAt: null, cancelledAt: null }
          }),
          transaction.staff.findFirst({ where: { id: req.body.staffId, venueId, isActive: true } })
        ]);
        if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);
        if (!staff) throw new AppError("Aktif personel bulunamadı.", 404);
        if (!staff.specialties.includes(req.body.specialty))
          throw new AppError("Seçilen görev personelin uzmanlıkları arasında değil.", 400);
        const conflicts = await transaction.weddingAssignment.count({
          where: {
            staffId: staff.id,
            wedding: {
              id: { not: wedding.id },
              cancelledAt: null,
              deletedAt: null,
              startsAt: { lt: wedding.endsAt },
              endsAt: { gt: wedding.startsAt }
            }
          }
        });
        if (conflicts && !req.body.allowConflict)
          throw new AppError("Personelin bu saatlerde başka bir görevi var.", 409, true, {
            code: "STAFF_CONFLICT"
          });
        try {
          const created = await transaction.weddingAssignment.create({
            data: { weddingId: wedding.id, staffId: staff.id, specialty: req.body.specialty },
            include: { staff: true }
          });
          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: "venue_wedding.assignment_created",
            targetType: "WeddingAssignment",
            targetId: created.id,
            correlationId: req.correlationId,
            metadata: { venueId, weddingId: wedding.id, staffId: staff.id }
          });
          return { ...created, staff: staffWithDecryptedPii(created.staff) };
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
            throw new AppError("Bu personel düğüne zaten atanmış.", 409);
          throw error;
        }
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.status(201).json({ success: true, data: assignment, correlationId: req.correlationId });
  })
);

router.delete(
  "/weddings/:id/assignments/:assignmentId",
  verifyCsrf,
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: assignmentParamsSchema })),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const assignment = await prisma.$transaction(async (transaction) => {
      const current = await transaction.weddingAssignment.findFirst({
        where: { id: req.params.assignmentId, weddingId: req.params.id, wedding: { venueId } }
      });
      if (!current) throw new AppError("Personel ataması bulunamadı.", 404);
      await transaction.weddingAssignment.delete({ where: { id: current.id } });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "venue_wedding.assignment_deleted",
        targetType: "WeddingAssignment",
        targetId: current.id,
        correlationId: req.correlationId,
        metadata: { venueId, weddingId: current.weddingId, staffId: current.staffId }
      });
      return current;
    });
    res.json({ success: true, data: { id: assignment.id }, correlationId: req.correlationId });
  })
);

export default router;
