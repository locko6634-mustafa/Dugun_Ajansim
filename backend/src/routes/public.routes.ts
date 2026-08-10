import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.config.js";
import {
  createRateLimitHandler,
  rateLimitKeyGenerator
} from "../middlewares/rateLimit.middleware.js";
import { DatabaseRateLimitStore } from "../middlewares/databaseRateLimitStore.js";
import { validateRequest } from "../middlewares/validate.middleware.js";
import { getCookie } from "../middlewares/auth.middleware.js";
import {
  bookingBodySchema,
  bookingFormConstraints,
  bookingSchedulePolicy
} from "../schemas/api.schemas.js";
import {
  createBookingApplication,
  getPaymentFlowApplication,
  getPublicVenueAvailability,
  markWhatsappHandoff,
  paymentPolicy,
  updatePaymentFlowApplication
} from "../services/booking.service.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { normalizePhone } from "../utils/domain.js";
import { createOpaqueToken } from "../utils/crypto.js";
import { BOOKING_TURNSTILE_ACTION, verifyBookingBotChallenge } from "../utils/turnstile.js";

const router = Router();
export const PAYMENT_FLOW_COOKIE_NAME = "dugunajansim_payment_flow";
export const paymentFlowCookieOptions = (
  maxAgeMs: number,
  environment: "development" | "production" | "test" = env.NODE_ENV
) => ({
  httpOnly: true,
  secure: environment === "production",
  sameSite: "strict" as const,
  path: "/api/v1/booking-applications",
  maxAge: maxAgeMs
});
const clearPaymentFlowCookie = (res: Response): void => {
  res.clearCookie(PAYMENT_FLOW_COOKIE_NAME, {
    secure: env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/api/v1/booking-applications"
  });
};
const publicBookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  store: new DatabaseRateLimitStore("public-booking-ip"),
  handler: createRateLimitHandler("Çok fazla başvuru denemesi yaptınız.")
});

export const createPublicAvailabilityLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: rateLimitKeyGenerator,
    store: new DatabaseRateLimitStore("public-availability-ip"),
    handler: createRateLimitHandler("Çok fazla uygunluk sorgusu yaptınız.")
  });

const publicAvailabilityLimiter = createPublicAvailabilityLimiter();

const publicBookingContactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const body = req.body as z.infer<typeof bookingBodySchema>;
    return [
      body.primaryEmail.trim().toLowerCase(),
      normalizePhone(body.bridePhone),
      normalizePhone(body.groomPhone)
    ].join("|");
  },
  store: new DatabaseRateLimitStore("public-booking-contact"),
  handler: createRateLimitHandler("Bu iletişim bilgileriyle çok fazla başvuru denemesi yapıldı.")
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
  const key = getCookie(req, PAYMENT_FLOW_COOKIE_NAME) ?? req.get("Payment-Flow-Key");
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
        bookingSchedulePolicy,
        botProtection: {
          provider: "turnstile",
          enabled: env.BOT_PROTECTION_MODE === "turnstile",
          siteKey: env.BOT_PROTECTION_MODE === "turnstile" ? env.TURNSTILE_SITE_KEY : null,
          action: BOOKING_TURNSTILE_ACTION
        }
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
  publicAvailabilityLimiter,
  validateRequest(availabilitySchema),
  asyncHandler(async (req, res) => {
    const { venueId } = req.params;
    const { date } = req.query as { date: string };
    const availability = await getPublicVenueAvailability(venueId, date);
    res.set("Cache-Control", "no-store");
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
  asyncHandler(async (req, _res, next) => {
    const idempotencyKey = req.get("Idempotency-Key");
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) {
      throw new AppError("Idempotency-Key geçerli bir UUID olmalıdır.", 400);
    }
    await verifyBookingBotChallenge({
      token: req.get("Turnstile-Token"),
      remoteIp: req.ip,
      idempotencyKey
    });
    next();
  }),
  publicBookingContactLimiter,
  asyncHandler(async (req, res) => {
    const rawKey = req.get("Idempotency-Key");
    const idempotencyKey = z.string().uuid().parse(rawKey);
    const paymentFlowKey =
      getCookie(req, PAYMENT_FLOW_COOKIE_NAME) ?? req.get("Payment-Flow-Key") ?? createOpaqueToken();
    if (!/^[A-Za-z0-9._~-]{32,128}$/.test(paymentFlowKey)) {
      throw new AppError("Ödeme akışı anahtarı geçersiz.", 400);
    }
    const application = await createBookingApplication(req.body, {
      source: "PUBLIC_FORM",
      idempotencyKey,
      paymentFlowKey,
      correlationId: req.correlationId
    });
    res.cookie(
      PAYMENT_FLOW_COOKIE_NAME,
      paymentFlowKey,
      paymentFlowCookieOptions(env.PAYMENT_HANDOFF_TTL_MINUTES * 60 * 1000)
    );
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
    clearPaymentFlowCookie(res);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: application, correlationId: req.correlationId });
  })
);

export default router;
