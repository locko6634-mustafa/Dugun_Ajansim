import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';
import {
  authenticate,
  clearAuthCookies,
  csrfCookieOptions,
  CSRF_COOKIE_NAME,
  sessionCookieOptions,
  verifyCsrf,
} from '../middlewares/auth.middleware.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { loginBodySchema, passwordChangeBodySchema } from '../schemas/api.schemas.js';
import {
  createOpaqueToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../utils/crypto.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizeUsername } from '../utils/domain.js';

const router = Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Çok fazla giriş denemesi yaptınız.' },
});

router.post(
  '/login',
  loginLimiter,
  validateRequest(
    z.object({ body: loginBodySchema, query: z.object({}), params: z.object({}) })
  ),
  asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.body.username);
    const user = await prisma.user.findUnique({ where: { username } });
    const validPassword = user
      ? await verifyPassword(user.passwordHash, req.body.password)
      : false;

    if (!user || !validPassword) {
      throw new AppError('Kullanıcı adı veya parola hatalı.', 401);
    }
    if (user.status !== 'ACTIVE') throw new AppError('Bu hesap devre dışı.', 403);
    if (user.activeAt && user.activeAt > new Date()) {
      throw new AppError('Müşteri hesabınız henüz aktif değil.', 403);
    }

    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const maxAgeMs = req.body.remember
      ? env.REMEMBER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
      : env.SESSION_TTL_HOURS * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + maxAgeMs);

    await prisma.$transaction([
      prisma.authSession.create({
        data: {
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(csrfToken),
          userId: user.id,
          expiresAt,
        },
      }),
      prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'auth.login',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
        },
      }),
    ]);

    res.cookie(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(maxAgeMs));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(maxAgeMs));
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
      },
      correlationId: req.correlationId,
    });
  })
);

router.get(
  '/session',
  authenticate,
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, data: req.auth, correlationId: req.correlationId });
  })
);

router.post(
  '/password/change',
  authenticate,
  verifyCsrf,
  validateRequest(
    z.object({ body: passwordChangeBodySchema, query: z.object({}), params: z.object({}) })
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.auth!.userId } });
    if (!user || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw new AppError('Mevcut parola hatalı.', 401);
    }
    if (await verifyPassword(user.passwordHash, req.body.newPassword)) {
      throw new AppError('Yeni parola mevcut paroladan farklı olmalıdır.', 400);
    }

    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: new Date() },
      }),
      prisma.authSession.updateMany({
        where: { userId: user.id, id: { not: req.auth!.sessionId } },
        data: { revokedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'auth.password_changed',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
        },
      }),
    ]);

    res.json({
      success: true,
      data: { mustChangePassword: false },
      correlationId: req.correlationId,
    });
  })
);

router.post(
  '/logout',
  authenticate,
  verifyCsrf,
  asyncHandler(async (req, res) => {
    await prisma.authSession.update({
      where: { id: req.auth!.sessionId },
      data: { revokedAt: new Date() },
    });
    clearAuthCookies(res);
    res.json({ success: true, data: null, correlationId: req.correlationId });
  })
);

export default router;
