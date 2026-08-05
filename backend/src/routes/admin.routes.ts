import { Prisma } from "@prisma/client";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.config.js";
import { prisma } from "../config/prisma.js";
import {
  authenticate,
  requireChangedPassword,
  requireRole,
  verifyCsrf
} from "../middlewares/auth.middleware.js";
import { validateRequest } from "../middlewares/validate.middleware.js";
import {
  adminBookingBodySchema,
  assignmentBodySchema,
  archivedQuerySchema,
  bookingQuerySchema,
  calendarQuerySchema,
  dashboardQuerySchema,
  deliveryUpdateBodySchema,
  packageBodySchema,
  permanentDeleteBodySchema,
  rejectBookingBodySchema,
  serviceBodySchema,
  staffBodySchema,
  staffUpdateBodySchema,
  uuidParamsSchema,
  venueManagerBodySchema,
  venueManagerUpdateBodySchema,
  weddingUpdateBodySchema
} from "../schemas/api.schemas.js";
import {
  approveBookingApplication,
  createAudit,
  createBookingApplication,
  createUniqueCustomerUsername,
  rejectBookingApplication,
  retryUsernameConflict
} from "../services/booking.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { decryptValue, encryptValue, hashPassword } from "../utils/crypto.js";
import {
  assertGoogleDriveUrl,
  addCalendarDays,
  atIstanbulTime,
  createTemporaryPasswordExpiry,
  createWeddingRange,
  deliveryEncryptionAad,
  getIstanbulDate,
  messageSecretEncryptionAad,
  normalizePhone,
  randomTemporaryPassword
} from "../utils/domain.js";

const router = Router();
router.use(authenticate, requireChangedPassword, requireRole("ADMIN"));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const emptyQuery = z.object({}).strict();
const emptyBody = z.object({}).strict();
const uuidRequest = z.object({ body: emptyBody, query: emptyQuery, params: uuidParamsSchema });
const markSentRequest = z.object({
  body: z.object({ expectedUpdatedAt: z.string().datetime({ offset: true }) }).strict(),
  query: emptyQuery,
  params: uuidParamsSchema
});

const assignmentParamsSchema = z
  .object({
    id: z.string().uuid(),
    assignmentId: z.string().uuid()
  })
  .strict();

const dashboardWeddingInclude = {
  venue: { select: { name: true } },
  delivery: { select: { id: true, status: true, dueDate: true, releasedAt: true } },
  assignments: {
    include: { staff: { select: { id: true, firstName: true, lastName: true, isActive: true } } },
    orderBy: { createdAt: "asc" as const }
  }
} satisfies Prisma.WeddingInclude;

const mondayOf = (date: string): string => {
  const day = new Date(`${date}T12:00:00.000Z`).getUTCDay();
  return addCalendarDays(date, -(day === 0 ? 6 : day - 1));
};

const nextMonthOf = (month: string): string => {
  const value = new Date(`${month}-01T12:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1);
  return value.toISOString().slice(0, 7);
};

const dashboardWedding = (
  wedding: Prisma.WeddingGetPayload<{ include: typeof dashboardWeddingInclude }>
) => ({
  id: wedding.id,
  brideFirstName: wedding.brideFirstName,
  brideLastName: wedding.brideLastName,
  groomFirstName: wedding.groomFirstName,
  groomLastName: wedding.groomLastName,
  startsAt: wedding.startsAt,
  endsAt: wedding.endsAt,
  venue: wedding.venue,
  packageSummary: wedding.packageSummary,
  delivery: wedding.delivery,
  assignments: wedding.assignments
});

const isPrismaError = (error: unknown, code: string): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;

const normalizeConfirmation = (value: string): string =>
  value.trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");

const throwCatalogError = (error: unknown): never => {
  if (isPrismaError(error, "P2002")) {
    throw new AppError("Aynı kodu kullanan başka bir katalog kaydı var.", 409);
  }
  if (isPrismaError(error, "P2025")) {
    throw new AppError("Katalog kaydı bulunamadı.", 404);
  }
  if (isPrismaError(error, "P2003")) {
    throw new AppError("Bu katalog kaydı ilişkili veriler tarafından kullanıldığı için silinemez.", 409);
  }
  throw error;
};

router.get(
  "/booking-applications",
  validateRequest(z.object({ body: emptyBody, query: bookingQuerySchema, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const applications = await prisma.bookingApplication.findMany({
      where: {
        ...(req.query.includeArchived === "true"
          ? { deletedAt: { not: null } }
          : { deletedAt: null }),
        ...(req.query.status ? { status: req.query.status as never } : {}),
        ...(req.query.referenceCode
          ? {
              referenceCode: {
                contains: String(req.query.referenceCode).toUpperCase(),
                mode: "insensitive" as const
              }
            }
          : {})
      },
      include: {
        venue: { select: { name: true } },
        services: true,
        reviewedBy: { select: { username: true } }
      },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const safeApplications = applications.map(
      ({ idempotencyKey: _key, idempotencyFingerprint: _fingerprint, ...application }) =>
        application
    );
    res.json({ success: true, data: safeApplications, correlationId: req.correlationId });
  })
);

router.get(
  "/booking-applications/:id",
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const application = await prisma.bookingApplication.findUnique({
      where: { id: req.params.id },
      include: {
        venue: true,
        services: true,
        wedding: {
          include: {
            delivery: {
              select: {
                id: true,
                status: true,
                dueDate: true,
                releasedAt: true,
                createdAt: true,
                updatedAt: true
              }
            }
          }
        }
      }
    });
    if (!application) throw new AppError("Başvuru bulunamadı.", 404);
    const {
      idempotencyKey: _key,
      idempotencyFingerprint: _fingerprint,
      ...safeApplication
    } = application;
    res.json({ success: true, data: safeApplication, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications",
  verifyCsrf,
  validateRequest(
    z.object({ body: adminBookingBodySchema, query: emptyQuery, params: z.object({}) })
  ),
  asyncHandler(async (req, res) => {
    const application = await createBookingApplication(req.body, {
      source: "ADMIN",
      actor: { id: req.auth!.userId },
      correlationId: req.correlationId
    });
    res.status(201).json({
      success: true,
      data: application,
      correlationId: req.correlationId
    });
  })
);

router.post(
  "/booking-applications/:id/approve",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const result = await approveBookingApplication(
      req.params.id,
      req.auth!.userId,
      req.correlationId
    );
    res.json({ success: true, data: result, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications/:id/reject",
  verifyCsrf,
  validateRequest(
    z.object({ body: rejectBookingBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const result = await rejectBookingApplication(
      req.params.id,
      req.body.reason,
      req.auth!.userId,
      req.correlationId
    );
    res.json({ success: true, data: result, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications/:id/archive",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const application = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.bookingApplication.updateMany({
        where: {
          id: req.params.id,
          deletedAt: null,
          status: { in: ["ONAY_BEKLIYOR", "REDDEDILDI"] }
        },
        data: { deletedAt: new Date(), deletedById: req.auth!.userId }
      });
      if (updated.count !== 1)
        throw new AppError("Yalnızca bekleyen veya reddedilmiş başvurular arşivlenebilir.", 409);
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "booking_application.archived",
        targetType: "BookingApplication",
        targetId: req.params.id,
        correlationId: req.correlationId
      });
      return transaction.bookingApplication.findUniqueOrThrow({ where: { id: req.params.id } });
    });
    res.json({ success: true, data: application, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications/:id/restore",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const application = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.bookingApplication.updateMany({
        where: { id: req.params.id, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null }
      });
      if (updated.count !== 1) throw new AppError("Arşivde başvuru bulunamadı.", 404);
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "booking_application.restored",
        targetType: "BookingApplication",
        targetId: req.params.id,
        correlationId: req.correlationId
      });
      return transaction.bookingApplication.findUniqueOrThrow({ where: { id: req.params.id } });
    });
    res.json({ success: true, data: application, correlationId: req.correlationId });
  })
);

router.delete(
  "/booking-applications/:id",
  verifyCsrf,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    await prisma.$transaction(
      async (transaction) => {
        const application = await transaction.bookingApplication.findUnique({
          where: { id: req.params.id },
          include: { wedding: true }
        });
        if (!application) throw new AppError("Başvuru bulunamadı.", 404);
        if (application.status === "ONAYLANDI" || application.wedding)
          throw new AppError("Onaylanan başvuru silinemez. İlgili düğün kaydını açın.", 409, true, {
            weddingId: application.wedding?.id
          });
        if (!["ONAY_BEKLIYOR", "REDDEDILDI"].includes(application.status))
          throw new AppError("Bu başvuru kalıcı olarak silinemez.", 409);
        if (
          normalizeConfirmation(req.body.confirmText) !==
          normalizeConfirmation(application.referenceCode)
        )
          throw new AppError("Onay metni başvuru referansı ile eşleşmiyor.", 400);
        await transaction.bookingApplication.delete({ where: { id: application.id } });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "booking_application.permanently_deleted",
          targetType: "BookingApplication",
          targetId: application.id,
          correlationId: req.correlationId,
          metadata: { referenceCode: application.referenceCode }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ success: true, data: { id: req.params.id }, correlationId: req.correlationId });
  })
);

router.get(
  "/dashboard",
  validateRequest(z.object({ body: emptyBody, query: dashboardQuerySchema, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const today = getIstanbulDate(new Date());
    const tomorrow = addCalendarDays(today, 1);
    const dayAfterTomorrow = addCalendarDays(today, 2);
    const weekStart = mondayOf(req.query.weekStart ? String(req.query.weekStart) : today);
    const weekEnd = addCalendarDays(weekStart, 7);
    const todayStart = atIstanbulTime(today, "00:00");
    const tomorrowStart = atIstanbulTime(tomorrow, "00:00");
    const dayAfterTomorrowStart = atIstanbulTime(dayAfterTomorrow, "00:00");
    const weekStartsAt = atIstanbulTime(weekStart, "00:00");
    const weekEndsAt = atIstanbulTime(weekEnd, "00:00");

    const [
      weekWeddings,
      todayWeddings,
      tomorrowWeddings,
      activeStaff,
      pendingBookings,
      pendingMessages,
      readyDeliveries,
      upcomingDeliveries
    ] = await Promise.all([
      prisma.wedding.findMany({
        where: {
          cancelledAt: null,
          deletedAt: null,
          startsAt: { lt: weekEndsAt },
          endsAt: { gt: weekStartsAt }
        },
        include: dashboardWeddingInclude,
        orderBy: { startsAt: "asc" }
      }),
      prisma.wedding.findMany({
        where: {
          cancelledAt: null,
          deletedAt: null,
          startsAt: { lt: tomorrowStart },
          endsAt: { gt: todayStart }
        },
        include: dashboardWeddingInclude,
        orderBy: { startsAt: "asc" }
      }),
      prisma.wedding.findMany({
        where: {
          cancelledAt: null,
          deletedAt: null,
          startsAt: { lt: dayAfterTomorrowStart },
          endsAt: { gt: tomorrowStart }
        },
        include: dashboardWeddingInclude,
        orderBy: { startsAt: "asc" }
      }),
      prisma.staff.findMany({
        where: { isActive: true },
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
      }),
      prisma.bookingApplication.count({ where: { status: "ONAY_BEKLIYOR", deletedAt: null } }),
      prisma.messageTask.count({ where: { status: "PENDING", wedding: { deletedAt: null } } }),
      prisma.delivery.count({ where: { status: "TESLIME_HAZIR", wedding: { deletedAt: null } } }),
      prisma.delivery.findMany({
        where: {
          wedding: { deletedAt: null },
          status: { not: "TESLIM_EDILDI" },
          dueDate: {
            gte: new Date(`${today}T00:00:00.000Z`),
            lt: new Date(`${addCalendarDays(today, 8)}T00:00:00.000Z`)
          }
        },
        select: {
          id: true,
          status: true,
          dueDate: true,
          wedding: { select: { id: true, brideFirstName: true, groomFirstName: true } }
        },
        orderBy: { dueDate: "asc" }
      })
    ]);

    const assignments = weekWeddings.flatMap((wedding) =>
      wedding.assignments.map((assignment) => ({ assignment, wedding }))
    );
    const conflicts: Array<Record<string, unknown>> = [];
    for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
      const left = assignments[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
        const right = assignments[rightIndex]!;
        if (
          left.assignment.staffId === right.assignment.staffId &&
          left.wedding.startsAt < right.wedding.endsAt &&
          left.wedding.endsAt > right.wedding.startsAt
        ) {
          conflicts.push({
            staff: left.assignment.staff,
            firstWedding: dashboardWedding(left.wedding),
            secondWedding: dashboardWedding(right.wedding)
          });
        }
      }
    }

    const distribution = Object.fromEntries(
      ["PHOTOGRAPHY", "VIDEO", "DRONE", "JIMMY_JIB", "ASSISTANT", "EDITING", "ALBUM"].map(
        (specialty) => [
          specialty,
          assignments.filter(({ assignment }) => assignment.specialty === specialty).length
        ]
      )
    );

    res.json({
      success: true,
      data: {
        today,
        weekStart,
        weekEnd: addCalendarDays(weekEnd, -1),
        metrics: {
          pendingBookings,
          pendingMessages,
          readyDeliveries,
          todayWeddings: todayWeddings.length
        },
        todayWeddings: todayWeddings.map(dashboardWedding),
        tomorrowWeddings: tomorrowWeddings.map(dashboardWedding),
        weekWeddings: weekWeddings.map(dashboardWedding),
        idleStaff: activeStaff
          .filter((staff) => staff.assignments.length === 0)
          .map(({ assignments: _a, ...staff }) => staff),
        distribution,
        conflicts,
        upcomingDeliveries
      },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/calendar",
  validateRequest(z.object({ body: emptyBody, query: calendarQuerySchema, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const today = getIstanbulDate(new Date());
    const month = req.query.month ? String(req.query.month) : today.slice(0, 7);
    const monthStart = atIstanbulTime(`${month}-01`, "00:00");
    const nextMonth = nextMonthOf(month);
    const monthEnd = atIstanbulTime(`${nextMonth}-01`, "00:00");
    const venues = await prisma.venue.findMany({
      select: { id: true, name: true, isActive: true },
      orderBy: [{ isActive: "desc" }, { name: "asc" }]
    });
    const selectedVenue = req.query.venueId
      ? venues.find((venue) => venue.id === String(req.query.venueId))
      : (venues.find((venue) => venue.isActive) ?? venues[0]);
    if (req.query.venueId && !selectedVenue) throw new AppError("Salon bulunamadı.", 404);

    const weddings = selectedVenue
      ? await prisma.wedding.findMany({
          where: {
            venueId: selectedVenue.id,
            cancelledAt: null,
            deletedAt: null,
            startsAt: { lt: monthEnd },
            endsAt: { gt: monthStart }
          },
          include: dashboardWeddingInclude,
          orderBy: { startsAt: "asc" }
        })
      : [];

    res.json({
      success: true,
      data: {
        month,
        today,
        venues,
        selectedVenue: selectedVenue ?? null,
        weddings: weddings.map(dashboardWedding)
      },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/staff",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const staff = await prisma.staff.findMany({
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
  validateRequest(z.object({ body: staffBodySchema, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const staff = await prisma.$transaction(async (transaction) => {
      const created = await transaction.staff.create({
        data: {
          ...req.body,
          phone: normalizePhone(req.body.phone),
          specialties: [...new Set(req.body.specialties)]
        }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "staff.created",
        targetType: "Staff",
        targetId: created.id,
        correlationId: req.correlationId
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
    z.object({ body: staffUpdateBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    try {
      const staff = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.staff.update({
          where: { id: req.params.id },
          data: {
            ...req.body,
            ...(req.body.phone ? { phone: normalizePhone(req.body.phone) } : {}),
            ...(req.body.specialties ? { specialties: [...new Set(req.body.specialties)] } : {})
          }
        });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "staff.updated",
          targetType: "Staff",
          targetId: updated.id,
          correlationId: req.correlationId,
          metadata: { active: updated.isActive }
        });
        return updated;
      });
      res.json({ success: true, data: staff, correlationId: req.correlationId });
    } catch (error) {
      if (isPrismaError(error, "P2025")) throw new AppError("Personel bulunamadı.", 404);
      throw error;
    }
  })
);

router.delete(
  "/staff/:id",
  verifyCsrf,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(
      async (transaction) => {
        const staff = await transaction.staff.findUnique({
          where: { id: req.params.id },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            isActive: true,
            _count: { select: { assignments: true } }
          }
        });
        if (!staff) throw new AppError("Personel bulunamadı.", 404);
        const name = `${staff.firstName} ${staff.lastName}`;
        if (normalizeConfirmation(req.body.confirmText) !== normalizeConfirmation(name))
          throw new AppError("Onay metni personel adıyla eşleşmiyor.", 400);
        if (staff._count.assignments > 0) {
          const updated = await transaction.staff.update({
            where: { id: staff.id },
            data: { isActive: false }
          });
          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: "staff.deactivated",
            targetType: "Staff",
            targetId: staff.id,
            correlationId: req.correlationId,
            metadata: { reason: "historical_assignments" }
          });
          return { id: updated.id, action: "deactivated" };
        }
        await transaction.staff.delete({ where: { id: staff.id } });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "staff.permanently_deleted",
          targetType: "Staff",
          targetId: staff.id,
          correlationId: req.correlationId
        });
        return { id: staff.id, action: "deleted" };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ success: true, data: result, correlationId: req.correlationId });
  })
);

router.get(
  "/venue-managers",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const managers = await prisma.user.findMany({
      where: { role: "SALON_YETKILISI" },
      select: {
        id: true,
        username: true,
        status: true,
        mustChangePassword: true,
        lastLoginAt: true,
        createdAt: true,
        venue: { select: { id: true, name: true } }
      },
      orderBy: [{ status: "asc" }, { username: "asc" }]
    });
    res.json({ success: true, data: managers, correlationId: req.correlationId });
  })
);

router.post(
  "/venue-managers",
  verifyCsrf,
  validateRequest(
    z.object({ body: venueManagerBodySchema, query: emptyQuery, params: z.object({}) })
  ),
  asyncHandler(async (req, res) => {
    const venue = await prisma.venue.findUnique({
      where: { id: req.body.venueId },
      select: { id: true }
    });
    if (!venue) throw new AppError("Salon bulunamadı.", 404);
    try {
      const passwordHash = await hashPassword(req.body.password);
      const manager = await prisma.$transaction(async (transaction) => {
        const created = await transaction.user.create({
          data: {
            username: req.body.username,
            passwordHash,
            role: "SALON_YETKILISI",
            status: req.body.status,
            venueId: req.body.venueId,
            mustChangePassword: true,
            temporaryPasswordExpiresAt: createTemporaryPasswordExpiry(
              env.TEMPORARY_PASSWORD_TTL_HOURS
            )
          },
          select: {
            id: true,
            username: true,
            status: true,
            mustChangePassword: true,
            venue: { select: { id: true, name: true } }
          }
        });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "venue_manager.created",
          targetType: "User",
          targetId: created.id,
          correlationId: req.correlationId,
          metadata: { venueId: req.body.venueId }
        });
        return created;
      });
      res.status(201).json({ success: true, data: manager, correlationId: req.correlationId });
    } catch (error) {
      if (isPrismaError(error, "P2002"))
        throw new AppError("Bu kullanıcı adı zaten kullanılıyor.", 409);
      throw error;
    }
  })
);

router.patch(
  "/venue-managers/:id",
  verifyCsrf,
  validateRequest(
    z.object({ body: venueManagerUpdateBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    if (req.body.venueId) {
      const venue = await prisma.venue.findUnique({
        where: { id: req.body.venueId },
        select: { id: true }
      });
      if (!venue) throw new AppError("Salon bulunamadı.", 404);
    }
    const passwordHash = req.body.password ? await hashPassword(req.body.password) : undefined;
    try {
      const manager = await prisma.$transaction(async (transaction) => {
        const current = await transaction.user.findFirst({
          where: { id: req.params.id, role: "SALON_YETKILISI" }
        });
        if (!current) throw new AppError("Salon sorumlusu bulunamadı.", 404);
        const updated = await transaction.user.update({
          where: { id: current.id },
          data: {
            ...(req.body.username ? { username: req.body.username } : {}),
            ...(req.body.venueId ? { venueId: req.body.venueId } : {}),
            ...(req.body.status ? { status: req.body.status } : {}),
            ...(passwordHash
              ? {
                  passwordHash,
                  mustChangePassword: true,
                  passwordChangedAt: null,
                  temporaryPasswordExpiresAt: createTemporaryPasswordExpiry(
                    env.TEMPORARY_PASSWORD_TTL_HOURS
                  )
                }
              : {})
          },
          select: {
            id: true,
            username: true,
            status: true,
            mustChangePassword: true,
            venue: { select: { id: true, name: true } }
          }
        });
        if (passwordHash || req.body.status === "DISABLED") {
          await transaction.authSession.updateMany({
            where: { userId: current.id, revokedAt: null },
            data: { revokedAt: new Date() }
          });
        }
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "venue_manager.updated",
          targetType: "User",
          targetId: updated.id,
          correlationId: req.correlationId,
          metadata: {
            venueId: updated.venue?.id,
            passwordReset: Boolean(passwordHash),
            status: updated.status
          }
        });
        return updated;
      });
      res.json({ success: true, data: manager, correlationId: req.correlationId });
    } catch (error) {
      if (isPrismaError(error, "P2002"))
        throw new AppError("Bu kullanıcı adı zaten kullanılıyor.", 409);
      throw error;
    }
  })
);

router.get(
  "/weddings",
  validateRequest(z.object({ body: emptyBody, query: archivedQuerySchema, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const weddings = await prisma.wedding.findMany({
      where:
        req.query.includeArchived === "true" ? { deletedAt: { not: null } } : { deletedAt: null },
      include: {
        venue: { select: { name: true } },
        customerUser: {
          select: { id: true, username: true, activeAt: true, mustChangePassword: true }
        },
        delivery: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            releasedAt: true,
            updatedAt: true,
            driveUrlCiphertext: true
          }
        },
        assignments: {
          include: { staff: true },
          orderBy: { createdAt: "asc" }
        }
      },
      orderBy: { startsAt: "desc" },
      take: 200
    });
    const safeWeddings = weddings.map((wedding) => ({
      ...wedding,
      delivery: wedding.delivery
        ? {
            id: wedding.delivery.id,
            status: wedding.delivery.status,
            dueDate: wedding.delivery.dueDate,
            releasedAt: wedding.delivery.releasedAt,
            updatedAt: wedding.delivery.updatedAt,
            hasDriveUrl: Boolean(wedding.delivery.driveUrlCiphertext)
          }
        : null
    }));
    res.json({ success: true, data: safeWeddings, correlationId: req.correlationId });
  })
);

router.get(
  "/weddings/:id",
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const wedding = await prisma.wedding.findUnique({
      where: { id: req.params.id },
      include: {
        venue: { select: { id: true, name: true } },
        customerUser: {
          select: { id: true, username: true, activeAt: true, mustChangePassword: true }
        },
        delivery: true,
        assignments: { include: { staff: true }, orderBy: { createdAt: "asc" } },
        messageTasks: {
          select: {
            id: true,
            kind: true,
            status: true,
            dueAt: true,
            recipientPhone: true,
            sentAt: true,
            createdAt: true,
            updatedAt: true,
            sentBy: { select: { username: true } }
          },
          orderBy: { dueAt: "desc" }
        }
      }
    });
    if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);

    const availableStaff = await prisma.staff.findMany({
      where: {
        venueId: wedding.venueId,
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

    const { delivery, ...safeWedding } = wedding;
    let driveUrl: string | null = null;
    if (delivery?.driveUrlCiphertext && delivery.driveUrlIv && delivery.driveUrlAuthTag) {
      driveUrl = decryptValue(
        {
          ciphertext: delivery.driveUrlCiphertext,
          iv: delivery.driveUrlIv,
          authTag: delivery.driveUrlAuthTag
        },
        delivery.encryptionVersion >= 2 ? deliveryEncryptionAad(delivery.id) : undefined
      );
    }
    res.json({
      success: true,
      data: {
        ...safeWedding,
        delivery: delivery
          ? {
              id: delivery.id,
              status: delivery.status,
              dueDate: delivery.dueDate,
              releasedAt: delivery.releasedAt,
              updatedAt: delivery.updatedAt,
              hasDriveUrl: Boolean(driveUrl),
              driveUrl
            }
          : null,
        availableStaff
      },
      correlationId: req.correlationId
    });
  })
);

router.post(
  "/weddings/:id/archive",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const wedding = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.wedding.updateMany({
        where: { id: req.params.id, deletedAt: null },
        data: { deletedAt: new Date(), deletedById: req.auth!.userId }
      });
      if (updated.count !== 1)
        throw new AppError("Düğün kaydı bulunamadı veya zaten arşivde.", 404);
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "wedding.archived",
        targetType: "Wedding",
        targetId: req.params.id,
        correlationId: req.correlationId
      });
      return transaction.wedding.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { id: true, deletedAt: true }
      });
    });
    res.json({ success: true, data: wedding, correlationId: req.correlationId });
  })
);

router.post(
  "/weddings/:id/restore",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const wedding = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.wedding.updateMany({
        where: { id: req.params.id, deletedAt: { not: null } },
        data: { deletedAt: null, deletedById: null }
      });
      if (updated.count !== 1) throw new AppError("Arşivde düğün kaydı bulunamadı.", 404);
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "wedding.restored",
        targetType: "Wedding",
        targetId: req.params.id,
        correlationId: req.correlationId
      });
      return transaction.wedding.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { id: true, deletedAt: true }
      });
    });
    res.json({ success: true, data: wedding, correlationId: req.correlationId });
  })
);

router.delete(
  "/weddings/:id",
  verifyCsrf,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    await prisma.$transaction(
      async (transaction) => {
        const wedding = await transaction.wedding.findUnique({
          where: { id: req.params.id },
          select: {
            id: true,
            applicationId: true,
            customerUserId: true,
            brideFirstName: true,
            brideLastName: true,
            groomFirstName: true,
            groomLastName: true
          }
        });
        if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);
        const confirmation = `${wedding.brideFirstName} ${wedding.brideLastName} & ${wedding.groomFirstName} ${wedding.groomLastName}`;
        if (
          normalizeConfirmation(req.body.confirmText) !== normalizeConfirmation(confirmation) &&
          req.body.confirmText.trim() !== wedding.id
        )
          throw new AppError("Onay metni çift adı veya düğün referansıyla eşleşmiyor.", 400);
        const [applicationUse, customerUse] = await Promise.all([
          transaction.wedding.count({ where: { applicationId: wedding.applicationId } }),
          transaction.wedding.count({ where: { customerUserId: wedding.customerUserId } })
        ]);
        if (applicationUse > 1 || customerUse > 1)
          throw new AppError(
            "İlişkili müşteri veya başvuru başka bir kayıtta kullanıldığı için silinemiyor.",
            409
          );
        const delivery = await transaction.delivery.findUnique({
          where: { weddingId: wedding.id },
          select: { id: true }
        });
        await transaction.weddingAssignment.deleteMany({ where: { weddingId: wedding.id } });
        await transaction.messageTask.deleteMany({ where: { weddingId: wedding.id } });
        if (delivery) {
          await transaction.deliveryStatusHistory.deleteMany({
            where: { deliveryId: delivery.id }
          });
          await transaction.delivery.delete({ where: { id: delivery.id } });
        }
        await transaction.wedding.delete({ where: { id: wedding.id } });
        await transaction.bookingApplication.delete({ where: { id: wedding.applicationId } });
        await transaction.user.delete({ where: { id: wedding.customerUserId } });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "wedding.permanently_deleted",
          targetType: "Wedding",
          targetId: wedding.id,
          correlationId: req.correlationId,
          metadata: { applicationId: wedding.applicationId, operationalRecordsDeleted: true }
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.json({ success: true, data: { id: req.params.id }, correlationId: req.correlationId });
  })
);

router.post(
  "/weddings/:id/assignments",
  verifyCsrf,
  validateRequest(
    z.object({ body: assignmentBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const assignment = await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "staff" WHERE "id" = ${req.body.staffId} FOR UPDATE`;
        const [wedding, staff] = await Promise.all([
          transaction.wedding.findUnique({ where: { id: req.params.id } }),
          transaction.staff.findUnique({ where: { id: req.body.staffId } })
        ]);
        if (!wedding || wedding.cancelledAt || wedding.deletedAt)
          throw new AppError("Düğün kaydı bulunamadı.", 404);
        if (!staff || !staff.isActive) throw new AppError("Aktif personel bulunamadı.", 404);
        if (staff.venueId !== wedding.venueId) {
          throw new AppError("Personel bu düğünün salon ekibinde değil.", 400);
        }
        if (!staff.specialties.includes(req.body.specialty)) {
          throw new AppError("Seçilen görev personelin uzmanlıkları arasında değil.", 400);
        }

        const conflicts = await transaction.weddingAssignment.findMany({
          where: {
            staffId: staff.id,
            wedding: {
              id: { not: wedding.id },
              cancelledAt: null,
              deletedAt: null,
              startsAt: { lt: wedding.endsAt },
              endsAt: { gt: wedding.startsAt }
            }
          },
          select: {
            id: true,
            wedding: {
              select: {
                id: true,
                brideFirstName: true,
                groomFirstName: true,
                startsAt: true,
                endsAt: true,
                venue: { select: { name: true } }
              }
            }
          }
        });
        if (conflicts.length > 0 && !req.body.allowConflict) {
          throw new AppError("Personelin bu saatlerde başka bir görevi var.", 409, true, {
            code: "STAFF_CONFLICT",
            conflicts: conflicts.map(({ wedding: conflictingWedding }) => conflictingWedding)
          });
        }

        let created;
        try {
          created = await transaction.weddingAssignment.create({
            data: { weddingId: wedding.id, staffId: staff.id, specialty: req.body.specialty },
            include: { staff: true }
          });
        } catch (error) {
          if (isPrismaError(error, "P2002")) {
            throw new AppError("Bu personel düğüne zaten atanmış.", 409);
          }
          throw error;
        }
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "wedding.assignment.created",
          targetType: "WeddingAssignment",
          targetId: created.id,
          correlationId: req.correlationId,
          metadata: {
            weddingId: wedding.id,
            staffId: staff.id,
            conflictOverride: conflicts.length > 0
          }
        });
        return { ...created, hasConflict: conflicts.length > 0 };
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
    const deleted = await prisma.$transaction(async (transaction) => {
      const assignment = await transaction.weddingAssignment.findFirst({
        where: { id: req.params.assignmentId, weddingId: req.params.id }
      });
      if (!assignment) throw new AppError("Personel ataması bulunamadı.", 404);
      const removed = await transaction.weddingAssignment.deleteMany({
        where: { id: assignment.id, weddingId: assignment.weddingId }
      });
      if (removed.count !== 1)
        throw new AppError("Personel ataması başka bir işlemde kaldırıldı.", 409);
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "wedding.assignment.deleted",
        targetType: "WeddingAssignment",
        targetId: assignment.id,
        correlationId: req.correlationId,
        metadata: { weddingId: assignment.weddingId, staffId: assignment.staffId }
      });
      return assignment;
    });
    res.json({ success: true, data: { id: deleted.id }, correlationId: req.correlationId });
  })
);

router.patch(
  "/weddings/:id",
  verifyCsrf,
  validateRequest(
    z.object({
      body: weddingUpdateBodySchema,
      query: emptyQuery,
      params: uuidParamsSchema
    })
  ),
  asyncHandler(async (req, res) => {
    const wedding = await prisma.wedding.findUnique({
      where: { id: req.params.id },
      include: { customerUser: true, delivery: true }
    });
    if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);
    if (wedding.cancelledAt || wedding.deletedAt)
      throw new AppError("İptal edilmiş veya arşivdeki düğün güncellenemez.", 409);

    const venue = await prisma.venue.findUnique({
      where: { id: req.body.venueId },
      select: { id: true, isActive: true }
    });
    if (!venue) throw new AppError("Salon bulunamadı.", 404);
    if (venue.id !== wedding.venueId && !venue.isActive) {
      throw new AppError("Pasif bir salona geçiş yapılamaz.", 409);
    }

    const bridePhone = normalizePhone(req.body.bridePhone);
    const groomPhone = normalizePhone(req.body.groomPhone);
    const { startsAt, endsAt } = createWeddingRange(
      req.body.weddingDate,
      req.body.startTime,
      req.body.endTime,
      req.body.endsNextDay
    );
    const oldWeddingDate = getIstanbulDate(wedding.startsAt);
    const dateChanged = oldWeddingDate !== req.body.weddingDate;
    const namesChanged =
      wedding.brideFirstName !== req.body.brideFirstName ||
      wedding.brideLastName !== req.body.brideLastName ||
      wedding.groomFirstName !== req.body.groomFirstName ||
      wedding.groomLastName !== req.body.groomLastName;
    const canRegenerateCredentials =
      wedding.customerUser.mustChangePassword && !wedding.customerUser.passwordChangedAt;
    const regenerateCredentials = canRegenerateCredentials && (dateChanged || namesChanged);
    const recipientPhone = req.body.primaryContact === "GELIN" ? bridePhone : groomPhone;
    const activationAt = atIstanbulTime(addCalendarDays(req.body.weddingDate, 1), "09:00");
    const preparationAt = atIstanbulTime(addCalendarDays(req.body.weddingDate, 2), "10:00");
    const dueDate = new Date(`${addCalendarDays(req.body.weddingDate, 21)}T00:00:00.000Z`);

    let nextUsername: string | undefined;
    let nextPasswordHash: string | undefined;
    let encryptedPassword: { ciphertext: string; iv: string; authTag: string } | undefined;
    const now = new Date();
    const temporaryPasswordExpiresAt = createTemporaryPasswordExpiry(
      env.TEMPORARY_PASSWORD_TTL_HOURS,
      activationAt > now ? activationAt : now
    );
    if (regenerateCredentials) {
      const temporaryPassword = randomTemporaryPassword();
      nextPasswordHash = await hashPassword(temporaryPassword);
      encryptedPassword = encryptValue(
        temporaryPassword,
        messageSecretEncryptionAad(wedding.id, "ACCOUNT_ACTIVATION")
      );
    }

    const updateWedding = () =>
      prisma.$transaction(async (transaction) => {
        const claimedWedding = await transaction.wedding.updateMany({
          where: {
            id: wedding.id,
            updatedAt: wedding.updatedAt,
            cancelledAt: null,
            deletedAt: null
          },
          data: {
            brideFirstName: req.body.brideFirstName,
            brideLastName: req.body.brideLastName,
            bridePhone,
            groomFirstName: req.body.groomFirstName,
            groomLastName: req.body.groomLastName,
            groomPhone,
            primaryContact: req.body.primaryContact,
            primaryEmail: req.body.primaryEmail,
            startsAt,
            endsAt,
            venueId: req.body.venueId,
            note: req.body.note || null
          }
        });
        if (claimedWedding.count !== 1) {
          throw new AppError("Düğün kaydı başka bir işlemde güncellendi.", 409);
        }

        if (regenerateCredentials && nextUsername && nextPasswordHash && encryptedPassword) {
          const claimedUser = await transaction.user.updateMany({
            where: {
              id: wedding.customerUserId,
              updatedAt: wedding.customerUser.updatedAt,
              mustChangePassword: true,
              passwordChangedAt: null
            },
            data: {
              username: nextUsername,
              passwordHash: nextPasswordHash,
              activeAt: activationAt,
              mustChangePassword: true,
              temporaryPasswordExpiresAt,
              passwordChangedAt: null
            }
          });
          if (claimedUser.count !== 1) {
            throw new AppError("Müşteri kimlik bilgileri başka bir işlemde güncellendi.", 409);
          }
          await transaction.authSession.updateMany({
            where: { userId: wedding.customerUserId, revokedAt: null },
            data: { revokedAt: now }
          });
        }

        if (dateChanged) {
          if (wedding.delivery && wedding.delivery.status !== "TESLIM_EDILDI") {
            await transaction.delivery.updateMany({
              where: {
                id: wedding.delivery.id,
                status: { not: "TESLIM_EDILDI" },
                releasedAt: null
              },
              data: { dueDate }
            });
          }
        }

        await transaction.messageTask.updateMany({
          where: { weddingId: wedding.id, status: "PENDING" },
          data: { recipientPhone }
        });

        if (dateChanged) {
          await transaction.messageTask.updateMany({
            where: {
              weddingId: wedding.id,
              kind: "PREPARATION_UPDATE",
              status: "PENDING"
            },
            data: { dueAt: preparationAt }
          });
        }

        if (regenerateCredentials && nextUsername && nextPasswordHash && encryptedPassword) {
          await transaction.messageTask.upsert({
            where: {
              weddingId_kind: {
                weddingId: wedding.id,
                kind: "ACCOUNT_ACTIVATION"
              }
            },
            create: {
              weddingId: wedding.id,
              kind: "ACCOUNT_ACTIVATION",
              dueAt: activationAt,
              recipientPhone,
              secretCiphertext: encryptedPassword.ciphertext,
              secretIv: encryptedPassword.iv,
              secretAuthTag: encryptedPassword.authTag,
              encryptionVersion: 2
            },
            update: {
              status: "PENDING",
              dueAt: activationAt,
              recipientPhone,
              sentAt: null,
              sentById: null,
              secretCiphertext: encryptedPassword.ciphertext,
              secretIv: encryptedPassword.iv,
              secretAuthTag: encryptedPassword.authTag,
              encryptionVersion: 2
            }
          });
        }

        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "wedding.updated",
          targetType: "Wedding",
          targetId: wedding.id,
          correlationId: req.correlationId,
          metadata: {
            dateChanged,
            namesChanged,
            credentialsRegenerated: regenerateCredentials
          }
        });

        return transaction.wedding.findUniqueOrThrow({
          where: { id: wedding.id },
          include: {
            venue: { select: { name: true } },
            customerUser: {
              select: { id: true, username: true, activeAt: true, mustChangePassword: true }
            },
            delivery: {
              select: {
                id: true,
                status: true,
                dueDate: true,
                releasedAt: true,
                updatedAt: true
              }
            }
          }
        });
      });
    const updated = regenerateCredentials
      ? await retryUsernameConflict(
          () => createUniqueCustomerUsername(req.body.brideLastName, req.body.groomLastName),
          async (username) => {
            nextUsername = username;
            return updateWedding();
          }
        )
      : await updateWedding();

    res.json({
      success: true,
      data: {
        ...updated,
        credentialsRegenerated: regenerateCredentials,
        username: nextUsername ?? updated.customerUser.username
      },
      correlationId: req.correlationId
    });
  })
);

router.patch(
  "/deliveries/:id",
  verifyCsrf,
  validateRequest(
    z.object({
      body: deliveryUpdateBodySchema,
      query: emptyQuery,
      params: uuidParamsSchema
    })
  ),
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
    if (!delivery) throw new AppError("Teslimat kaydı bulunamadı.", 404);
    if (delivery.status === "TESLIM_EDILDI") {
      throw new AppError("Teslim edilmiş kayıt bu işlemle değiştirilemez.", 409);
    }

    const encrypted = req.body.driveUrl
      ? encryptValue(assertGoogleDriveUrl(req.body.driveUrl), deliveryEncryptionAad(delivery.id))
      : undefined;
    const nextStatus = req.body.status ?? delivery.status;
    const dueDate = req.body.dueDate ? new Date(`${req.body.dueDate}T00:00:00.000Z`) : undefined;

    const updated = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.delivery.updateMany({
        where: {
          id: delivery.id,
          status: delivery.status,
          releasedAt: null,
          updatedAt: delivery.updatedAt
        },
        data: {
          status: nextStatus,
          dueDate,
          ...(encrypted
            ? {
                driveUrlCiphertext: encrypted.ciphertext,
                driveUrlIv: encrypted.iv,
                driveUrlAuthTag: encrypted.authTag,
                encryptionVersion: 2
              }
            : {})
        }
      });
      if (claimed.count !== 1) {
        throw new AppError("Teslimat başka bir işlemde güncellendi.", 409);
      }
      if (nextStatus !== delivery.status) {
        await transaction.deliveryStatusHistory.create({
          data: {
            deliveryId: delivery.id,
            fromStatus: delivery.status,
            toStatus: nextStatus,
            actorUserId: req.auth!.userId
          }
        });
      }
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "delivery.updated",
        targetType: "Delivery",
        targetId: delivery.id,
        correlationId: req.correlationId,
        metadata: {
          statusChanged: nextStatus !== delivery.status,
          dueDateChanged: Boolean(dueDate),
          driveUrlChanged: Boolean(encrypted)
        }
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        select: {
          id: true,
          status: true,
          dueDate: true,
          releasedAt: true,
          updatedAt: true
        }
      });
    });

    res.json({ success: true, data: updated, correlationId: req.correlationId });
  })
);

router.post(
  "/deliveries/:id/deliver",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: { wedding: true }
    });
    if (!delivery) throw new AppError("Teslimat kaydı bulunamadı.", 404);
    if (delivery.status !== "TESLIME_HAZIR") {
      throw new AppError("Teslimat önce “Teslime Hazır” durumuna alınmalıdır.", 409);
    }
    if (!delivery.driveUrlCiphertext || !delivery.driveUrlIv || !delivery.driveUrlAuthTag) {
      throw new AppError("Teslim etmeden önce Google Drive bağlantısı kaydedilmelidir.", 409);
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "weddings"
        WHERE "id" = ${delivery.weddingId}
        FOR UPDATE
      `;
      const currentWedding = await transaction.wedding.findUniqueOrThrow({
        where: { id: delivery.weddingId },
        select: {
          primaryContact: true,
          bridePhone: true,
          groomPhone: true
        }
      });
      const recipientPhone =
        currentWedding.primaryContact === "GELIN"
          ? currentWedding.bridePhone
          : currentWedding.groomPhone;
      const claimed = await transaction.delivery.updateMany({
        where: {
          id: delivery.id,
          status: "TESLIME_HAZIR",
          releasedAt: null,
          updatedAt: delivery.updatedAt
        },
        data: { status: "TESLIM_EDILDI", releasedAt: now }
      });
      if (claimed.count !== 1) {
        throw new AppError("Teslimat başka bir işlemde güncellendi.", 409);
      }
      await transaction.deliveryStatusHistory.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: delivery.status,
          toStatus: "TESLIM_EDILDI",
          actorUserId: req.auth!.userId
        }
      });
      await transaction.messageTask.upsert({
        where: {
          weddingId_kind: {
            weddingId: delivery.weddingId,
            kind: "DELIVERY_READY"
          }
        },
        create: {
          weddingId: delivery.weddingId,
          kind: "DELIVERY_READY",
          dueAt: now,
          recipientPhone
        },
        update: {
          status: "PENDING",
          dueAt: now,
          recipientPhone,
          sentAt: null,
          sentById: null
        }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "delivery.released",
        targetType: "Delivery",
        targetId: delivery.id,
        correlationId: req.correlationId
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        select: {
          id: true,
          status: true,
          dueDate: true,
          releasedAt: true,
          updatedAt: true
        }
      });
    });

    res.json({ success: true, data: updated, correlationId: req.correlationId });
  })
);

const catalogRoutes = (
  path: "packages" | "services",
  schema: z.ZodObject<any>
) => {
  const targetType = path === "packages" ? "Package" : "Service";
  const actionPrefix = path === "packages" ? "package" : "service";
  const partialSchema = schema
    .partial()
    .refine((value: Record<string, unknown>) => Object.keys(value).length > 0, "En az bir alan gönderin.");

  router.get(
    `/${path}`,
    validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
    asyncHandler(async (req, res) => {
      const rows =
        path === "packages"
          ? await prisma.package.findMany({ orderBy: { name: "asc" } })
          : await prisma.service.findMany({ orderBy: [{ category: "asc" }, { name: "asc" }] });
      res.json({ success: true, data: rows, correlationId: req.correlationId });
    })
  );

  router.post(
    `/${path}`,
    verifyCsrf,
    validateRequest(z.object({ body: schema, query: emptyQuery, params: z.object({}) })),
    asyncHandler(async (req, res) => {
      let row;
      try {
        row = await prisma.$transaction(async (transaction) => {
          const created =
            path === "packages"
              ? await transaction.package.create({ data: req.body })
              : await transaction.service.create({ data: req.body });
          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: `${actionPrefix}.created`,
            targetType,
            targetId: created.id,
            correlationId: req.correlationId
          });
          return created;
        });
      } catch (error) {
        throwCatalogError(error);
      }
      res.status(201).json({ success: true, data: row, correlationId: req.correlationId });
    })
  );

  router.patch(
    `/${path}/:id`,
    verifyCsrf,
    validateRequest(z.object({ body: partialSchema, query: emptyQuery, params: uuidParamsSchema })),
    asyncHandler(async (req, res) => {
      let row;
      try {
        row = await prisma.$transaction(async (transaction) => {
          const updated =
            path === "packages"
              ? await transaction.package.update({
                  where: { id: req.params.id },
                  data: req.body
                })
              : await transaction.service.update({
                  where: { id: req.params.id },
                  data: req.body
                });
          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: `${actionPrefix}.updated`,
            targetType,
            targetId: updated.id,
            correlationId: req.correlationId
          });
          return updated;
        });
      } catch (error) {
        throwCatalogError(error);
      }
      res.json({ success: true, data: row, correlationId: req.correlationId });
    })
  );

  router.delete(
    `/${path}/:id`,
    verifyCsrf,
    validateRequest(uuidRequest),
    asyncHandler(async (req, res) => {
      let row;
      try {
        const id = req.params.id;
        const isReferenced =
          path === "packages"
            ? (await prisma.bookingApplication.count({ where: { packageId: id } })) > 0
            : (await prisma.bookingApplicationService.count({ where: { serviceId: id } })) > 0;

        row = await prisma.$transaction(async (transaction) => {
          if (isReferenced) {
            const deactivated =
              path === "packages"
                ? await transaction.package.update({
                    where: { id },
                    data: { isActive: false }
                  })
                : await transaction.service.update({
                    where: { id },
                    data: { isActive: false }
                  });
            await createAudit(transaction, {
              actorUserId: req.auth!.userId,
              action: `${actionPrefix}.deactivated`,
              targetType,
              targetId: deactivated.id,
              correlationId: req.correlationId
            });
            return deactivated;
          } else {
            try {
              const deleted =
                path === "packages"
                  ? await transaction.package.delete({ where: { id } })
                  : await transaction.service.delete({ where: { id } });
              await createAudit(transaction, {
                actorUserId: req.auth!.userId,
                action: `${actionPrefix}.deleted`,
                targetType,
                targetId: id,
                correlationId: req.correlationId
              });
              return { ...deleted, isActive: false };
            } catch (err) {
              if (isPrismaError(err, "P2003")) {
                const deactivated =
                  path === "packages"
                    ? await transaction.package.update({
                        where: { id },
                        data: { isActive: false }
                      })
                    : await transaction.service.update({
                        where: { id },
                        data: { isActive: false }
                      });
                await createAudit(transaction, {
                  actorUserId: req.auth!.userId,
                  action: `${actionPrefix}.deactivated`,
                  targetType,
                  targetId: deactivated.id,
                  correlationId: req.correlationId
                });
                return deactivated;
              }
              throw err;
            }
          }
        });
      } catch (error) {
        throwCatalogError(error);
      }
      res.json({ success: true, data: row, correlationId: req.correlationId });
    })
  );
};

catalogRoutes("packages", packageBodySchema);
catalogRoutes("services", serviceBodySchema);

router.get(
  "/message-tasks",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const tasks = await prisma.messageTask.findMany({
      where: { wedding: { deletedAt: null } },
      include: {
        wedding: {
          select: {
            brideFirstName: true,
            brideLastName: true,
            groomFirstName: true,
            groomLastName: true
          }
        },
        sentBy: { select: { username: true } }
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: 300
    });
    const safeTasks = tasks.map(
      ({ secretCiphertext: _ciphertext, secretIv: _iv, secretAuthTag: _tag, ...task }) => task
    );
    res.json({ success: true, data: safeTasks, correlationId: req.correlationId });
  })
);

const renderMessage = async (taskId: string) => {
  const task = await prisma.messageTask.findUnique({
    where: { id: taskId },
    include: {
      wedding: {
        include: {
          customerUser: true,
          delivery: true
        }
      }
    }
  });
  if (!task) throw new AppError("Mesaj görevi bulunamadı.", 404);

  const couple = `${task.wedding.brideFirstName} & ${task.wedding.groomFirstName}`;
  let message: string;
  if (task.kind === "ACCOUNT_ACTIVATION") {
    if (!task.secretCiphertext || !task.secretIv || !task.secretAuthTag) {
      throw new AppError("Aktivasyon mesajı güvenlik bilgisi eksik.", 409);
    }
    const password = decryptValue(
      {
        ciphertext: task.secretCiphertext,
        iv: task.secretIv,
        authTag: task.secretAuthTag
      },
      task.encryptionVersion >= 2
        ? messageSecretEncryptionAad(task.weddingId, task.kind)
        : undefined
    );
    message = `Merhaba ${couple}.\n\nDüğün Ajansım teslimat paneliniz hazır.\nKullanıcı adı: ${task.wedding.customerUser.username}\nGeçici parola: ${password}\n\nİlk girişte parolanızı değiştirmeniz istenecektir.`;
  } else if (task.kind === "PASSWORD_RESET") {
    if (!task.secretCiphertext || !task.secretIv || !task.secretAuthTag) {
      throw new AppError("Parola sıfırlama bilgisi eksik.", 409);
    }
    const password = decryptValue(
      {
        ciphertext: task.secretCiphertext,
        iv: task.secretIv,
        authTag: task.secretAuthTag
      },
      task.encryptionVersion >= 2
        ? messageSecretEncryptionAad(task.weddingId, task.kind)
        : undefined
    );
    message = `Merhaba ${couple}.\n\nGeçici parolanız: ${password}\nİlk girişte yeni bir parola belirlemeniz gerekecektir.`;
  } else if (task.kind === "PREPARATION_UPDATE") {
    if (!task.wedding.delivery?.dueDate) {
      throw new AppError("Teslimat tahmini tarihi bulunamadı.", 409);
    }
    const dueDate = task.wedding.delivery.dueDate.toLocaleDateString("tr-TR", {
      timeZone: "UTC"
    });
    message = `Merhaba ${couple}.\n\nFotoğraf ve video çalışmalarınız hazırlanmaktadır.\nOrtalama teslim süremiz 21 gündür.\nTahmini teslim tarihi: ${dueDate}`;
  } else {
    message = `Merhaba ${couple}.\n\nDüğün fotoğraf ve videolarınız hazırlandı.\nDosyalarınıza Düğün Ajansım müşteri panelinden ulaşabilirsiniz.\n\nİyi günlerde kullanmanızı dileriz.`;
  }

  const phone = task.recipientPhone.replace(/\D/g, "");
  return {
    task,
    message,
    whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
  };
};

router.get(
  "/message-tasks/:id/render",
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const rendered = await renderMessage(req.params.id);
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        message: rendered.message,
        whatsappUrl: rendered.whatsappUrl,
        expectedUpdatedAt: rendered.task.updatedAt.toISOString()
      },
      correlationId: req.correlationId
    });
  })
);

router.post(
  "/message-tasks/:id/mark-sent",
  verifyCsrf,
  validateRequest(markSentRequest),
  asyncHandler(async (req, res) => {
    const expectedUpdatedAt = new Date(req.body.expectedUpdatedAt);
    const now = new Date();
    const task = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.messageTask.updateMany({
        where: {
          id: req.params.id,
          status: "PENDING",
          updatedAt: expectedUpdatedAt
        },
        data: {
          status: "SENT",
          sentAt: now,
          sentById: req.auth!.userId,
          secretCiphertext: null,
          secretIv: null,
          secretAuthTag: null
        }
      });
      if (claimed.count !== 1) {
        const exists = await transaction.messageTask.findUnique({
          where: { id: req.params.id },
          select: { id: true }
        });
        if (!exists) throw new AppError("Mesaj görevi bulunamadı.", 404);
        throw new AppError("Mesaj görevi başka bir işlemde güncellendi.", 409);
      }
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "message.sent",
        targetType: "MessageTask",
        targetId: req.params.id,
        correlationId: req.correlationId
      });
      return transaction.messageTask.findUniqueOrThrow({
        where: { id: req.params.id },
        select: { id: true, status: true, sentAt: true }
      });
    });
    res.json({ success: true, data: task, correlationId: req.correlationId });
  })
);

router.post(
  "/customers/:id/reset-password",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { customerWedding: true }
    });
    if (!user || user.role !== "MUSTERI" || !user.customerWedding) {
      throw new AppError("Müşteri hesabı bulunamadı.", 404);
    }

    const password = randomTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const now = new Date();
    const temporaryPasswordExpiresAt = createTemporaryPasswordExpiry(
      env.TEMPORARY_PASSWORD_TTL_HOURS,
      user.activeAt !== null && user.activeAt > now ? user.activeAt : now
    );
    const encrypted = encryptValue(
      password,
      messageSecretEncryptionAad(user.customerWedding.id, "PASSWORD_RESET")
    );
    const task = await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "weddings"
        WHERE "id" = ${user.customerWedding!.id}
        FOR UPDATE
      `;
      await transaction.$queryRaw`
        SELECT "id" FROM "users"
        WHERE "id" = ${user.id}
        FOR UPDATE
      `;
      const currentWedding = await transaction.wedding.findUniqueOrThrow({
        where: { id: user.customerWedding!.id },
        select: {
          primaryContact: true,
          bridePhone: true,
          groomPhone: true
        }
      });
      const recipientPhone =
        currentWedding.primaryContact === "GELIN"
          ? currentWedding.bridePhone
          : currentWedding.groomPhone;
      const claimedUser = await transaction.user.updateMany({
        where: { id: user.id, updatedAt: user.updatedAt, role: "MUSTERI" },
        data: {
          passwordHash,
          mustChangePassword: true,
          temporaryPasswordExpiresAt,
          passwordChangedAt: null
        }
      });
      if (claimedUser.count !== 1) {
        throw new AppError("Müşteri hesabı başka bir işlemde güncellendi.", 409);
      }
      await transaction.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now }
      });
      const messageTask = await transaction.messageTask.upsert({
        where: {
          weddingId_kind: {
            weddingId: user.customerWedding!.id,
            kind: "PASSWORD_RESET"
          }
        },
        create: {
          weddingId: user.customerWedding!.id,
          kind: "PASSWORD_RESET",
          dueAt: now,
          recipientPhone,
          secretCiphertext: encrypted.ciphertext,
          secretIv: encrypted.iv,
          secretAuthTag: encrypted.authTag,
          encryptionVersion: 2
        },
        update: {
          status: "PENDING",
          dueAt: now,
          recipientPhone,
          sentAt: null,
          sentById: null,
          secretCiphertext: encrypted.ciphertext,
          secretIv: encrypted.iv,
          secretAuthTag: encrypted.authTag,
          encryptionVersion: 2
        }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "customer.password_reset",
        targetType: "User",
        targetId: user.id,
        correlationId: req.correlationId
      });
      return messageTask;
    });
    const rendered = await renderMessage(task.id);
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: { taskId: task.id, whatsappUrl: rendered.whatsappUrl },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/audit-logs",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
      include: { actor: { select: { username: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 300
    });
    res.json({ success: true, data: logs, correlationId: req.correlationId });
  })
);

router.get(
  "/overview",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const [pendingBookings, activeWeddings, pendingMessages, readyDeliveries] = await Promise.all([
      prisma.bookingApplication.count({ where: { status: "ONAY_BEKLIYOR" } }),
      prisma.wedding.count({ where: { cancelledAt: null } }),
      prisma.messageTask.count({ where: { status: "PENDING" } }),
      prisma.delivery.count({ where: { status: "TESLIME_HAZIR" } })
    ]);
    res.json({
      success: true,
      data: { pendingBookings, activeWeddings, pendingMessages, readyDeliveries },
      correlationId: req.correlationId
    });
  })
);

export default router;
