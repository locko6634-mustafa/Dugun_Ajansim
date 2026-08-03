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
import { decryptValue } from '../utils/crypto.js';
import { deliveryEncryptionAad } from '../utils/domain.js';

const router = Router();
router.use(authenticate, requireChangedPassword, requireRole('MUSTERI'));

const emptyRequestSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

const getCustomerWedding = (userId: string) =>
  prisma.wedding.findUnique({
    where: { customerUserId: userId },
    include: {
      venue: { select: { name: true } },
      delivery: {
        include: { history: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });

router.get(
  '/dashboard',
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const wedding = await getCustomerWedding(req.auth!.userId);
    if (!wedding || !wedding.delivery) throw new AppError('Düğün kaydı bulunamadı.', 404);

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        couple: {
          bride: `${wedding.brideFirstName} ${wedding.brideLastName}`,
          groom: `${wedding.groomFirstName} ${wedding.groomLastName}`,
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
      !delivery.releasedAt ||
      !delivery.driveUrlCiphertext ||
      !delivery.driveUrlIv ||
      !delivery.driveUrlAuthTag
    ) {
      throw new AppError('Teslimat bağlantınız henüz yayınlanmadı.', 404);
    }

    const driveUrl = decryptValue(
      {
        ciphertext: delivery.driveUrlCiphertext,
        iv: delivery.driveUrlIv,
        authTag: delivery.driveUrlAuthTag,
      },
      delivery.encryptionVersion >= 2 ? deliveryEncryptionAad(delivery.id) : undefined,
    );
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { driveUrl, releasedAt: delivery.releasedAt },
      correlationId: req.correlationId,
    });
  }),
);

export default router;
