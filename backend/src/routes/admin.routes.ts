import { Prisma, type StaffSpecialty } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.config.js";
import { prisma } from "../config/prisma.js";
import {
  assertRecentAdminStepUp,
  authenticate,
  requireChangedPassword,
  requireRecentAdminStepUp,
  requireRole,
  verifyCsrf
} from "../middlewares/auth.middleware.js";
import { validateRequest } from "../middlewares/validate.middleware.js";
import {
  adminCatalogFormConstraints,
  adminBookingBodySchema,
  assignmentBodySchema,
  archivedQuerySchema,
  bookingQuerySchema,
  calendarQuerySchema,
  dashboardQuerySchema,
  deliveryUpdateBodySchema,
  isPasswordSimilarToUsername,
  packageBodySchema,
  permanentDeleteBodySchema,
  rejectBookingBodySchema,
  serviceBodySchema,
  staffBodySchema,
  staffUpdateBodySchema,
  uuidParamsSchema,
  venueBodySchema,
  venueManagerBodySchema,
  venueManagerUpdateBodySchema,
  weddingUpdateBodySchema
} from "../schemas/api.schemas.js";
import {
  approveBookingApplication,
  assertVenueScheduleAvailable,
  calculatePayment,
  createAudit,
  createBookingApplication,
  createUniqueCustomerUsername,
  rejectBookingApplication,
  retryUsernameConflict
} from "../services/booking.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { createOpaqueToken, hashPassword } from "../utils/crypto.js";
import { buildDeliveryDriveUrlData, decryptDeliveryDriveUrl } from "../utils/delivery-crypto.js";
import {
  assertGoogleDriveUrl,
  addCalendarDays,
  atIstanbulTime,
  createTemporaryPasswordExpiry,
  createWeddingRange,
  getIstanbulDate,
  normalizePhone
} from "../utils/domain.js";
import {
  bookingApplicationWithDecryptedPii,
  buildBookingApplicationPiiData,
  buildMessageTaskPiiData,
  buildStaffPiiData,
  buildWeddingPiiData,
  decryptBookingApplicationPii,
  decryptMessageTaskPii,
  decryptWeddingPii,
  messageTaskWithDecryptedPii,
  staffWithDecryptedPii,
  weddingWithDecryptedPii
} from "../utils/pii-crypto.js";
import { createPasswordSetupUrl, issuePasswordSetupToken } from "../utils/passwordSetup.js";
import { findBoundedIntervalConflicts } from "../utils/intervalConflicts.js";

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
    include: { staff: true },
    orderBy: { createdAt: "asc" as const }
  }
} satisfies Prisma.WeddingInclude;

const weddingPiiSelect = {
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

type WeddingPiiSelection = Prisma.WeddingGetPayload<{ select: typeof weddingPiiSelect }>;

const weddingNames = (wedding: WeddingPiiSelection) => {
  const pii = decryptWeddingPii(wedding.id, wedding);
  return {
    brideFirstName: pii.brideFirstName,
    brideLastName: pii.brideLastName,
    groomFirstName: pii.groomFirstName,
    groomLastName: pii.groomLastName
  };
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
>(
  staff: StaffMember[]
): StaffMember[] =>
  [...staff].sort(
    (left, right) =>
      Number(right.isActive) - Number(left.isActive) ||
      staffNameCollator.compare(left.lastName, right.lastName) ||
      staffNameCollator.compare(left.firstName, right.firstName)
  );

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
) => {
  const pii = decryptWeddingPii(wedding.id, wedding);
  return {
    id: wedding.id,
    brideFirstName: pii.brideFirstName,
    brideLastName: pii.brideLastName,
    groomFirstName: pii.groomFirstName,
    groomLastName: pii.groomLastName,
    startsAt: wedding.startsAt,
    endsAt: wedding.endsAt,
    venue: wedding.venue,
    packageSummary: wedding.packageSummary,
    delivery: wedding.delivery,
    assignments: wedding.assignments.map((assignment) => ({
      ...assignment,
      staff: staffWithDecryptedPii(assignment.staff)
    }))
  };
};

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
    throw new AppError(
      "Bu katalog kaydı ilişkili veriler tarafından kullanıldığı için silinemez.",
      409
    );
  }
  throw error;
};

const throwVenueError = (error: unknown): never => {
  if (isPrismaError(error, "P2002")) {
    throw new AppError("Aynı kısa kodu veya adı kullanan başka bir mekân var.", 409);
  }
  if (isPrismaError(error, "P2025")) {
    throw new AppError("Mekân bulunamadı.", 404);
  }
  if (isPrismaError(error, "P2003")) {
    throw new AppError("İlişkili kayıtları bulunan mekân silinemez; pasife alınabilir.", 409);
  }
  throw error;
};

const assertVenueShowcaseReady = (venue: {
  isFeatured: boolean;
  displayName: string | null;
  imagePath: string | null;
}): void => {
  if (venue.isFeatured && (!venue.displayName || !venue.imagePath)) {
    throw new AppError("Vitrinde gösterilecek mekân için vitrin adı ve görsel gereklidir.", 400);
  }
};

router.get(
  "/catalog-form-constraints",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: adminCatalogFormConstraints,
      correlationId: req.correlationId
    });
  })
);

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
    const safeApplications = applications.map((rawApplication) => {
      const {
        idempotencyKey: _key,
        idempotencyFingerprint: _fingerprint,
        paymentFlowTokenHash: _paymentFlowTokenHash,
        ...application
      } = bookingApplicationWithDecryptedPii(rawApplication);
      return application;
    });
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
    const decryptedApplication = bookingApplicationWithDecryptedPii(application);
    const {
      idempotencyKey: _key,
      idempotencyFingerprint: _fingerprint,
      paymentFlowTokenHash: _paymentFlowTokenHash,
      wedding: rawWedding,
      ...safeApplication
    } = decryptedApplication;
    res.json({
      success: true,
      data: {
        ...safeApplication,
        wedding: rawWedding ? weddingWithDecryptedPii(rawWedding) : null
      },
      correlationId: req.correlationId
    });
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
          status: { in: ["ONAY_BEKLIYOR", "REDDEDILDI", "IPTAL_EDILDI"] }
        },
        data: {
          deletedAt: new Date(),
          deletedById: req.auth!.userId,
          paymentFlowTokenHash: null
        }
      });
      if (updated.count !== 1)
        throw new AppError(
          "Yalnızca bekleyen, reddedilmiş veya iptal edilmiş başvurular arşivlenebilir.",
          409
        );
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "booking_application.archived",
        targetType: "BookingApplication",
        targetId: req.params.id,
        correlationId: req.correlationId
      });
      return transaction.bookingApplication.findUniqueOrThrow({ where: { id: req.params.id } });
    });
    const { paymentFlowTokenHash: _paymentFlowTokenHash, ...safeApplication } =
      bookingApplicationWithDecryptedPii(application);
    res.json({ success: true, data: safeApplication, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications/:id/restore",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const application = await prisma
      .$transaction(
        async (transaction) => {
          const archived = await transaction.bookingApplication.findFirst({
            where: { id: req.params.id, deletedAt: { not: null } }
          });
          if (!archived) throw new AppError("Arşivde başvuru bulunamadı.", 404);

          if (archived.status === "ONAY_BEKLIYOR") {
            if (!archived.venueId) {
              throw new AppError("Salon bilgisi olmayan başvuru geri yüklenemez.", 409);
            }
            await assertVenueScheduleAvailable(transaction, {
              venueId: archived.venueId,
              startsAt: archived.weddingStartsAt,
              endsAt: archived.weddingEndsAt,
              excludeApplicationId: archived.id
            });
          }

          const updated = await transaction.bookingApplication.updateMany({
            where: {
              id: archived.id,
              deletedAt: archived.deletedAt,
              updatedAt: archived.updatedAt
            },
            data: { deletedAt: null, deletedById: null }
          });
          if (updated.count !== 1) {
            throw new AppError("Başvuru başka bir işlemde güncellendi.", 409);
          }
          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: "booking_application.restored",
            targetType: "BookingApplication",
            targetId: archived.id,
            correlationId: req.correlationId
          });
          return transaction.bookingApplication.findUniqueOrThrow({ where: { id: archived.id } });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
      .catch((error: unknown) => {
        if (isPrismaError(error, "P2034")) {
          throw new AppError(
            "Başvuru takvimi başka bir işlemde güncellendi. Tekrar deneyin.",
            409,
            true,
            {
              code: "VENUE_SCHEDULE_CONFLICT"
            }
          );
        }
        throw error;
      });
    const { paymentFlowTokenHash: _paymentFlowTokenHash, ...safeApplication } =
      bookingApplicationWithDecryptedPii(application);
    res.json({ success: true, data: safeApplication, correlationId: req.correlationId });
  })
);

router.delete(
  "/booking-applications/:id",
  verifyCsrf,
  requireRecentAdminStepUp,
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
          metadata: { referenceCode: application.referenceCode, reason: req.body.reason }
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
    const availabilityDate = req.query.availabilityDate
      ? String(req.query.availabilityDate)
      : today;
    const availabilityDayEnd = addCalendarDays(availabilityDate, 1);
    const todayStart = atIstanbulTime(today, "00:00");
    const tomorrowStart = atIstanbulTime(tomorrow, "00:00");
    const dayAfterTomorrowStart = atIstanbulTime(dayAfterTomorrow, "00:00");
    const weekStartsAt = atIstanbulTime(weekStart, "00:00");
    const weekEndsAt = atIstanbulTime(weekEnd, "00:00");
    const availabilityStartsAt = atIstanbulTime(availabilityDate, "00:00");
    const availabilityEndsAt = atIstanbulTime(availabilityDayEnd, "00:00");

    const [
      weekWeddings,
      todayWeddings,
      tomorrowWeddings,
      activeStaff,
      venues,
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
        where: {
          isActive: true,
          ...(req.query.venueId ? { venueId: String(req.query.venueId) } : {})
        },
        include: {
          venue: { select: { id: true, name: true } },
          assignments: {
            where: {
              wedding: {
                cancelledAt: null,
                deletedAt: null,
                startsAt: { lt: availabilityEndsAt },
                endsAt: { gt: availabilityStartsAt }
              }
            },
            select: {
              id: true,
              wedding: {
                select: {
                  ...weddingPiiSelect,
                  startsAt: true,
                  endsAt: true
                }
              }
            }
          }
        }
      }),
      prisma.venue.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" }
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
          wedding: { select: weddingPiiSelect }
        },
        orderBy: { dueDate: "asc" }
      })
    ]);

    const selectedVenue = req.query.venueId
      ? venues.find((venue) => venue.id === String(req.query.venueId))
      : null;
    if (req.query.venueId && !selectedVenue) throw new AppError("Salon bulunamadı.", 404);

    const assignments = weekWeddings.flatMap((wedding) =>
      wedding.assignments.map((assignment) => ({ assignment, wedding }))
    );
    const safeActiveStaff = sortStaffByName(
      activeStaff.map(({ assignments: staffAssignments, ...staff }) => ({
        ...staffWithDecryptedPii(staff),
        assignments: staffAssignments
      }))
    );
    const conflictResult = findBoundedIntervalConflicts(assignments, {
      groupKey: ({ assignment }) => assignment.staffId,
      startsAt: ({ wedding }) => wedding.startsAt,
      endsAt: ({ wedding }) => wedding.endsAt
    });
    const conflicts = conflictResult.pairs.map(([left, right]) => ({
      staff: staffWithDecryptedPii(left.assignment.staff),
      firstWedding: dashboardWedding(left.wedding),
      secondWedding: dashboardWedding(right.wedding)
    }));

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
        availabilityDate,
        venues,
        selectedVenue,
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
        idleStaff: safeActiveStaff
          .filter((staff) => staff.assignments.length === 0)
          .map(({ assignments: _a, ...staff }) => staff),
        staffAvailability: safeActiveStaff.map(({ assignments, ...staff }) => ({
          ...staff,
          isAvailable: assignments.length === 0,
          assignments: assignments.map(({ wedding, ...assignment }) => {
            const names = weddingNames(wedding);
            return {
              ...assignment,
              wedding: {
                id: wedding.id,
                brideFirstName: names.brideFirstName,
                groomFirstName: names.groomFirstName,
                startsAt: wedding.startsAt,
                endsAt: wedding.endsAt
              }
            };
          })
        })),
        distribution,
        conflicts,
        conflictsTruncated: conflictResult.truncated,
        upcomingDeliveries: upcomingDeliveries.map(({ wedding, ...delivery }) => {
          const names = weddingNames(wedding);
          return {
            ...delivery,
            wedding: {
              id: wedding.id,
              brideFirstName: names.brideFirstName,
              groomFirstName: names.groomFirstName
            }
          };
        })
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
                ...weddingPiiSelect,
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
    const safeStaff = sortStaffByStatusAndName(
      staff.map(({ assignments, ...member }) => ({
        ...staffWithDecryptedPii(member),
        assignments: assignments.map(({ wedding, ...assignment }) => {
          const names = weddingNames(wedding);
          return {
            ...assignment,
            wedding: {
              id: wedding.id,
              brideFirstName: names.brideFirstName,
              groomFirstName: names.groomFirstName,
              startsAt: wedding.startsAt,
              endsAt: wedding.endsAt
            }
          };
        })
      }))
    );
    res.json({ success: true, data: safeStaff, correlationId: req.correlationId });
  })
);

router.post(
  "/staff",
  verifyCsrf,
  validateRequest(z.object({ body: staffBodySchema, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
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
          venueId: req.body.venueId
        }
      });
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "staff.created",
        targetType: "Staff",
        targetId: created.id,
        correlationId: req.correlationId
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
    z.object({ body: staffUpdateBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    try {
      const staff = await prisma.$transaction(async (transaction) => {
        const current = await transaction.staff.findUnique({ where: { id: req.params.id } });
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
            ...(req.body.isActive === undefined ? {} : { isActive: req.body.isActive }),
            ...(req.body.venueId ? { venueId: req.body.venueId } : {})
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
        return staffWithDecryptedPii(updated);
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
  requireRecentAdminStepUp,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const result = await prisma.$transaction(
      async (transaction) => {
        const staff = await transaction.staff.findUnique({
          where: { id: req.params.id },
          include: { _count: { select: { assignments: true } } }
        });
        if (!staff) throw new AppError("Personel bulunamadı.", 404);
        const staffPii = staffWithDecryptedPii(staff);
        const name = `${staffPii.firstName} ${staffPii.lastName}`;
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
            metadata: {
              reason: req.body.reason,
              dispositionReason: "historical_assignments"
            }
          });
          return { id: updated.id, action: "deactivated" };
        }
        await transaction.staff.delete({ where: { id: staff.id } });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "staff.permanently_deleted",
          targetType: "Staff",
          targetId: staff.id,
          correlationId: req.correlationId,
          metadata: { reason: req.body.reason }
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
  requireRecentAdminStepUp,
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
  requireRecentAdminStepUp,
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
        if (
          req.body.password &&
          isPasswordSimilarToUsername(req.body.password, req.body.username ?? current.username)
        ) {
          throw new AppError("Parola kullanıcı adına benzememelidir.", 400);
        }
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
        if (passwordHash || req.body.status === "DISABLED" || req.body.venueId) {
          await transaction.authSession.updateMany({
            where: { userId: current.id, revokedAt: null },
            data: { revokedAt: new Date() }
          });
          await transaction.trustedDevice.updateMany({
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
      ...weddingWithDecryptedPii(wedding),
      assignments: wedding.assignments.map((assignment) => ({
        ...assignment,
        staff: staffWithDecryptedPii(assignment.staff)
      })),
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
            piiCiphertext: true,
            piiIv: true,
            piiAuthTag: true,
            piiKeyId: true,
            piiEncryptionVersion: true,
            piiSchemaVersion: true,
            piiRevision: true,
            recipientPhoneBlindIndex: true,
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
      }
    });

    const { delivery, ...safeWedding } = weddingWithDecryptedPii(wedding);
    const safeMessageTasks = wedding.messageTasks.map(messageTaskWithDecryptedPii);
    const driveUrl = delivery ? decryptDeliveryDriveUrl(delivery) : null;
    res.json({
      success: true,
      data: {
        ...safeWedding,
        assignments: wedding.assignments.map((assignment) => ({
          ...assignment,
          staff: staffWithDecryptedPii(assignment.staff)
        })),
        messageTasks: safeMessageTasks,
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
        availableStaff: sortStaffByName(
          availableStaff.map((member) => staffWithDecryptedPii(member))
        )
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
  requireRecentAdminStepUp,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    await prisma.$transaction(
      async (transaction) => {
        const wedding = await transaction.wedding.findUnique({
          where: { id: req.params.id },
          select: {
            ...weddingPiiSelect,
            applicationId: true,
            customerUserId: true
          }
        });
        if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);
        const names = weddingNames(wedding);
        const confirmation = `${names.brideFirstName} ${names.brideLastName} & ${names.groomFirstName} ${names.groomLastName}`;
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
          metadata: {
            applicationId: wedding.applicationId,
            operationalRecordsDeleted: true,
            reason: req.body.reason
          }
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
          throw new AppError(
            "Personel yalnızca bağlı olduğu salondaki düğüne atanabilir.",
            409,
            true,
            {
              code: "VENUE_ASSIGNMENT_MISMATCH"
            }
          );
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
                ...weddingPiiSelect,
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
            conflicts: conflicts.map(({ wedding: conflictingWedding }) => {
              const names = weddingNames(conflictingWedding);
              return {
                id: conflictingWedding.id,
                brideFirstName: names.brideFirstName,
                groomFirstName: names.groomFirstName,
                startsAt: conflictingWedding.startsAt,
                endsAt: conflictingWedding.endsAt,
                venue: conflictingWedding.venue
              };
            })
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
        return {
          ...created,
          staff: staffWithDecryptedPii(created.staff),
          hasConflict: conflicts.length > 0
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );
    res.status(201).json({ success: true, data: assignment, correlationId: req.correlationId });
  })
);

router.delete(
  "/weddings/:id/assignments/:assignmentId",
  verifyCsrf,
  requireRecentAdminStepUp,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: assignmentParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const deleted = await prisma.$transaction(async (transaction) => {
      const assignment = await transaction.weddingAssignment.findFirst({
        where: { id: req.params.assignmentId, weddingId: req.params.id }
      });
      if (!assignment) throw new AppError("Personel ataması bulunamadı.", 404);
      if (normalizeConfirmation(req.body.confirmText) !== normalizeConfirmation("ATAMAYI KALDIR")) {
        throw new AppError("Onay metni beklenen değerle eşleşmiyor.", 400);
      }
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
        metadata: {
          weddingId: assignment.weddingId,
          staffId: assignment.staffId,
          reason: req.body.reason
        }
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
      include: { customerUser: true, delivery: true, application: true }
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

    const currentPackageSummary = wedding.packageSummary as {
      code?: string;
      services?: Array<{ code?: string }>;
    };
    const currentServiceCodes = new Set(
      (currentPackageSummary.services ?? []).flatMap((service) =>
        service.code ? [service.code] : []
      )
    );
    const uniqueServiceCodes = [...new Set<string>(req.body.serviceCodes as string[])];
    if (uniqueServiceCodes.length !== req.body.serviceCodes.length) {
      throw new AppError("Aynı ek hizmet birden fazla seçilemez.", 400);
    }
    const [selectedPackage, selectedServices] = await Promise.all([
      prisma.package.findUnique({ where: { code: req.body.packageCode } }),
      prisma.service.findMany({ where: { code: { in: uniqueServiceCodes } } })
    ]);
    if (!selectedPackage) throw new AppError("Paket bulunamadı.", 404);
    if (!selectedPackage.isActive && selectedPackage.code !== currentPackageSummary.code) {
      throw new AppError("Pasif bir paket düğüne eklenemez.", 409);
    }
    if (selectedServices.length !== uniqueServiceCodes.length) {
      throw new AppError("Seçilen ek hizmetlerden biri bulunamadı.", 404);
    }
    if (
      selectedServices.some(
        (service) => !service.isActive && !currentServiceCodes.has(service.code)
      )
    ) {
      throw new AppError("Pasif bir ek hizmet düğüne eklenemez.", 409);
    }
    const subtotalCents =
      selectedPackage.priceCents +
      selectedServices.reduce((total, service) => total + service.priceCents, 0);
    const { totalPriceCents, payableNowCents } = calculatePayment(
      subtotalCents,
      wedding.application.paymentMethod
    );
    const packageSummary = {
      code: selectedPackage.code,
      name: selectedPackage.name,
      packagePriceCents: selectedPackage.priceCents,
      totalPriceCents,
      services: selectedServices
        .sort((left, right) => left.name.localeCompare(right.name, "tr"))
        .map((service) => ({
          code: service.code,
          name: service.name,
          priceCents: service.priceCents
        }))
    };

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
    const currentWeddingPii = decryptWeddingPii(wedding.id, wedding);
    const currentApplicationPii = decryptBookingApplicationPii(
      wedding.application.id,
      wedding.application
    );
    const namesChanged =
      currentWeddingPii.brideFirstName !== req.body.brideFirstName ||
      currentWeddingPii.brideLastName !== req.body.brideLastName ||
      currentWeddingPii.groomFirstName !== req.body.groomFirstName ||
      currentWeddingPii.groomLastName !== req.body.groomLastName;
    const canRegenerateCredentials =
      wedding.customerUser.mustChangePassword && !wedding.customerUser.passwordChangedAt;
    const regenerateCredentials = canRegenerateCredentials && (dateChanged || namesChanged);
    if (regenerateCredentials) {
      assertRecentAdminStepUp(req.auth!.adminStepUpVerifiedAt);
    }
    const recipientPhone = req.body.primaryContact === "GELIN" ? bridePhone : groomPhone;
    const activationAt = atIstanbulTime(addCalendarDays(req.body.weddingDate, 1), "09:00");
    const preparationAt = atIstanbulTime(addCalendarDays(req.body.weddingDate, 2), "10:00");
    const dueDate = new Date(`${addCalendarDays(req.body.weddingDate, 21)}T00:00:00.000Z`);
    const nextWeddingPii = buildWeddingPiiData(
      wedding.id,
      {
        brideFirstName: req.body.brideFirstName,
        brideLastName: req.body.brideLastName,
        bridePhone,
        groomFirstName: req.body.groomFirstName,
        groomLastName: req.body.groomLastName,
        groomPhone,
        primaryEmail: req.body.primaryEmail,
        note: req.body.note || null
      },
      wedding.piiRevision + 1
    );
    const nextApplicationPii = buildBookingApplicationPiiData(
      wedding.application.id,
      {
        brideFirstName: req.body.brideFirstName,
        brideLastName: req.body.brideLastName,
        bridePhone,
        groomFirstName: req.body.groomFirstName,
        groomLastName: req.body.groomLastName,
        groomPhone,
        primaryEmail: req.body.primaryEmail,
        note: req.body.note || null,
        rejectionReason: currentApplicationPii.rejectionReason
      },
      wedding.application.piiRevision + 1
    );

    let nextUsername: string | undefined;
    let nextPasswordHash: string | undefined;
    const now = new Date();
    if (regenerateCredentials) {
      nextPasswordHash = await hashPassword(createOpaqueToken(48));
    }

    const updateWedding = () =>
      prisma
        .$transaction(
          async (transaction) => {
            await assertVenueScheduleAvailable(transaction, {
              venueId: req.body.venueId,
              startsAt,
              endsAt,
              excludeWeddingId: wedding.id,
              excludeApplicationId: wedding.applicationId
            });

            if (req.body.venueId !== wedding.venueId) {
              const incompatibleAssignments = await transaction.weddingAssignment.count({
                where: {
                  weddingId: wedding.id,
                  staff: { venueId: { not: req.body.venueId } }
                }
              });
              if (incompatibleAssignments > 0) {
                throw new AppError(
                  "Salon değişmeden önce farklı salona bağlı personel atamalarını kaldırın.",
                  409,
                  true,
                  { code: "VENUE_ASSIGNMENT_MISMATCH" }
                );
              }
            }

            const claimedWedding = await transaction.wedding.updateMany({
              where: {
                id: wedding.id,
                updatedAt: wedding.updatedAt,
                piiRevision: wedding.piiRevision,
                cancelledAt: null,
                deletedAt: null
              },
              data: {
                ...nextWeddingPii,
                primaryContact: req.body.primaryContact,
                startsAt,
                endsAt,
                venueId: req.body.venueId,
                packageSummary
              }
            });
            if (claimedWedding.count !== 1) {
              throw new AppError("Düğün kaydı başka bir işlemde güncellendi.", 409);
            }

            await transaction.bookingApplication.update({
              where: {
                id: wedding.applicationId,
                updatedAt: wedding.application.updatedAt,
                piiRevision: wedding.application.piiRevision
              },
              data: {
                ...nextApplicationPii,
                primaryContact: req.body.primaryContact,
                weddingStartsAt: startsAt,
                weddingEndsAt: endsAt,
                venueId: req.body.venueId,
                packageId: selectedPackage.id,
                packageCodeSnapshot: selectedPackage.code,
                packageNameSnapshot: selectedPackage.name,
                packagePriceCents: selectedPackage.priceCents,
                totalPriceCents,
                payableNowCents
              }
            });

            await transaction.bookingApplicationService.deleteMany({
              where: { applicationId: wedding.applicationId }
            });
            if (selectedServices.length) {
              await transaction.bookingApplicationService.createMany({
                data: selectedServices.map((service) => ({
                  applicationId: wedding.applicationId,
                  serviceId: service.id,
                  codeSnapshot: service.code,
                  nameSnapshot: service.name,
                  priceCents: service.priceCents
                }))
              });
            }

            if (regenerateCredentials && nextUsername && nextPasswordHash) {
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
                  temporaryPasswordExpiresAt: null,
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
              await transaction.trustedDevice.updateMany({
                where: { userId: wedding.customerUserId, revokedAt: null },
                data: { revokedAt: now }
              });
              await transaction.passwordSetupToken.updateMany({
                where: { userId: wedding.customerUserId, usedAt: null, revokedAt: null },
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

            const pendingMessageTasks = await transaction.messageTask.findMany({
              where: { weddingId: wedding.id, status: "PENDING" },
              select: { id: true, updatedAt: true, piiRevision: true }
            });
            for (const pendingTask of pendingMessageTasks) {
              const claimedTask = await transaction.messageTask.updateMany({
                where: {
                  id: pendingTask.id,
                  status: "PENDING",
                  updatedAt: pendingTask.updatedAt,
                  piiRevision: pendingTask.piiRevision
                },
                data: buildMessageTaskPiiData(
                  pendingTask.id,
                  { recipientPhone },
                  pendingTask.piiRevision + 1
                )
              });
              if (claimedTask.count !== 1) {
                throw new AppError("Mesaj görevi başka bir işlemde güncellendi.", 409);
              }
            }

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

            if (regenerateCredentials && nextUsername && nextPasswordHash) {
              await transaction.messageTask.updateMany({
                where: {
                  weddingId: wedding.id,
                  kind: "PASSWORD_RESET",
                  status: "PENDING"
                },
                data: {
                  status: "CANCELLED",
                  sentAt: null,
                  sentById: null,
                  secretCiphertext: null,
                  secretIv: null,
                  secretAuthTag: null
                }
              });
              const existingActivationTask = await transaction.messageTask.findUnique({
                where: {
                  weddingId_kind: {
                    weddingId: wedding.id,
                    kind: "ACCOUNT_ACTIVATION"
                  }
                }
              });
              if (existingActivationTask) {
                await transaction.messageTask.update({
                  where: {
                    id: existingActivationTask.id,
                    piiRevision: existingActivationTask.piiRevision
                  },
                  data: {
                    ...buildMessageTaskPiiData(
                      existingActivationTask.id,
                      { recipientPhone },
                      existingActivationTask.piiRevision + 1
                    ),
                    status: "PENDING",
                    dueAt: activationAt,
                    sentAt: null,
                    sentById: null,
                    secretCiphertext: null,
                    secretIv: null,
                    secretAuthTag: null
                  }
                });
              } else {
                const activationTaskId = randomUUID();
                await transaction.messageTask.create({
                  data: {
                    id: activationTaskId,
                    weddingId: wedding.id,
                    kind: "ACCOUNT_ACTIVATION",
                    dueAt: activationAt,
                    ...buildMessageTaskPiiData(activationTaskId, { recipientPhone }, 1)
                  }
                });
              }
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
                packageChanged: currentPackageSummary.code !== selectedPackage.code,
                servicesChanged:
                  currentServiceCodes.size !== uniqueServiceCodes.length ||
                  uniqueServiceCodes.some((code) => !currentServiceCodes.has(code)),
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
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
        )
        .catch((error: unknown) => {
          if (isPrismaError(error, "P2034")) {
            throw new AppError("Düğün takvimi başka bir işlemde güncellendi. Tekrar deneyin.", 409);
          }
          throw error;
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
        ...weddingWithDecryptedPii(updated),
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

    const hasDriveUrlUpdate = Object.hasOwn(req.body, "driveUrl");
    const driveUrlData = hasDriveUrlUpdate
      ? buildDeliveryDriveUrlData(
          delivery.id,
          typeof req.body.driveUrl === "string" ? assertGoogleDriveUrl(req.body.driveUrl) : null
        )
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
          ...(driveUrlData ?? {})
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
          driveUrlChanged: hasDriveUrlUpdate
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
        where: { id: delivery.weddingId }
      });
      const currentWeddingPii = decryptWeddingPii(currentWedding.id, currentWedding);
      const recipientPhone =
        currentWedding.primaryContact === "GELIN"
          ? currentWeddingPii.bridePhone
          : currentWeddingPii.groomPhone;
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
      const existingDeliveryTask = await transaction.messageTask.findUnique({
        where: {
          weddingId_kind: {
            weddingId: delivery.weddingId,
            kind: "DELIVERY_READY"
          }
        }
      });
      if (existingDeliveryTask) {
        await transaction.messageTask.update({
          where: {
            id: existingDeliveryTask.id,
            piiRevision: existingDeliveryTask.piiRevision
          },
          data: {
            ...buildMessageTaskPiiData(
              existingDeliveryTask.id,
              { recipientPhone },
              existingDeliveryTask.piiRevision + 1
            ),
            status: "PENDING",
            dueAt: now,
            sentAt: null,
            sentById: null
          }
        });
      } else {
        const deliveryTaskId = randomUUID();
        await transaction.messageTask.create({
          data: {
            id: deliveryTaskId,
            weddingId: delivery.weddingId,
            kind: "DELIVERY_READY",
            dueAt: now,
            ...buildMessageTaskPiiData(deliveryTaskId, { recipientPhone }, 1)
          }
        });
      }
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

const catalogRoutes = (path: "packages" | "services", schema: z.ZodObject<any>) => {
  const targetType = path === "packages" ? "Package" : "Service";
  const actionPrefix = path === "packages" ? "package" : "service";
  const partialSchema = schema
    .partial()
    .refine(
      (value: Record<string, unknown>) => Object.keys(value).length > 0,
      "En az bir alan gönderin."
    );

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
    requireRecentAdminStepUp,
    validateRequest(
      z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
    ),
    asyncHandler(async (req, res) => {
      let row;
      try {
        const id = req.params.id;
        row = await prisma.$transaction(async (transaction) => {
          const lockedRows =
            path === "packages"
              ? await transaction.$queryRaw<Array<{ id: string; name: string }>>`
                  SELECT "id", "name" FROM "packages" WHERE "id" = ${id} FOR UPDATE
                `
              : await transaction.$queryRaw<Array<{ id: string; name: string }>>`
                  SELECT "id", "name" FROM "services" WHERE "id" = ${id} FOR UPDATE
                `;
          if (lockedRows.length !== 1) throw new AppError("Katalog kaydı bulunamadı.", 404);
          if (
            normalizeConfirmation(req.body.confirmText) !==
            normalizeConfirmation(lockedRows[0]!.name)
          ) {
            throw new AppError("Onay metni katalog adıyla eşleşmiyor.", 400);
          }

          const isReferenced =
            path === "packages"
              ? (await transaction.bookingApplication.count({ where: { packageId: id } })) > 0
              : (await transaction.bookingApplicationService.count({ where: { serviceId: id } })) >
                0;

          let result;
          if (isReferenced) {
            result =
              path === "packages"
                ? await transaction.package.update({
                    where: { id },
                    data: { isActive: false }
                  })
                : await transaction.service.update({
                    where: { id },
                    data: { isActive: false }
                  });
          } else {
            const deleted =
              path === "packages"
                ? await transaction.package.delete({ where: { id } })
                : await transaction.service.delete({ where: { id } });
            result = { ...deleted, isActive: false };
          }

          await createAudit(transaction, {
            actorUserId: req.auth!.userId,
            action: `${actionPrefix}.${isReferenced ? "deactivated" : "deleted"}`,
            targetType,
            targetId: result.id,
            correlationId: req.correlationId,
            metadata: { reason: req.body.reason }
          });
          return result;
        });
      } catch (error) {
        throwCatalogError(error);
      }
      res.json({ success: true, data: row, correlationId: req.correlationId });
    })
  );
};

const venueUpdateBodySchema = venueBodySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "En az bir alan gönderin.");

router.get(
  "/venues",
  validateRequest(z.object({ body: emptyBody, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const venues = await prisma.venue.findMany({
      orderBy: [{ isFeatured: "desc" }, { displayOrder: "asc" }, { name: "asc" }]
    });
    res.json({ success: true, data: venues, correlationId: req.correlationId });
  })
);

router.post(
  "/venues",
  verifyCsrf,
  validateRequest(z.object({ body: venueBodySchema, query: emptyQuery, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    let venue;
    try {
      venue = await prisma.$transaction(async (transaction) => {
        const created = await transaction.venue.create({ data: req.body });
        assertVenueShowcaseReady(created);
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "venue.created",
          targetType: "Venue",
          targetId: created.id,
          correlationId: req.correlationId
        });
        return created;
      });
    } catch (error) {
      throwVenueError(error);
    }
    res.status(201).json({ success: true, data: venue, correlationId: req.correlationId });
  })
);

router.patch(
  "/venues/:id",
  verifyCsrf,
  validateRequest(
    z.object({ body: venueUpdateBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    let venue;
    try {
      venue = await prisma.$transaction(async (transaction) => {
        const updated = await transaction.venue.update({
          where: { id: req.params.id },
          data: req.body
        });
        assertVenueShowcaseReady(updated);
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "venue.updated",
          targetType: "Venue",
          targetId: updated.id,
          correlationId: req.correlationId
        });
        return updated;
      });
    } catch (error) {
      throwVenueError(error);
    }
    res.json({ success: true, data: venue, correlationId: req.correlationId });
  })
);

router.delete(
  "/venues/:id",
  verifyCsrf,
  requireRecentAdminStepUp,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    let venue;
    try {
      const id = req.params.id;
      venue = await prisma.$transaction(async (transaction) => {
        const lockedRows = await transaction.$queryRaw<Array<{ id: string; name: string }>>`
          SELECT "id", "name" FROM "venues" WHERE "id" = ${id} FOR UPDATE
        `;
        if (lockedRows.length !== 1) throw new AppError("Mekân bulunamadı.", 404);
        if (
          normalizeConfirmation(req.body.confirmText) !== normalizeConfirmation(lockedRows[0]!.name)
        ) {
          throw new AppError("Onay metni mekân adıyla eşleşmiyor.", 400);
        }

        const referenceCounts = await Promise.all([
          transaction.user.count({ where: { venueId: id } }),
          transaction.bookingApplication.count({ where: { venueId: id } }),
          transaction.wedding.count({ where: { venueId: id } }),
          transaction.staff.count({ where: { venueId: id } })
        ]);
        const isReferenced = referenceCounts.some((count) => count > 0);
        const result = isReferenced
          ? await transaction.venue.update({
              where: { id },
              data: { isActive: false, isFeatured: false }
            })
          : {
              ...(await transaction.venue.delete({ where: { id } })),
              isActive: false,
              isFeatured: false
            };

        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: `venue.${isReferenced ? "deactivated" : "deleted"}`,
          targetType: "Venue",
          targetId: result.id,
          correlationId: req.correlationId,
          metadata: { reason: req.body.reason }
        });
        return result;
      });
    } catch (error) {
      throwVenueError(error);
    }
    res.json({ success: true, data: venue, correlationId: req.correlationId });
  })
);

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
          }
        },
        sentBy: { select: { username: true } }
      },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: 300
    });
    const safeTasks = tasks.map((rawTask) => {
      const decryptedTask = messageTaskWithDecryptedPii(rawTask);
      const {
        secretCiphertext: _ciphertext,
        secretIv: _iv,
        secretAuthTag: _tag,
        encryptionVersion: _secretEncryptionVersion,
        wedding: rawWedding,
        ...task
      } = decryptedTask;
      return { ...task, wedding: weddingNames(rawWedding) };
    });
    res.json({ success: true, data: safeTasks, correlationId: req.correlationId });
  })
);

const renderMessage = async (
  taskId: string,
  actorUserId: string,
  adminStepUpVerifiedAt: Date | null,
  transaction: Prisma.TransactionClient = prisma
) => {
  const task = await transaction.messageTask.findUnique({
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
  const isSensitiveCredentialTask =
    task.kind === "ACCOUNT_ACTIVATION" || task.kind === "PASSWORD_RESET";
  if (isSensitiveCredentialTask) {
    assertRecentAdminStepUp(adminStepUpVerifiedAt);
  }
  if (isSensitiveCredentialTask && task.status !== "PENDING") {
    throw new AppError("Bu parola bağlantısı görevi artık etkin değil.", 409);
  }

  const weddingPii = decryptWeddingPii(task.wedding.id, task.wedding);
  const taskPii = decryptMessageTaskPii(task.id, task);
  const couple = `${weddingPii.brideFirstName} & ${weddingPii.groomFirstName}`;
  let message: string;
  if (task.kind === "ACCOUNT_ACTIVATION") {
    const setup = await issuePasswordSetupToken(transaction, {
      userId: task.wedding.customerUser.id,
      purpose: "ACCOUNT_ACTIVATION",
      createdById: actorUserId,
      notBefore: task.wedding.customerUser.activeAt
    });
    const setupUrl = createPasswordSetupUrl(setup.token);
    message = `Merhaba ${couple}.\n\nDüğün Ajansım teslimat paneliniz hazır.\nKullanıcı adı: ${task.wedding.customerUser.username}\nTek kullanımlık parola belirleme bağlantısı: ${setupUrl}\n\nBağlantı yalnız bir kez kullanılabilir.`;
  } else if (task.kind === "PASSWORD_RESET") {
    const setup = await issuePasswordSetupToken(transaction, {
      userId: task.wedding.customerUser.id,
      purpose: "PASSWORD_RESET",
      createdById: actorUserId,
      notBefore: task.wedding.customerUser.activeAt
    });
    const setupUrl = createPasswordSetupUrl(setup.token);
    message = `Merhaba ${couple}.\n\nKullanıcı adı: ${task.wedding.customerUser.username}\nTek kullanımlık parola sıfırlama bağlantısı: ${setupUrl}\n\nBağlantı yalnız bir kez kullanılabilir.`;
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

  const phone = taskPii.recipientPhone.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(phone)) {
    throw new AppError("Mesaj görevinin alıcı telefonu geçersiz.", 409);
  }
  return {
    task,
    message,
    whatsappUrl: `https://wa.me/${phone}`
  };
};

router.post(
  "/message-tasks/:id/render",
  verifyCsrf,
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const rendered = await prisma.$transaction(async (transaction) => {
      const result = await renderMessage(
        req.params.id,
        req.auth!.userId,
        req.auth!.adminStepUpVerifiedAt,
        transaction
      );
      if (result.task.kind === "ACCOUNT_ACTIVATION" || result.task.kind === "PASSWORD_RESET") {
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "message.password_setup_link_issued",
          targetType: "MessageTask",
          targetId: result.task.id,
          correlationId: req.correlationId,
          metadata: {
            weddingId: result.task.weddingId,
            kind: result.task.kind
          }
        });
      }
      return result;
    });
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
  requireRecentAdminStepUp,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: { customerWedding: true }
    });
    if (!user || user.role !== "MUSTERI" || !user.customerWedding) {
      throw new AppError("Müşteri hesabı bulunamadı.", 404);
    }
    if (normalizeConfirmation(req.body.confirmText) !== normalizeConfirmation(user.username)) {
      throw new AppError("Onay metni müşteri kullanıcı adıyla eşleşmiyor.", 400);
    }

    const passwordHash = await hashPassword(createOpaqueToken(48));
    const now = new Date();
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
        where: { id: user.customerWedding!.id }
      });
      const currentWeddingPii = decryptWeddingPii(currentWedding.id, currentWedding);
      const recipientPhone =
        currentWedding.primaryContact === "GELIN"
          ? currentWeddingPii.bridePhone
          : currentWeddingPii.groomPhone;
      const claimedUser = await transaction.user.updateMany({
        where: { id: user.id, updatedAt: user.updatedAt, role: "MUSTERI" },
        data: {
          passwordHash,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: null,
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
      await transaction.trustedDevice.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now }
      });
      await transaction.passwordSetupToken.updateMany({
        where: { userId: user.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now }
      });
      await transaction.messageTask.updateMany({
        where: {
          weddingId: user.customerWedding!.id,
          kind: "ACCOUNT_ACTIVATION",
          status: "PENDING"
        },
        data: {
          status: "CANCELLED",
          sentAt: null,
          sentById: null,
          secretCiphertext: null,
          secretIv: null,
          secretAuthTag: null
        }
      });
      const existingResetTask = await transaction.messageTask.findUnique({
        where: {
          weddingId_kind: {
            weddingId: user.customerWedding!.id,
            kind: "PASSWORD_RESET"
          }
        }
      });
      const messageTask = existingResetTask
        ? await transaction.messageTask.update({
            where: {
              id: existingResetTask.id,
              piiRevision: existingResetTask.piiRevision
            },
            data: {
              ...buildMessageTaskPiiData(
                existingResetTask.id,
                { recipientPhone },
                existingResetTask.piiRevision + 1
              ),
              status: "PENDING",
              dueAt: now,
              sentAt: null,
              sentById: null,
              secretCiphertext: null,
              secretIv: null,
              secretAuthTag: null
            }
          })
        : await (() => {
            const resetTaskId = randomUUID();
            return transaction.messageTask.create({
              data: {
                id: resetTaskId,
                weddingId: user.customerWedding!.id,
                kind: "PASSWORD_RESET",
                dueAt: now,
                ...buildMessageTaskPiiData(resetTaskId, { recipientPhone }, 1)
              }
            });
          })();
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "customer.password_reset",
        targetType: "User",
        targetId: user.id,
        correlationId: req.correlationId,
        metadata: { reason: req.body.reason }
      });
      return messageTask;
    });
    const rendered = await renderMessage(
      task.id,
      req.auth!.userId,
      req.auth!.adminStepUpVerifiedAt
    );
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: { taskId: task.id, message: rendered.message, whatsappUrl: rendered.whatsappUrl },
      correlationId: req.correlationId
    });
  })
);

router.post(
  "/customers/:id/reset-mfa",
  verifyCsrf,
  requireRecentAdminStepUp,
  validateRequest(
    z.object({ body: permanentDeleteBodySchema, query: emptyQuery, params: uuidParamsSchema })
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        username: true,
        role: true,
        updatedAt: true,
        totpSecretCiphertext: true,
        totpEnabledAt: true,
        customerWedding: { select: { id: true } }
      }
    });
    if (!user || user.role !== "MUSTERI" || !user.customerWedding) {
      throw new AppError("Müşteri hesabı bulunamadı.", 404);
    }
    if (normalizeConfirmation(req.body.confirmText) !== normalizeConfirmation(user.username)) {
      throw new AppError("Onay metni müşteri kullanıcı adıyla eşleşmiyor.", 400);
    }
    if (user.totpEnabledAt === null) {
      throw new AppError("Müşteri hesabında etkin iki adımlı doğrulama bulunmuyor.", 409);
    }

    const now = new Date();
    const result = await prisma.$transaction(
      async (transaction) => {
        const claimedUser = await transaction.user.updateMany({
          where: {
            id: user.id,
            role: "MUSTERI",
            updatedAt: user.updatedAt,
            totpEnabledAt: user.totpEnabledAt,
            totpSecretCiphertext: user.totpSecretCiphertext
          },
          data: {
            totpSecretCiphertext: null,
            totpSecretIv: null,
            totpSecretAuthTag: null,
            totpKeyId: null,
            totpEnrollmentExpiresAt: null,
            totpEnabledAt: null,
            totpLastUsedStep: null
          }
        });
        if (claimedUser.count !== 1) {
          throw new AppError("Müşteri MFA kaydı başka bir işlemde güncellendi.", 409);
        }
        const revokedSessions = await transaction.authSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now }
        });
        const revokedDevices = await transaction.trustedDevice.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now }
        });
        const revokedSetupTokens = await transaction.passwordSetupToken.updateMany({
          where: { userId: user.id, usedAt: null, revokedAt: null },
          data: { revokedAt: now }
        });
        await createAudit(transaction, {
          actorUserId: req.auth!.userId,
          action: "customer.mfa_recovery_reset",
          targetType: "User",
          targetId: user.id,
          correlationId: req.correlationId,
          metadata: {
            reason: req.body.reason,
            sessionsRevoked: revokedSessions.count,
            trustedDevicesRevoked: revokedDevices.count,
            passwordSetupTokensRevoked: revokedSetupTokens.count
          }
        });
        return {
          sessionsRevoked: revokedSessions.count,
          passwordSetupTokensRevoked: revokedSetupTokens.count
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
    );

    res.json({
      success: true,
      data: { mfaEnabled: false, ...result },
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
