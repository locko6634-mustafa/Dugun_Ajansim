import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import {
  authenticate,
  requireChangedPassword,
  requireRole,
} from '../middlewares/auth.middleware.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { decryptDeliveryDriveUrl } from '../utils/delivery-crypto.js';
import { decryptWeddingPii } from '../utils/pii-crypto.js';

const router = Router();
router.use(authenticate, requireChangedPassword, requireRole('MUSTERI'));

const emptyRequestSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

const customerDashboardSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({
    weddingId: z.string().optional(),
  }).strict(),
  params: z.object({}).strict(),
});

const getCustomerWedding = (userId: string) =>
  prisma.wedding.findUnique({
    where: { customerUserId: userId },
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
      piiSchemaVersion: true,
      startsAt: true,
      endsAt: true,
      packageSummary: true,
      venue: { select: { name: true } },
      delivery: {
        include: { history: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });

router.get(
  '/dashboard',
  validateRequest(customerDashboardSchema),
  asyncHandler(async (req, res) => {
    const wedding = await getCustomerWedding(req.auth!.userId);
    if (!wedding || !wedding.delivery) throw new AppError('Düğün kaydı bulunamadı.', 404);
    const weddingPii = decryptWeddingPii(wedding.id, {
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
      piiSchemaVersion: wedding.piiSchemaVersion,
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        couple: {
          bride: `${weddingPii.brideFirstName} ${weddingPii.brideLastName}`,
          groom: `${weddingPii.groomFirstName} ${weddingPii.groomLastName}`,
        },
        venue: wedding.venue.name,
        startsAt: wedding.startsAt,
        endsAt: wedding.endsAt,
        packageSummary: wedding.packageSummary,
        delivery: {
          status: wedding.delivery.status,
          dueDate: wedding.delivery.dueDate,
          releasedAt: wedding.delivery.releasedAt,
          history: wedding.delivery.history.map((entry) => ({
            status: entry.toStatus,
            createdAt: entry.createdAt,
          })),
        },
      },
      correlationId: req.correlationId,
    });
  }),
);

router.get(
  '/delivery',
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const wedding = await getCustomerWedding(req.auth!.userId);
    const delivery = wedding?.delivery;
    if (
      !delivery ||
      delivery.status !== 'TESLIM_EDILDI' ||
      !delivery.releasedAt
    ) {
      throw new AppError('Teslimat bağlantınız henüz yayınlanmadı.', 404);
    }

    const driveUrl = decryptDeliveryDriveUrl(delivery);
    if (driveUrl === null) {
      throw new AppError('Teslimat bağlantınız henüz yayınlanmadı.', 404);
    }
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { driveUrl, releasedAt: delivery.releasedAt },
      correlationId: req.correlationId,
    });
  }),
);

export default router;
