import { Prisma } from "@prisma/client";
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
import { createAudit } from "../services/booking.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import {
  addCalendarDays,
  atIstanbulTime,
  createWeddingRange,
  getIstanbulDate,
  normalizePhone
} from "../utils/domain.js";

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

const weddingInclude = {
  venue: { select: { id: true, name: true } },
  assignments: {
    include: { staff: true },
    orderBy: { createdAt: "asc" as const }
  }
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
        include: weddingInclude,
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
        include: weddingInclude,
        orderBy: { startsAt: "asc" }
      }),
      prisma.staff.findMany({
        where: { venueId, isActive: true },
        include: {
          assignments: {
            where: {
              wedding: {
                cancelledAt: null,
                deletedAt: null,
                startsAt: { lt: tomorrowStart },
                endsAt: { gt: todayStart }
              }
            },
            select: { id: true }
          }
        },
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
      })
    ]);
    if (!venue) throw new AppError("Salon bulunamadı.", 404);

    const assignments = weekWeddings.flatMap((wedding) =>
      wedding.assignments.map((assignment) => ({ assignment, wedding }))
    );
    const conflicts = assignments.flatMap((left, leftIndex) =>
      assignments.slice(leftIndex + 1).flatMap((right) =>
        left.assignment.staffId === right.assignment.staffId &&
        left.wedding.startsAt < right.wedding.endsAt &&
        left.wedding.endsAt > right.wedding.startsAt
          ? [
              {
                staff: left.assignment.staff,
                firstWedding: left.wedding,
                secondWedding: right.wedding
              }
            ]
          : []
      )
    );

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
          unassignedWeddings: weekWeddings.filter((wedding) => wedding.assignments.length === 0)
            .length
        },
        todayWeddings,
        weekWeddings,
        idleStaff: activeStaff
          .filter((staff) => staff.assignments.length === 0)
          .map(({ assignments: _assignments, ...staff }) => staff),
        conflicts
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
      include: weddingInclude,
      orderBy: { startsAt: "asc" }
    });
    res.json({
      success: true,
      data: { month, today, venue, weddings },
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
          where: { wedding: { cancelledAt: null, deletedAt: null, endsAt: { gt: new Date() } } },
          select: {
            id: true,
            specialty: true,
            wedding: {
              select: {
                id: true,
                brideFirstName: true,
                groomFirstName: true,
                startsAt: true,
                endsAt: true
              }
            }
          },
          orderBy: { wedding: { startsAt: "asc" } },
          take: 5
        }
      },
      orderBy: [{ isActive: "desc" }, { lastName: "asc" }, { firstName: "asc" }]
    });
    res.json({ success: true, data: staff, correlationId: req.correlationId });
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
      const created = await transaction.staff.create({
        data: { ...req.body, phone: normalizePhone(req.body.phone), venueId }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "venue_staff.created",
        targetType: "Staff",
        targetId: created.id,
        correlationId: req.correlationId,
        metadata: { venueId }
      });
      return created;
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
      const updated = await transaction.staff.update({
        where: { id: current.id },
        data: { ...req.body, ...(req.body.phone ? { phone: normalizePhone(req.body.phone) } : {}) }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "venue_staff.updated",
        targetType: "Staff",
        targetId: updated.id,
        correlationId: req.correlationId,
        metadata: { venueId }
      });
      return updated;
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
      include: weddingInclude,
      orderBy: { startsAt: "desc" },
      take: 200
    });
    res.json({ success: true, data: weddings, correlationId: req.correlationId });
  })
);

router.get(
  "/weddings/:id",
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const venueId = venueIdOf(req.auth!.venueId);
    const wedding = await prisma.wedding.findFirst({
      where: { id: req.params.id, venueId, deletedAt: null },
      include: weddingInclude
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
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }]
    });
    res.json({
      success: true,
      data: { ...wedding, availableStaff },
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
    const wedding = await prisma.$transaction(async (transaction) => {
      const current = await transaction.wedding.findFirst({
        where: { id: req.params.id, venueId, deletedAt: null, cancelledAt: null },
        include: { delivery: true }
      });
      if (!current) throw new AppError("Düğün kaydı bulunamadı.", 404);
      const dateChanged = getIstanbulDate(current.startsAt) !== req.body.weddingDate;
      const claimed = await transaction.wedding.updateMany({
        where: {
          id: current.id,
          updatedAt: current.updatedAt,
          deletedAt: null,
          cancelledAt: null
        },
        data: { startsAt: range.startsAt, endsAt: range.endsAt, note: req.body.note || null }
      });
      if (claimed.count !== 1) {
        throw new AppError("Düğün kaydı başka bir işlemde güncellendi.", 409);
      }
      await transaction.bookingApplication.update({
        where: { id: current.applicationId },
        data: {
          weddingStartsAt: range.startsAt,
          weddingEndsAt: range.endsAt,
          note: req.body.note || null
        }
      });
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
            status: "PENDING"
          },
          data: { dueAt: atIstanbulTime(addCalendarDays(req.body.weddingDate, 2), "10:00") }
        });
      }
      const updated = await transaction.wedding.findUniqueOrThrow({ where: { id: current.id } });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "venue_wedding.schedule_updated",
        targetType: "Wedding",
        targetId: updated.id,
        correlationId: req.correlationId,
        metadata: { venueId, dateChanged }
      });
      return updated;
    });
    res.json({ success: true, data: wedding, correlationId: req.correlationId });
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
          return created;
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
