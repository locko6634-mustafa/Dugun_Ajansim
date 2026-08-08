import { Router, type Request } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.config.js";
import {
  createRateLimitHandler,
  rateLimitKeyGenerator
} from "../middlewares/rateLimit.middleware.js";
import { validateRequest } from "../middlewares/validate.middleware.js";
import {
  bookingBodySchema,
  bookingFormConstraints,
  bookingSchedulePolicy
} from "../schemas/api.schemas.js";
import {
  createBookingApplication,
  getPaymentFlowApplication,
  getVenueAvailability,
  markWhatsappHandoff,
  paymentPolicy,
  updatePaymentFlowApplication
} from "../services/booking.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();
const publicBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  handler: createRateLimitHandler("Çok fazla başvuru denemesi yaptınız.")
});

const emptyRequestSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({}).strict()
});

const availabilitySchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih YYYY-MM-DD formatında olmalıdır.")
  }),
  params: z.object({
    venueId: z.string().uuid("Geçerli bir salon IDsi girilmelidir.")
  })
});

const paymentFlowParamsSchema = z.object({
  id: z.string().uuid("Geçerli bir başvuru IDsi girilmelidir.")
});

const paymentFlowReadSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: paymentFlowParamsSchema
});

const paymentFlowUpdateSchema = z.object({
  body: bookingBodySchema,
  query: z.object({}).strict(),
  params: paymentFlowParamsSchema
});

const getPaymentFlowKey = (req: Request): string => {
  const key = req.get("Payment-Flow-Key");
  if (!key || !/^[A-Za-z0-9._~-]{32,128}$/.test(key)) {
    throw new AppError("Ödeme akışı anahtarı geçersiz.", 400);
  }
  return key;
};

router.get(
  "/payment-instructions",
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const isTest = env.PAYMENT_MODE === "test";
    res.set("Cache-Control", "no-store");
    res.json({
      success: true,
      data: {
        mode: env.PAYMENT_MODE,
        enabled: true,
        bankName: env.PAYMENT_BANK_NAME,
        accountHolder: env.PAYMENT_ACCOUNT_HOLDER,
        iban: env.PAYMENT_IBAN,
        whatsappPhone: env.PAYMENT_WHATSAPP_PHONE,
        notice: isTest
          ? "Test ödeme bilgileri — gerçek para göndermeyin."
          : "Havale/EFT açıklamasına size özel DA referans numaranızı yazın."
      },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/catalog",
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const [packages, services] = await Promise.all([
      prisma.package.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
      prisma.service.findMany({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { name: "asc" }]
      })
    ]);
    res.json({
      success: true,
      data: {
        packages,
        services,
        paymentPolicy,
        bookingFormConstraints,
        bookingSchedulePolicy
      },
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/venues",
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const venues = await prisma.venue.findMany({
      where: { isActive: true, isPartner: true },
      select: {
        id: true,
        slug: true,
        name: true,
        displayName: true,
        imagePath: true,
        displayOrder: true,
        isFeatured: true
      },
      orderBy: [{ displayOrder: "asc" }, { name: "asc" }]
    });
    res.json({ success: true, data: venues, correlationId: req.correlationId });
  })
);

router.get(
  "/venues/:venueId/availability",
  validateRequest(availabilitySchema),
  asyncHandler(async (req, res) => {
    const { venueId } = req.params;
    const { date } = req.query as { date: string };
    const availability = await getVenueAvailability(venueId, date);
    res.json({ success: true, data: availability, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications",
  publicBookingLimiter,
  validateRequest(
    z.object({
      body: bookingBodySchema,
      query: z.object({}).strict(),
      params: z.object({}).strict()
    })
  ),
  asyncHandler(async (req, res) => {
    const rawKey = req.get("Idempotency-Key");
    if (rawKey !== undefined && !/^[A-Za-z0-9._-]{16,128}$/.test(rawKey)) {
      throw new AppError("Idempotency-Key biçimi geçersiz.", 400);
    }
    const idempotencyKey = rawKey;
    const paymentFlowKey = getPaymentFlowKey(req);
    const application = await createBookingApplication(req.body, {
      source: "PUBLIC_FORM",
      idempotencyKey,
      paymentFlowKey,
      correlationId: req.correlationId
    });
    res.set("Cache-Control", "no-store");
    res.status(201).json({
      success: true,
      data: application,
      correlationId: req.correlationId
    });
  })
);

router.get(
  "/booking-applications/:id/payment-flow",
  validateRequest(paymentFlowReadSchema),
  asyncHandler(async (req, res) => {
    const application = await getPaymentFlowApplication(
      req.params.id,
      getPaymentFlowKey(req),
      req.correlationId
    );
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: application, correlationId: req.correlationId });
  })
);

router.patch(
  "/booking-applications/:id/payment-flow",
  publicBookingLimiter,
  validateRequest(paymentFlowUpdateSchema),
  asyncHandler(async (req, res) => {
    const application = await updatePaymentFlowApplication(
      req.params.id,
      req.body,
      getPaymentFlowKey(req),
      req.correlationId
    );
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: application, correlationId: req.correlationId });
  })
);

router.post(
  "/booking-applications/:id/whatsapp-handoff",
  publicBookingLimiter,
  validateRequest(paymentFlowReadSchema),
  asyncHandler(async (req, res) => {
    const application = await markWhatsappHandoff(
      req.params.id,
      getPaymentFlowKey(req),
      req.correlationId
    );
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: application, correlationId: req.correlationId });
  })
);

export default router;
