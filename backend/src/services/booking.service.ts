import { Prisma, type BookingSource, type User } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import type { z } from 'zod';
import type { bookingBodySchema } from '../schemas/api.schemas.js';
import { AppError } from '../utils/appError.js';
import { encryptValue, hashPassword } from '../utils/crypto.js';
import {
  addCalendarDays,
  atIstanbulTime,
  createWeddingRange,
  getIstanbulDate,
  normalizePhone,
  normalizeUsername,
  randomFourDigitCode,
  randomReferenceCode,
  temporaryWeddingPassword,
} from '../utils/domain.js';

export type BookingInput = Omit<z.infer<typeof bookingBodySchema>, 'privacyConsent'> & {
  privacyConsent: boolean;
};

type CreateBookingOptions = {
  source: BookingSource;
  idempotencyKey?: string;
  actor?: Pick<User, 'id'>;
  correlationId: string;
};

export const calculatePayment = (
  subtotalCents: number,
  paymentMethod: 'CASH' | 'DEPOSIT'
): { totalPriceCents: number; payableNowCents: number } => {
  const totalPriceCents =
    paymentMethod === 'CASH' ? Math.round(subtotalCents * 0.9) : subtotalCents;
  return {
    totalPriceCents,
    payableNowCents:
      paymentMethod === 'CASH' ? totalPriceCents : Math.min(500_000, totalPriceCents),
  };
};

const createAudit = (
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    correlationId: string;
    metadata?: Prisma.InputJsonValue;
  }
) =>
  transaction.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      correlationId: input.correlationId,
      metadata: input.metadata,
    },
  });

export const createBookingApplication = async (
  input: BookingInput,
  options: CreateBookingOptions
) => {
  if (options.idempotencyKey) {
    const existing = await prisma.bookingApplication.findUnique({
      where: { idempotencyKey: options.idempotencyKey },
      select: {
        id: true,
        referenceCode: true,
        status: true,
        totalPriceCents: true,
        payableNowCents: true,
      },
    });
    if (existing) return existing;
  }

  const { startsAt, endsAt } = createWeddingRange(
    input.weddingDate,
    input.startTime,
    input.endTime,
    input.endsNextDay
  );
  if (options.source === 'PUBLIC_FORM' && input.weddingDate < getIstanbulDate(new Date())) {
    throw new AppError('Geçmiş tarihli düğün başvurusu oluşturulamaz.', 400);
  }

  const serviceCodes = [...new Set(input.serviceCodes)];
  const [venue, selectedPackage, selectedServices] = await Promise.all([
    prisma.venue.findFirst({ where: { id: input.venueId, isActive: true } }),
    prisma.package.findFirst({ where: { code: input.packageCode, isActive: true } }),
    prisma.service.findMany({
      where: { code: { in: serviceCodes }, isActive: true },
      orderBy: { code: 'asc' },
    }),
  ]);

  if (!venue) throw new AppError('Seçilen salon artık aktif değil.', 400);
  if (!selectedPackage) throw new AppError('Seçilen paket artık aktif değil.', 400);
  if (selectedServices.length !== serviceCodes.length) {
    throw new AppError('Seçilen hizmetlerden biri artık aktif değil.', 400);
  }

  const subtotalCents =
    selectedPackage.priceCents +
    selectedServices.reduce((sum, service) => sum + service.priceCents, 0);
  const { totalPriceCents, payableNowCents } = calculatePayment(subtotalCents, input.paymentMethod);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const referenceCode = randomReferenceCode();
      return await prisma.$transaction(async (transaction) => {
        const application = await transaction.bookingApplication.create({
          data: {
            referenceCode,
            idempotencyKey: options.idempotencyKey,
            source: options.source,
            brideFirstName: input.brideFirstName,
            brideLastName: input.brideLastName,
            bridePhone: normalizePhone(input.bridePhone),
            groomFirstName: input.groomFirstName,
            groomLastName: input.groomLastName,
            groomPhone: normalizePhone(input.groomPhone),
            primaryContact: input.primaryContact,
            primaryEmail: input.primaryEmail,
            weddingStartsAt: startsAt,
            weddingEndsAt: endsAt,
            venueId: venue.id,
            packageId: selectedPackage.id,
            packageCodeSnapshot: selectedPackage.code,
            packageNameSnapshot: selectedPackage.name,
            packagePriceCents: selectedPackage.priceCents,
            totalPriceCents,
            paymentMethod: input.paymentMethod,
            payableNowCents,
            note: input.note || null,
            privacyConsentAt: input.privacyConsent ? new Date() : null,
            marketingConsentAt: input.marketingConsent ? new Date() : null,
            services: {
              create: selectedServices.map((service) => ({
                serviceId: service.id,
                codeSnapshot: service.code,
                nameSnapshot: service.name,
                priceCents: service.priceCents,
              })),
            },
          },
          select: {
            id: true,
            referenceCode: true,
            status: true,
            totalPriceCents: true,
            payableNowCents: true,
          },
        });

        await createAudit(transaction, {
          actorUserId: options.actor?.id,
          action: 'booking.created',
          targetType: 'BookingApplication',
          targetId: application.id,
          correlationId: options.correlationId,
          metadata: { source: options.source, referenceCode },
        });

        return application;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (options.idempotencyKey) {
          const existing = await prisma.bookingApplication.findUnique({
            where: { idempotencyKey: options.idempotencyKey },
            select: {
              id: true,
              referenceCode: true,
              status: true,
              totalPriceCents: true,
              payableNowCents: true,
            },
          });
          if (existing) return existing;
        }
        continue;
      }
      throw error;
    }
  }

  throw new AppError('Başvuru referansı üretilemedi. Lütfen tekrar deneyin.', 503);
};

export const createUniqueCustomerUsername = async (
  brideLastName: string,
  groomLastName: string
): Promise<string> => {
  const prefix = `${normalizeUsername(brideLastName)}-${normalizeUsername(groomLastName)}`;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = `${prefix}-${randomFourDigitCode()}`;
    const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!exists) return username;
  }
  throw new AppError('Benzersiz müşteri kullanıcı adı üretilemedi.', 503);
};

export const approveBookingApplication = async (
  applicationId: string,
  actorUserId: string,
  correlationId: string
) => {
  const application = await prisma.bookingApplication.findUnique({
    where: { id: applicationId },
    include: { services: true, venue: true },
  });
  if (!application) throw new AppError('Başvuru bulunamadı.', 404);
  if (application.status !== 'ONAY_BEKLIYOR') {
    throw new AppError('Yalnızca onay bekleyen başvurular onaylanabilir.', 409);
  }

  const weddingDate = getIstanbulDate(application.weddingStartsAt);
  const username = await createUniqueCustomerUsername(
    application.brideLastName,
    application.groomLastName
  );
  const temporaryPassword = temporaryWeddingPassword(weddingDate);
  const passwordHash = await hashPassword(temporaryPassword);
  const activeAt = atIstanbulTime(addCalendarDays(weddingDate, 1), '09:00');
  const preparationDueAt = atIstanbulTime(addCalendarDays(weddingDate, 2), '10:00');
  const dueDate = new Date(`${addCalendarDays(weddingDate, 21)}T00:00:00.000Z`);
  const recipientPhone =
    application.primaryContact === 'GELIN' ? application.bridePhone : application.groomPhone;
  const encryptedPassword = encryptValue(temporaryPassword);

  return prisma.$transaction(async (transaction) => {
    const claimed = await transaction.bookingApplication.updateMany({
      where: { id: application.id, status: 'ONAY_BEKLIYOR' },
      data: {
        status: 'ONAYLANDI',
        reviewedAt: new Date(),
        reviewedById: actorUserId,
      },
    });
    if (claimed.count !== 1) throw new AppError('Başvuru başka bir işlemde güncellendi.', 409);

    const user = await transaction.user.create({
      data: {
        username,
        passwordHash,
        role: 'MUSTERI',
        mustChangePassword: true,
        activeAt,
      },
    });
    const wedding = await transaction.wedding.create({
      data: {
        applicationId: application.id,
        customerUserId: user.id,
        brideFirstName: application.brideFirstName,
        brideLastName: application.brideLastName,
        bridePhone: application.bridePhone,
        groomFirstName: application.groomFirstName,
        groomLastName: application.groomLastName,
        groomPhone: application.groomPhone,
        primaryContact: application.primaryContact,
        primaryEmail: application.primaryEmail,
        startsAt: application.weddingStartsAt,
        endsAt: application.weddingEndsAt,
        venueId: application.venueId,
        packageSummary: {
          code: application.packageCodeSnapshot,
          name: application.packageNameSnapshot,
          packagePriceCents: application.packagePriceCents,
          totalPriceCents: application.totalPriceCents,
          services: application.services.map((service) => ({
            code: service.codeSnapshot,
            name: service.nameSnapshot,
            priceCents: service.priceCents,
          })),
        },
        note: application.note,
        delivery: {
          create: {
            dueDate,
            history: { create: { toStatus: 'HAZIRLANIYOR', actorUserId } },
          },
        },
      },
    });

    await transaction.messageTask.createMany({
      data: [
        {
          weddingId: wedding.id,
          kind: 'ACCOUNT_ACTIVATION',
          dueAt: activeAt,
          recipientPhone,
          secretCiphertext: encryptedPassword.ciphertext,
          secretIv: encryptedPassword.iv,
          secretAuthTag: encryptedPassword.authTag,
        },
        {
          weddingId: wedding.id,
          kind: 'PREPARATION_UPDATE',
          dueAt: preparationDueAt,
          recipientPhone,
        },
      ],
    });
    await createAudit(transaction, {
      actorUserId,
      action: 'booking.approved',
      targetType: 'BookingApplication',
      targetId: application.id,
      correlationId,
      metadata: { weddingId: wedding.id, username },
    });

    return { applicationId: application.id, weddingId: wedding.id, username, activeAt };
  });
};

export const rejectBookingApplication = async (
  applicationId: string,
  reason: string,
  actorUserId: string,
  correlationId: string
) =>
  prisma.$transaction(async (transaction) => {
    const updated = await transaction.bookingApplication.updateMany({
      where: { id: applicationId, status: 'ONAY_BEKLIYOR' },
      data: {
        status: 'REDDEDILDI',
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: actorUserId,
      },
    });
    if (updated.count !== 1) {
      throw new AppError('Başvuru bulunamadı veya artık onay beklemiyor.', 409);
    }
    await createAudit(transaction, {
      actorUserId,
      action: 'booking.rejected',
      targetType: 'BookingApplication',
      targetId: applicationId,
      correlationId,
      metadata: { reason },
    });
    return { id: applicationId, status: 'REDDEDILDI' as const };
  });

export { createAudit };
