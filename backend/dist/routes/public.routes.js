import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { bookingBodySchema } from '../schemas/api.schemas.js';
import { createBookingApplication } from '../services/booking.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const router = Router();
const publicBookingLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Çok fazla başvuru denemesi yaptınız.' },
});
router.get('/catalog', asyncHandler(async (req, res) => {
    const [packages, services] = await Promise.all([
        prisma.package.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.service.findMany({
            where: { isActive: true },
            orderBy: [{ category: 'asc' }, { name: 'asc' }],
        }),
    ]);
    res.json({
        success: true,
        data: { packages, services },
        correlationId: req.correlationId,
    });
}));
router.get('/venues', asyncHandler(async (req, res) => {
    const venues = await prisma.venue.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, name: true },
        orderBy: { name: 'asc' },
    });
    res.json({ success: true, data: venues, correlationId: req.correlationId });
}));
router.post('/booking-applications', publicBookingLimiter, validateRequest(z.object({
    body: bookingBodySchema,
    query: z.object({}),
    params: z.object({}),
})), asyncHandler(async (req, res) => {
    const rawKey = req.get('Idempotency-Key');
    const idempotencyKey = rawKey && /^[A-Za-z0-9._-]{16,128}$/.test(rawKey) ? rawKey : undefined;
    const application = await createBookingApplication(req.body, {
        source: 'PUBLIC_FORM',
        idempotencyKey,
        correlationId: req.correlationId,
    });
    res.status(201).json({
        success: true,
        data: application,
        correlationId: req.correlationId,
    });
}));
export default router;
