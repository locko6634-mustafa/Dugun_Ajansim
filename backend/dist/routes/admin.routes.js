import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { authenticate, requireChangedPassword, requireRole, verifyCsrf, } from '../middlewares/auth.middleware.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { adminBookingBodySchema, bookingQuerySchema, deliveryUpdateBodySchema, packageBodySchema, rejectBookingBodySchema, serviceBodySchema, uuidParamsSchema, weddingUpdateBodySchema, } from '../schemas/api.schemas.js';
import { approveBookingApplication, createAudit, createBookingApplication, createUniqueCustomerUsername, rejectBookingApplication, } from '../services/booking.service.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { decryptValue, encryptValue, hashPassword } from '../utils/crypto.js';
import { assertGoogleDriveUrl, addCalendarDays, atIstanbulTime, createWeddingRange, getIstanbulDate, normalizePhone, randomTemporaryPassword, temporaryWeddingPassword, } from '../utils/domain.js';
const router = Router();
router.use(authenticate, requireChangedPassword, requireRole('ADMIN'));
const emptyQuery = z.object({});
const emptyBody = z.object({});
const uuidRequest = z.object({ body: emptyBody, query: emptyQuery, params: uuidParamsSchema });
router.get('/booking-applications', validateRequest(z.object({ body: emptyBody, query: bookingQuerySchema, params: z.object({}) })), asyncHandler(async (req, res) => {
    const applications = await prisma.bookingApplication.findMany({
        where: {
            ...(req.query.status ? { status: req.query.status } : {}),
            ...(req.query.referenceCode
                ? {
                    referenceCode: {
                        contains: String(req.query.referenceCode).toUpperCase(),
                        mode: 'insensitive',
                    },
                }
                : {}),
        },
        include: {
            venue: { select: { name: true } },
            services: true,
            reviewedBy: { select: { username: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
    });
    res.json({ success: true, data: applications, correlationId: req.correlationId });
}));
router.get('/booking-applications/:id', validateRequest(uuidRequest), asyncHandler(async (req, res) => {
    const application = await prisma.bookingApplication.findUnique({
        where: { id: req.params.id },
        include: { venue: true, services: true, wedding: { include: { delivery: true } } },
    });
    if (!application)
        throw new AppError('Başvuru bulunamadı.', 404);
    res.json({ success: true, data: application, correlationId: req.correlationId });
}));
router.post('/booking-applications', verifyCsrf, validateRequest(z.object({ body: adminBookingBodySchema, query: emptyQuery, params: z.object({}) })), asyncHandler(async (req, res) => {
    const application = await createBookingApplication(req.body, {
        source: 'ADMIN',
        actor: { id: req.auth.userId },
        correlationId: req.correlationId,
    });
    res.status(201).json({
        success: true,
        data: application,
        correlationId: req.correlationId,
    });
}));
router.post('/booking-applications/:id/approve', verifyCsrf, validateRequest(uuidRequest), asyncHandler(async (req, res) => {
    const result = await approveBookingApplication(req.params.id, req.auth.userId, req.correlationId);
    res.json({ success: true, data: result, correlationId: req.correlationId });
}));
router.post('/booking-applications/:id/reject', verifyCsrf, validateRequest(z.object({ body: rejectBookingBodySchema, query: emptyQuery, params: uuidParamsSchema })), asyncHandler(async (req, res) => {
    const result = await rejectBookingApplication(req.params.id, req.body.reason, req.auth.userId, req.correlationId);
    res.json({ success: true, data: result, correlationId: req.correlationId });
}));
router.get('/weddings', asyncHandler(async (req, res) => {
    const weddings = await prisma.wedding.findMany({
        include: {
            venue: { select: { name: true } },
            customerUser: {
                select: { id: true, username: true, activeAt: true, mustChangePassword: true },
            },
            delivery: {
                select: {
                    id: true,
                    status: true,
                    dueDate: true,
                    releasedAt: true,
                    updatedAt: true,
                    driveUrlCiphertext: true,
                },
            },
        },
        orderBy: { startsAt: 'desc' },
        take: 200,
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
                hasDriveUrl: Boolean(wedding.delivery.driveUrlCiphertext),
            }
            : null,
    }));
    res.json({ success: true, data: safeWeddings, correlationId: req.correlationId });
}));
router.patch('/weddings/:id', verifyCsrf, validateRequest(z.object({
    body: weddingUpdateBodySchema,
    query: emptyQuery,
    params: uuidParamsSchema,
})), asyncHandler(async (req, res) => {
    const wedding = await prisma.wedding.findUnique({
        where: { id: req.params.id },
        include: { customerUser: true, delivery: true },
    });
    if (!wedding)
        throw new AppError('Düğün kaydı bulunamadı.', 404);
    if (wedding.cancelledAt)
        throw new AppError('İptal edilmiş düğün güncellenemez.', 409);
    const venue = await prisma.venue.findUnique({
        where: { id: req.body.venueId },
        select: { id: true },
    });
    if (!venue)
        throw new AppError('Salon bulunamadı.', 404);
    const bridePhone = normalizePhone(req.body.bridePhone);
    const groomPhone = normalizePhone(req.body.groomPhone);
    const { startsAt, endsAt } = createWeddingRange(req.body.weddingDate, req.body.startTime, req.body.endTime, req.body.endsNextDay);
    const oldWeddingDate = getIstanbulDate(wedding.startsAt);
    const dateChanged = oldWeddingDate !== req.body.weddingDate;
    const namesChanged = wedding.brideFirstName !== req.body.brideFirstName ||
        wedding.brideLastName !== req.body.brideLastName ||
        wedding.groomFirstName !== req.body.groomFirstName ||
        wedding.groomLastName !== req.body.groomLastName;
    const canRegenerateCredentials = wedding.customerUser.mustChangePassword && !wedding.customerUser.passwordChangedAt;
    const regenerateCredentials = canRegenerateCredentials && (dateChanged || namesChanged);
    const recipientPhone = req.body.primaryContact === 'GELIN' ? bridePhone : groomPhone;
    const activationAt = atIstanbulTime(addCalendarDays(req.body.weddingDate, 1), '09:00');
    const preparationAt = atIstanbulTime(addCalendarDays(req.body.weddingDate, 2), '10:00');
    const dueDate = new Date(`${addCalendarDays(req.body.weddingDate, 21)}T00:00:00.000Z`);
    let nextUsername;
    let nextPasswordHash;
    let encryptedPassword;
    if (regenerateCredentials) {
        nextUsername = await createUniqueCustomerUsername(req.body.brideLastName, req.body.groomLastName);
        const temporaryPassword = temporaryWeddingPassword(req.body.weddingDate);
        nextPasswordHash = await hashPassword(temporaryPassword);
        encryptedPassword = encryptValue(temporaryPassword);
    }
    const now = new Date();
    const updated = await prisma.$transaction(async (transaction) => {
        const result = await transaction.wedding.update({
            where: { id: wedding.id },
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
                note: req.body.note || null,
            },
            include: {
                venue: { select: { name: true } },
                customerUser: {
                    select: { id: true, username: true, activeAt: true, mustChangePassword: true },
                },
                delivery: {
                    select: {
                        id: true,
                        status: true,
                        dueDate: true,
                        releasedAt: true,
                        updatedAt: true,
                    },
                },
            },
        });
        await transaction.messageTask.updateMany({
            where: { weddingId: wedding.id, status: 'PENDING' },
            data: { recipientPhone },
        });
        if (dateChanged) {
            await transaction.messageTask.updateMany({
                where: {
                    weddingId: wedding.id,
                    kind: 'PREPARATION_UPDATE',
                    status: 'PENDING',
                },
                data: { dueAt: preparationAt },
            });
            if (wedding.delivery && wedding.delivery.status !== 'TESLIM_EDILDI') {
                await transaction.delivery.update({
                    where: { id: wedding.delivery.id },
                    data: { dueDate },
                });
            }
        }
        if (regenerateCredentials && nextUsername && nextPasswordHash && encryptedPassword) {
            await transaction.user.update({
                where: { id: wedding.customerUserId },
                data: {
                    username: nextUsername,
                    passwordHash: nextPasswordHash,
                    activeAt: activationAt,
                    mustChangePassword: true,
                    passwordChangedAt: null,
                },
            });
            await transaction.authSession.updateMany({
                where: { userId: wedding.customerUserId, revokedAt: null },
                data: { revokedAt: now },
            });
            await transaction.messageTask.upsert({
                where: {
                    weddingId_kind: {
                        weddingId: wedding.id,
                        kind: 'ACCOUNT_ACTIVATION',
                    },
                },
                create: {
                    weddingId: wedding.id,
                    kind: 'ACCOUNT_ACTIVATION',
                    dueAt: activationAt,
                    recipientPhone,
                    secretCiphertext: encryptedPassword.ciphertext,
                    secretIv: encryptedPassword.iv,
                    secretAuthTag: encryptedPassword.authTag,
                },
                update: {
                    status: 'PENDING',
                    dueAt: activationAt,
                    recipientPhone,
                    sentAt: null,
                    sentById: null,
                    secretCiphertext: encryptedPassword.ciphertext,
                    secretIv: encryptedPassword.iv,
                    secretAuthTag: encryptedPassword.authTag,
                },
            });
        }
        await createAudit(transaction, {
            actorUserId: req.auth.userId,
            action: 'wedding.updated',
            targetType: 'Wedding',
            targetId: wedding.id,
            correlationId: req.correlationId,
            metadata: {
                dateChanged,
                namesChanged,
                credentialsRegenerated: regenerateCredentials,
            },
        });
        return result;
    });
    res.json({
        success: true,
        data: {
            ...updated,
            credentialsRegenerated: regenerateCredentials,
            username: nextUsername ?? updated.customerUser.username,
        },
        correlationId: req.correlationId,
    });
}));
router.patch('/deliveries/:id', verifyCsrf, validateRequest(z.object({
    body: deliveryUpdateBodySchema,
    query: emptyQuery,
    params: uuidParamsSchema,
})), asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUnique({ where: { id: req.params.id } });
    if (!delivery)
        throw new AppError('Teslimat kaydı bulunamadı.', 404);
    if (delivery.status === 'TESLIM_EDILDI') {
        throw new AppError('Teslim edilmiş kayıt bu işlemle değiştirilemez.', 409);
    }
    const encrypted = req.body.driveUrl
        ? encryptValue(assertGoogleDriveUrl(req.body.driveUrl))
        : undefined;
    const nextStatus = req.body.status ?? delivery.status;
    const dueDate = req.body.dueDate ? new Date(`${req.body.dueDate}T00:00:00.000Z`) : undefined;
    const updated = await prisma.$transaction(async (transaction) => {
        const result = await transaction.delivery.update({
            where: { id: delivery.id },
            data: {
                status: nextStatus,
                dueDate,
                ...(encrypted
                    ? {
                        driveUrlCiphertext: encrypted.ciphertext,
                        driveUrlIv: encrypted.iv,
                        driveUrlAuthTag: encrypted.authTag,
                    }
                    : {}),
            },
            select: {
                id: true,
                status: true,
                dueDate: true,
                releasedAt: true,
                updatedAt: true,
            },
        });
        if (nextStatus !== delivery.status) {
            await transaction.deliveryStatusHistory.create({
                data: {
                    deliveryId: delivery.id,
                    fromStatus: delivery.status,
                    toStatus: nextStatus,
                    actorUserId: req.auth.userId,
                },
            });
        }
        await createAudit(transaction, {
            actorUserId: req.auth.userId,
            action: 'delivery.updated',
            targetType: 'Delivery',
            targetId: delivery.id,
            correlationId: req.correlationId,
            metadata: {
                statusChanged: nextStatus !== delivery.status,
                dueDateChanged: Boolean(dueDate),
                driveUrlChanged: Boolean(encrypted),
            },
        });
        return result;
    });
    res.json({ success: true, data: updated, correlationId: req.correlationId });
}));
router.post('/deliveries/:id/deliver', verifyCsrf, validateRequest(uuidRequest), asyncHandler(async (req, res) => {
    const delivery = await prisma.delivery.findUnique({
        where: { id: req.params.id },
        include: { wedding: true },
    });
    if (!delivery)
        throw new AppError('Teslimat kaydı bulunamadı.', 404);
    if (delivery.status !== 'TESLIME_HAZIR') {
        throw new AppError('Teslimat önce “Teslime Hazır” durumuna alınmalıdır.', 409);
    }
    if (!delivery.driveUrlCiphertext || !delivery.driveUrlIv || !delivery.driveUrlAuthTag) {
        throw new AppError('Teslim etmeden önce Google Drive bağlantısı kaydedilmelidir.', 409);
    }
    const recipientPhone = delivery.wedding.primaryContact === 'GELIN'
        ? delivery.wedding.bridePhone
        : delivery.wedding.groomPhone;
    const now = new Date();
    const updated = await prisma.$transaction(async (transaction) => {
        const result = await transaction.delivery.update({
            where: { id: delivery.id },
            data: { status: 'TESLIM_EDILDI', releasedAt: now },
            select: {
                id: true,
                status: true,
                dueDate: true,
                releasedAt: true,
                updatedAt: true,
            },
        });
        await transaction.deliveryStatusHistory.create({
            data: {
                deliveryId: delivery.id,
                fromStatus: delivery.status,
                toStatus: 'TESLIM_EDILDI',
                actorUserId: req.auth.userId,
            },
        });
        await transaction.messageTask.upsert({
            where: {
                weddingId_kind: {
                    weddingId: delivery.weddingId,
                    kind: 'DELIVERY_READY',
                },
            },
            create: {
                weddingId: delivery.weddingId,
                kind: 'DELIVERY_READY',
                dueAt: now,
                recipientPhone,
            },
            update: {
                status: 'PENDING',
                dueAt: now,
                recipientPhone,
                sentAt: null,
                sentById: null,
            },
        });
        await createAudit(transaction, {
            actorUserId: req.auth.userId,
            action: 'delivery.released',
            targetType: 'Delivery',
            targetId: delivery.id,
            correlationId: req.correlationId,
        });
        return result;
    });
    res.json({ success: true, data: updated, correlationId: req.correlationId });
}));
const catalogRoutes = (path, schema) => {
    router.get(`/${path}`, asyncHandler(async (req, res) => {
        const rows = path === 'packages'
            ? await prisma.package.findMany({ orderBy: { name: 'asc' } })
            : await prisma.service.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
        res.json({ success: true, data: rows, correlationId: req.correlationId });
    }));
    router.post(`/${path}`, verifyCsrf, validateRequest(z.object({ body: schema, query: emptyQuery, params: z.object({}) })), asyncHandler(async (req, res) => {
        const row = path === 'packages'
            ? await prisma.package.create({ data: req.body })
            : await prisma.service.create({ data: req.body });
        res.status(201).json({ success: true, data: row, correlationId: req.correlationId });
    }));
    router.patch(`/${path}/:id`, verifyCsrf, validateRequest(z.object({ body: schema.partial(), query: emptyQuery, params: uuidParamsSchema })), asyncHandler(async (req, res) => {
        const row = path === 'packages'
            ? await prisma.package.update({ where: { id: req.params.id }, data: req.body })
            : await prisma.service.update({ where: { id: req.params.id }, data: req.body });
        res.json({ success: true, data: row, correlationId: req.correlationId });
    }));
    router.delete(`/${path}/:id`, verifyCsrf, validateRequest(uuidRequest), asyncHandler(async (req, res) => {
        const row = path === 'packages'
            ? await prisma.package.update({
                where: { id: req.params.id },
                data: { isActive: false },
            })
            : await prisma.service.update({
                where: { id: req.params.id },
                data: { isActive: false },
            });
        res.json({ success: true, data: row, correlationId: req.correlationId });
    }));
};
catalogRoutes('packages', packageBodySchema);
catalogRoutes('services', serviceBodySchema);
router.get('/message-tasks', asyncHandler(async (req, res) => {
    const tasks = await prisma.messageTask.findMany({
        include: {
            wedding: {
                select: {
                    brideFirstName: true,
                    brideLastName: true,
                    groomFirstName: true,
                    groomLastName: true,
                },
            },
            sentBy: { select: { username: true } },
        },
        orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
        take: 300,
    });
    const safeTasks = tasks.map(({ secretCiphertext: _ciphertext, secretIv: _iv, secretAuthTag: _tag, ...task }) => task);
    res.json({ success: true, data: safeTasks, correlationId: req.correlationId });
}));
const renderMessage = async (taskId) => {
    const task = await prisma.messageTask.findUnique({
        where: { id: taskId },
        include: {
            wedding: {
                include: {
                    customerUser: true,
                    delivery: true,
                },
            },
        },
    });
    if (!task)
        throw new AppError('Mesaj görevi bulunamadı.', 404);
    const couple = `${task.wedding.brideFirstName} & ${task.wedding.groomFirstName}`;
    let message;
    if (task.kind === 'ACCOUNT_ACTIVATION') {
        if (!task.secretCiphertext || !task.secretIv || !task.secretAuthTag) {
            throw new AppError('Aktivasyon mesajı güvenlik bilgisi eksik.', 409);
        }
        const password = decryptValue({
            ciphertext: task.secretCiphertext,
            iv: task.secretIv,
            authTag: task.secretAuthTag,
        });
        message = `Merhaba ${couple}.\n\nDüğün Ajansım teslimat paneliniz hazır.\nKullanıcı adı: ${task.wedding.customerUser.username}\nGeçici parola: ${password}\n\nİlk girişte parolanızı değiştirmeniz istenecektir.`;
    }
    else if (task.kind === 'PASSWORD_RESET') {
        if (!task.secretCiphertext || !task.secretIv || !task.secretAuthTag) {
            throw new AppError('Parola sıfırlama bilgisi eksik.', 409);
        }
        const password = decryptValue({
            ciphertext: task.secretCiphertext,
            iv: task.secretIv,
            authTag: task.secretAuthTag,
        });
        message = `Merhaba ${couple}.\n\nGeçici parolanız: ${password}\nİlk girişte yeni bir parola belirlemeniz gerekecektir.`;
    }
    else if (task.kind === 'PREPARATION_UPDATE') {
        const dueDate = task.wedding.delivery?.dueDate.toLocaleDateString('tr-TR', {
            timeZone: 'UTC',
        });
        message = `Merhaba ${couple}.\n\nFotoğraf ve video çalışmalarınız hazırlanmaktadır.\nOrtalama teslim süremiz 21 gündür.\nTahmini teslim tarihi: ${dueDate}`;
    }
    else {
        message = `Merhaba ${couple}.\n\nDüğün fotoğraf ve videolarınız hazırlandı.\nDosyalarınıza Düğün Ajansım müşteri panelinden ulaşabilirsiniz.\n\nİyi günlerde kullanmanızı dileriz.`;
    }
    const phone = task.recipientPhone.replace(/\D/g, '');
    return {
        task,
        message,
        whatsappUrl: `https://wa.me/${phone}?text=${encodeURIComponent(message)}`,
    };
};
router.get('/message-tasks/:id/render', validateRequest(uuidRequest), asyncHandler(async (req, res) => {
    const rendered = await renderMessage(req.params.id);
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        data: { message: rendered.message, whatsappUrl: rendered.whatsappUrl },
        correlationId: req.correlationId,
    });
}));
router.post('/message-tasks/:id/mark-sent', verifyCsrf, validateRequest(uuidRequest), asyncHandler(async (req, res) => {
    const task = await prisma.messageTask.update({
        where: { id: req.params.id },
        data: {
            status: 'SENT',
            sentAt: new Date(),
            sentById: req.auth.userId,
            secretCiphertext: null,
            secretIv: null,
            secretAuthTag: null,
        },
        select: { id: true, status: true, sentAt: true },
    });
    res.json({ success: true, data: task, correlationId: req.correlationId });
}));
router.post('/customers/:id/reset-password', verifyCsrf, validateRequest(uuidRequest), asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
        where: { id: req.params.id },
        include: { customerWedding: true },
    });
    if (!user || user.role !== 'MUSTERI' || !user.customerWedding) {
        throw new AppError('Müşteri hesabı bulunamadı.', 404);
    }
    const password = randomTemporaryPassword();
    const passwordHash = await hashPassword(password);
    const encrypted = encryptValue(password);
    const recipientPhone = user.customerWedding.primaryContact === 'GELIN'
        ? user.customerWedding.bridePhone
        : user.customerWedding.groomPhone;
    const now = new Date();
    const task = await prisma.$transaction(async (transaction) => {
        await transaction.user.update({
            where: { id: user.id },
            data: { passwordHash, mustChangePassword: true, passwordChangedAt: null },
        });
        await transaction.authSession.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: now },
        });
        const messageTask = await transaction.messageTask.upsert({
            where: {
                weddingId_kind: {
                    weddingId: user.customerWedding.id,
                    kind: 'PASSWORD_RESET',
                },
            },
            create: {
                weddingId: user.customerWedding.id,
                kind: 'PASSWORD_RESET',
                dueAt: now,
                recipientPhone,
                secretCiphertext: encrypted.ciphertext,
                secretIv: encrypted.iv,
                secretAuthTag: encrypted.authTag,
            },
            update: {
                status: 'PENDING',
                dueAt: now,
                recipientPhone,
                sentAt: null,
                sentById: null,
                secretCiphertext: encrypted.ciphertext,
                secretIv: encrypted.iv,
                secretAuthTag: encrypted.authTag,
            },
        });
        await createAudit(transaction, {
            actorUserId: req.auth.userId,
            action: 'customer.password_reset',
            targetType: 'User',
            targetId: user.id,
            correlationId: req.correlationId,
        });
        return messageTask;
    });
    const rendered = await renderMessage(task.id);
    res.set('Cache-Control', 'no-store');
    res.json({
        success: true,
        data: { taskId: task.id, whatsappUrl: rendered.whatsappUrl },
        correlationId: req.correlationId,
    });
}));
router.get('/audit-logs', asyncHandler(async (req, res) => {
    const logs = await prisma.auditLog.findMany({
        include: { actor: { select: { username: true, role: true } } },
        orderBy: { createdAt: 'desc' },
        take: 300,
    });
    res.json({ success: true, data: logs, correlationId: req.correlationId });
}));
router.get('/overview', asyncHandler(async (req, res) => {
    const [pendingBookings, activeWeddings, pendingMessages, readyDeliveries] = await Promise.all([
        prisma.bookingApplication.count({ where: { status: 'ONAY_BEKLIYOR' } }),
        prisma.wedding.count({ where: { cancelledAt: null } }),
        prisma.messageTask.count({ where: { status: 'PENDING' } }),
        prisma.delivery.count({ where: { status: 'TESLIME_HAZIR' } }),
    ]);
    res.json({
        success: true,
        data: { pendingBookings, activeWeddings, pendingMessages, readyDeliveries },
        correlationId: req.correlationId,
    });
}));
export default router;
