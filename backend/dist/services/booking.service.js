import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.config.js';
import { AppError } from '../utils/appError.js';
import { encryptValue, hashPassword, hashToken } from '../utils/crypto.js';
import { addCalendarDays, atIstanbulTime, createTemporaryPasswordExpiry, createWeddingRange, getIstanbulDate, messageSecretEncryptionAad, normalizePhone, normalizeUsername, randomFourDigitCode, randomReferenceCode, randomTemporaryPassword, } from '../utils/domain.js';
export const calculatePayment = (subtotalCents, paymentMethod) => {
    const totalPriceCents = paymentMethod === 'CASH' ? Math.round(subtotalCents * 0.9) : subtotalCents;
    return {
        totalPriceCents,
        payableNowCents: paymentMethod === 'CASH' ? totalPriceCents : Math.min(500_000, totalPriceCents),
    };
};
const createAudit = (transaction, input) => transaction.auditLog.create({
    data: {
        actorUserId: input.actorUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        correlationId: input.correlationId,
        metadata: input.metadata,
    },
});
const idempotencySelect = {
    id: true,
    referenceCode: true,
    status: true,
    totalPriceCents: true,
    payableNowCents: true,
    idempotencyFingerprint: true,
};
const assertIdempotencyFingerprint = (existing, fingerprint) => {
    if (existing.idempotencyFingerprint !== fingerprint) {
        throw new AppError('Idempotency anahtarı farklı bir başvuru için kullanılmış.', 409);
    }
};
export const createBookingFingerprint = (input, source, startsAt, endsAt, bridePhone, groomPhone, serviceCodes) => hashToken(JSON.stringify({
    source,
    brideFirstName: input.brideFirstName,
    brideLastName: input.brideLastName,
    bridePhone,
    groomFirstName: input.groomFirstName,
    groomLastName: input.groomLastName,
    groomPhone,
    primaryContact: input.primaryContact,
    primaryEmail: input.primaryEmail,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    venueId: input.venueId,
    packageCode: input.packageCode,
    serviceCodes,
    paymentMethod: input.paymentMethod,
    note: input.note || null,
    privacyConsent: input.privacyConsent,
    marketingConsent: input.marketingConsent,
}));
export const createBookingApplication = async (input, options) => {
    const { startsAt, endsAt } = createWeddingRange(input.weddingDate, input.startTime, input.endTime, input.endsNextDay);
    if (options.source === 'PUBLIC_FORM' && input.weddingDate < getIstanbulDate(new Date())) {
        throw new AppError('Geçmiş tarihli düğün başvurusu oluşturulamaz.', 400);
    }
    const bridePhone = normalizePhone(input.bridePhone);
    const groomPhone = normalizePhone(input.groomPhone);
    const serviceCodes = [...new Set(input.serviceCodes)].sort();
    const idempotencyFingerprint = createBookingFingerprint(input, options.source, startsAt, endsAt, bridePhone, groomPhone, serviceCodes);
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            const referenceCode = randomReferenceCode();
            return await prisma.$transaction(async (transaction) => {
                if (options.idempotencyKey) {
                    const existing = await transaction.bookingApplication.findUnique({
                        where: { idempotencyKey: options.idempotencyKey },
                        select: idempotencySelect,
                    });
                    if (existing) {
                        assertIdempotencyFingerprint(existing, idempotencyFingerprint);
                        const { idempotencyFingerprint: _fingerprint, ...response } = existing;
                        return response;
                    }
                }
                const [venue, selectedPackage, selectedServices] = await Promise.all([
                    transaction.venue.findFirst({ where: { id: input.venueId, isActive: true } }),
                    transaction.package.findFirst({
                        where: { code: input.packageCode, isActive: true },
                    }),
                    transaction.service.findMany({
                        where: { code: { in: serviceCodes }, isActive: true },
                        orderBy: { code: 'asc' },
                    }),
                ]);
                if (!venue)
                    throw new AppError('Seçilen salon artık aktif değil.', 400);
                if (!selectedPackage)
                    throw new AppError('Seçilen paket artık aktif değil.', 400);
                if (selectedServices.length !== serviceCodes.length) {
                    throw new AppError('Seçilen hizmetlerden biri artık aktif değil.', 400);
                }
                const subtotalCents = selectedPackage.priceCents +
                    selectedServices.reduce((sum, service) => sum + service.priceCents, 0);
                const { totalPriceCents, payableNowCents } = calculatePayment(subtotalCents, input.paymentMethod);
                const now = new Date();
                const application = await transaction.bookingApplication.create({
                    data: {
                        referenceCode,
                        idempotencyKey: options.idempotencyKey,
                        idempotencyFingerprint: options.idempotencyKey ? idempotencyFingerprint : undefined,
                        source: options.source,
                        brideFirstName: input.brideFirstName,
                        brideLastName: input.brideLastName,
                        bridePhone,
                        groomFirstName: input.groomFirstName,
                        groomLastName: input.groomLastName,
                        groomPhone,
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
                        privacyConsentAt: input.privacyConsent ? now : null,
                        marketingConsentAt: input.marketingConsent ? now : null,
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
            }, {
                isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
                maxWait: 5_000,
                timeout: 10_000,
            });
        }
        catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError &&
                (error.code === 'P2002' || error.code === 'P2034')) {
                continue;
            }
            throw error;
        }
    }
    if (options.idempotencyKey) {
        const existing = await prisma.bookingApplication.findUnique({
            where: { idempotencyKey: options.idempotencyKey },
            select: idempotencySelect,
        });
        if (existing) {
            assertIdempotencyFingerprint(existing, idempotencyFingerprint);
            const { idempotencyFingerprint: _fingerprint, ...response } = existing;
            return response;
        }
    }
    throw new AppError('Başvuru referansı üretilemedi. Lütfen tekrar deneyin.', 503);
};
export const createUniqueCustomerUsername = async (brideLastName, groomLastName) => {
    const normalizedParts = [normalizeUsername(brideLastName), normalizeUsername(groomLastName)]
        .filter(Boolean)
        .join('-');
    const prefix = (normalizedParts || 'musteri').slice(0, 59).replace(/-+$/g, '') || 'musteri';
    for (let attempt = 0; attempt < 20; attempt += 1) {
        const username = `${prefix}-${randomFourDigitCode()}`;
        const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
        if (!exists)
            return username;
    }
    throw new AppError('Benzersiz müşteri kullanıcı adı üretilemedi.', 503);
};
const isUsernameUniqueConflict = (error) => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        return false;
    }
    const target = error.meta?.target;
    const fields = Array.isArray(target) ? target.map(String) : [String(target ?? '')];
    return fields.some((field) => field.toLowerCase().includes('username'));
};
export const retryUsernameConflict = async (createUsername, operation, maxAttempts = 4) => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const username = await createUsername();
        try {
            return await operation(username);
        }
        catch (error) {
            if (isUsernameUniqueConflict(error))
                continue;
            throw error;
        }
    }
    throw new AppError('Benzersiz müşteri kullanıcı adı üretilemedi.', 503);
};
export const approveBookingApplication = async (applicationId, actorUserId, correlationId, dependencies = {}) => {
    const application = await prisma.bookingApplication.findUnique({
        where: { id: applicationId },
        include: { services: true, venue: true },
    });
    if (!application)
        throw new AppError('Başvuru bulunamadı.', 404);
    if (application.status !== 'ONAY_BEKLIYOR') {
        throw new AppError('Yalnızca onay bekleyen başvurular onaylanabilir.', 409);
    }
    const weddingDate = getIstanbulDate(application.weddingStartsAt);
    const temporaryPassword = randomTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const activeAt = atIstanbulTime(addCalendarDays(weddingDate, 1), '09:00');
    const now = new Date();
    const temporaryPasswordExpiresAt = createTemporaryPasswordExpiry(env.TEMPORARY_PASSWORD_TTL_HOURS, activeAt > now ? activeAt : now);
    const preparationDueAt = atIstanbulTime(addCalendarDays(weddingDate, 2), '10:00');
    const dueDate = new Date(`${addCalendarDays(weddingDate, 21)}T00:00:00.000Z`);
    const recipientPhone = application.primaryContact === 'GELIN' ? application.bridePhone : application.groomPhone;
    const createUsername = dependencies.createUsername ?? createUniqueCustomerUsername;
    return retryUsernameConflict(() => createUsername(application.brideLastName, application.groomLastName), (username) => prisma.$transaction(async (transaction) => {
        const claimed = await transaction.bookingApplication.updateMany({
            where: { id: application.id, status: 'ONAY_BEKLIYOR' },
            data: {
                status: 'ONAYLANDI',
                reviewedAt: new Date(),
                reviewedById: actorUserId,
            },
        });
        if (claimed.count !== 1)
            throw new AppError('Başvuru başka bir işlemde güncellendi.', 409);
        const user = await transaction.user.create({
            data: {
                username,
                passwordHash,
                role: 'MUSTERI',
                mustChangePassword: true,
                temporaryPasswordExpiresAt,
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
        const encryptedPassword = encryptValue(temporaryPassword, messageSecretEncryptionAad(wedding.id, 'ACCOUNT_ACTIVATION'));
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
                    encryptionVersion: 2,
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
            metadata: { weddingId: wedding.id },
        });
        return { applicationId: application.id, weddingId: wedding.id, username, activeAt };
    }));
};
export const rejectBookingApplication = async (applicationId, reason, actorUserId, correlationId) => prisma.$transaction(async (transaction) => {
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
    return { id: applicationId, status: 'REDDEDILDI' };
});
export { createAudit };
