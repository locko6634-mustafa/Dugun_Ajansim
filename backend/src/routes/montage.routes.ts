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
import { calendarQuerySchema, uuidParamsSchema } from "../schemas/api.schemas.js";
import { createAudit } from "../services/booking.service.js";
import { releaseDelivery } from "../services/delivery-release.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { buildDeliveryDriveUrlData, decryptDeliveryDriveUrl } from "../utils/delivery-crypto.js";
import {
  assertDeliveryLinkUrl,
  atIstanbulTime,
  deliveryStatuses,
  getIstanbulDate
} from "../utils/domain.js";
import { decryptWeddingPii, staffWithDecryptedPii } from "../utils/pii-crypto.js";

const router = Router();
router.use(authenticate, requireChangedPassword, requireRole("MONTAJCI"));
router.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const emptyQuery = z.object({}).strict();
const emptyBody = z.object({}).strict();
const uuidRequest = z.object({ body: emptyBody, query: emptyQuery, params: uuidParamsSchema });
const montageDeliveryStatusSchema = z.enum([
  "HAZIRLANIYOR",
  "MONTAJ",
  "KONTROL",
  "TESLIME_HAZIR"
]);
const deliveryPrepareRequest = z.object({
  body: z
    .object({
      status: montageDeliveryStatusSchema.optional(),
      driveUrl: z.string().trim().url().max(2_000).nullable().optional()
    })
    .strict()
    .refine((body) => Object.hasOwn(body, "status") || Object.hasOwn(body, "driveUrl"), {
      message: "En az bir teslimat alanı gönderilmelidir."
    }),
  query: emptyQuery,
  params: uuidParamsSchema
});
const deliveryReleaseRequest = z.object({
  body: z
    .object({
      sharingConfirmed: z.literal(true),
      sharingConfirmation: z.literal("ERİŞİMİ DOĞRULADIM")
    })
    .strict(),
  query: emptyQuery,
  params: uuidParamsSchema
});

const nextMonthOf = (month: string): string => {
  const [year, monthNumber] = month.split("-").map(Number);
  const next = new Date(Date.UTC(year!, monthNumber!, 1));
  return next.toISOString().slice(0, 7);
};

const weddingPiiSelect = {
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
} as const;

const montageWeddingDto = <
  Wedding extends { id: string } & Parameters<typeof decryptWeddingPii>[1]
>(
  wedding: Wedding
) => {
  const pii = decryptWeddingPii(wedding.id, wedding);
  return {
    ...wedding,
    brideFirstName: pii.brideFirstName,
    brideLastName: pii.brideLastName,
    bridePhone: pii.bridePhone,
    groomFirstName: pii.groomFirstName,
    groomLastName: pii.groomLastName,
    groomPhone: pii.groomPhone,
    primaryEmail: pii.primaryEmail,
    note: pii.note
  };
};

router.get(
  "/calendar",
  validateRequest(z.object({ body: emptyBody, query: calendarQuerySchema, params: z.object({}) })),
  asyncHandler(async (req, res) => {
    const today = getIstanbulDate(new Date());
    const month = req.query.month ? String(req.query.month) : today.slice(0, 7);
    const venues = await prisma.venue.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    });
    const selectedVenue = req.query.venueId
      ? venues.find((venue) => venue.id === String(req.query.venueId))
      : null;
    if (req.query.venueId && !selectedVenue) throw new AppError("Salon bulunamadı.", 404);

    const weddings = await prisma.wedding.findMany({
      where: {
        ...(selectedVenue ? { venueId: selectedVenue.id } : {}),
        cancelledAt: null,
        deletedAt: null,
        startsAt: { lt: atIstanbulTime(`${nextMonthOf(month)}-01`, "00:00") },
        endsAt: { gt: atIstanbulTime(`${month}-01`, "00:00") }
      },
      select: {
        id: true,
        ...weddingPiiSelect,
        startsAt: true,
        endsAt: true,
        venue: { select: { id: true, name: true } },
        delivery: {
          select: {
            id: true,
            status: true,
            dueDate: true,
            releasedAt: true,
            manualStatusOverrideAt: true,
            driveUrlCiphertext: true
          }
        }
      },
      orderBy: { startsAt: "asc" }
    });

    res.json({
      success: true,
      data: {
        month,
        today,
        venues,
        selectedVenue,
        weddings: weddings.map((wedding) => {
          const { driveUrlCiphertext, ...delivery } = wedding.delivery ?? {
            driveUrlCiphertext: null
          };
          const safeWedding = montageWeddingDto(wedding);
          return {
            id: safeWedding.id,
            brideFirstName: safeWedding.brideFirstName,
            groomFirstName: safeWedding.groomFirstName,
            startsAt: safeWedding.startsAt,
            endsAt: safeWedding.endsAt,
            venue: safeWedding.venue,
            delivery: wedding.delivery
              ? {
                  ...delivery,
                  hasDriveUrl: Boolean(driveUrlCiphertext),
                  isStatusManuallyControlled: Boolean(wedding.delivery.manualStatusOverrideAt)
                }
              : null
          };
        })
      },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/weddings/:id",
  validateRequest(uuidRequest),
  asyncHandler(async (req, res) => {
    const wedding = await prisma.wedding.findFirst({
      where: { id: req.params.id, cancelledAt: null, deletedAt: null },
      select: {
        id: true,
        ...weddingPiiSelect,
        primaryContact: true,
        startsAt: true,
        endsAt: true,
        packageSummary: true,
        paymentTotalCents: true,
        paymentDepositCents: true,
        paymentReceivedCents: true,
        createdAt: true,
        updatedAt: true,
        venue: { select: { id: true, name: true } },
        assignments: {
          include: { staff: true },
          orderBy: { createdAt: "asc" }
        },
        delivery: true
      }
    });
    if (!wedding) throw new AppError("Düğün kaydı bulunamadı.", 404);
    const safeWedding = montageWeddingDto(wedding);
    const driveUrl = wedding.delivery ? decryptDeliveryDriveUrl(wedding.delivery) : null;
    res.json({
      success: true,
      data: {
        id: safeWedding.id,
        brideFirstName: safeWedding.brideFirstName,
        brideLastName: safeWedding.brideLastName,
        bridePhone: safeWedding.bridePhone,
        groomFirstName: safeWedding.groomFirstName,
        groomLastName: safeWedding.groomLastName,
        groomPhone: safeWedding.groomPhone,
        primaryContact: safeWedding.primaryContact,
        primaryEmail: safeWedding.primaryEmail,
        startsAt: safeWedding.startsAt,
        endsAt: safeWedding.endsAt,
        venue: safeWedding.venue,
        packageSummary: safeWedding.packageSummary,
        paymentTotalCents: safeWedding.paymentTotalCents,
        paymentDepositCents: safeWedding.paymentDepositCents,
        paymentReceivedCents: safeWedding.paymentReceivedCents,
        paymentRemainingCents: Math.max(
          safeWedding.paymentTotalCents - safeWedding.paymentReceivedCents,
          0
        ),
        note: safeWedding.note,
        assignments: safeWedding.assignments.map((assignment) => {
          const staff = staffWithDecryptedPii(assignment.staff);
          return {
            id: assignment.id,
            specialty: assignment.specialty,
            createdAt: assignment.createdAt,
            staff: {
              id: staff.id,
              firstName: staff.firstName,
              lastName: staff.lastName,
              phone: staff.phone,
              specialties: staff.specialties
            }
          };
        }),
        createdAt: safeWedding.createdAt,
        updatedAt: safeWedding.updatedAt,
        delivery: wedding.delivery
          ? {
              id: wedding.delivery.id,
              status: wedding.delivery.status,
              dueDate: wedding.delivery.dueDate,
              releasedAt: wedding.delivery.releasedAt,
              accessExpiresAt: wedding.delivery.accessExpiresAt,
              isStatusManuallyControlled: Boolean(wedding.delivery.manualStatusOverrideAt),
              updatedAt: wedding.delivery.updatedAt,
              hasDriveUrl: Boolean(driveUrl),
              driveUrl
            }
          : null
      },
      correlationId: req.correlationId
    });
  })
);

router.patch(
  "/deliveries/:id",
  verifyCsrf,
  validateRequest(deliveryPrepareRequest),
  asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUnique({
      where: { id: req.params.id },
      include: {
        wedding: { select: { cancelledAt: true, deletedAt: true } }
      }
    });
    if (!delivery) throw new AppError("Teslimat kaydı bulunamadı.", 404);
    if (delivery.wedding.cancelledAt || delivery.wedding.deletedAt) {
      throw new AppError("İptal edilmiş veya arşivdeki düğünün teslimatı güncellenemez.", 409);
    }
    if (delivery.status === "TESLIM_EDILDI") {
      throw new AppError("Teslim edilmiş kayıt bu işlemle değiştirilemez.", 409);
    }
    const hasDriveUrlUpdate = Object.hasOwn(req.body, "driveUrl");
    const driveUrlData = hasDriveUrlUpdate
      ? buildDeliveryDriveUrlData(
          delivery.id,
          typeof req.body.driveUrl === "string" ? assertDeliveryLinkUrl(req.body.driveUrl) : null
        )
      : undefined;
    const hasStatusUpdate = Object.hasOwn(req.body, "status");
    const nextStatus = req.body.status ?? delivery.status;
    const statusChanged = nextStatus !== delivery.status;
    const transitionDirection = statusChanged
      ? deliveryStatuses.indexOf(nextStatus) > deliveryStatuses.indexOf(delivery.status)
        ? "FORWARD"
        : "BACKWARD"
      : "UNCHANGED";
    const manualStatusOverrideAt = hasStatusUpdate ? new Date() : undefined;
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
          manualStatusOverrideAt,
          ...(driveUrlData ?? {})
        }
      });
      if (claimed.count !== 1) {
        throw new AppError("Teslimat başka bir işlemde güncellendi.", 409);
      }
      if (statusChanged) {
        const history = await transaction.deliveryStatusHistory.createMany({
          data: {
            deliveryId: delivery.id,
            fromStatus: delivery.status,
            toStatus: nextStatus,
            actorUserId: req.auth!.userId
          }
        });
        if (history.count !== 1) throw new Error("Teslimat geçmişi oluşturulamadı.");
      }
      await createAudit(transaction, {
        actorUserId: req.auth!.userId,
        action: "delivery.updated",
        targetType: "Delivery",
        targetId: delivery.id,
        correlationId: req.correlationId,
        metadata: {
          statusChanged: delivery.status !== nextStatus,
          transitionDirection,
          dueDateChanged: false,
          driveUrlChanged: hasDriveUrlUpdate,
          manualStatusOverrideApplied: hasStatusUpdate,
          actorScope: "montage"
        }
      });
      return transaction.delivery.findUniqueOrThrow({
        where: { id: delivery.id },
        select: {
          id: true,
          status: true,
          dueDate: true,
          releasedAt: true,
          manualStatusOverrideAt: true,
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
  validateRequest(deliveryReleaseRequest),
  asyncHandler(async (req, res) => {
    const updated = await releaseDelivery({
      deliveryId: req.params.id,
      actorUserId: req.auth!.userId,
      correlationId: req.correlationId,
      sharingConfirmed: req.body.sharingConfirmed,
      verifyLink: req.app.locals.deliveryLinkAccessVerifier
    });
    res.json({ success: true, data: updated, correlationId: req.correlationId });
  })
);

export default router;
