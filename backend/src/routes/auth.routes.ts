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
  getSessionAbsoluteTtlMs,
  isTemporaryPasswordExpired,
  sessionCookieOptions,
  verifyCsrf,
} from '../middlewares/auth.middleware.js';
import {
  createRateLimitHandler,
  rateLimitKeyGenerator,
} from '../middlewares/rateLimit.middleware.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import { loginBodySchema, passwordChangeBodySchema } from '../schemas/api.schemas.js';
import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from '../utils/crypto.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizeUsername } from '../utils/domain.js';
import { logFailedLoginSecurityEvent } from '../utils/securityLogger.js';
import { cleanupStaleSessions } from '../utils/sessionMaintenance.js';

const router = Router();
const INVALID_CREDENTIALS_MESSAGE = 'Kullanıcı adı veya parola hatalı.';
const DUMMY_LOGIN_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$aoZyQyB8eVS3LeO40/kqYQ$c0LhPvExxPfDSalntYXGc0qjrgJKJPj7Npz2xelpmnk';
const emptyRequestSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  handler: createRateLimitHandler('Çok fazla giriş denemesi yaptınız.'),
});

router.post(
  '/login',
  loginLimiter,
  validateRequest(
    z.object({ body: loginBodySchema, query: z.object({}).strict(), params: z.object({}).strict() }),
  ),
  asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.body.username);
    const user = await prisma.user.findUnique({ where: { username } });
    const validPassword = await verifyPassword(
      user?.passwordHash ?? DUMMY_LOGIN_PASSWORD_HASH,
      req.body.password,
    );
    const now = new Date();
    const temporaryPasswordExpired = user !== null && isTemporaryPasswordExpired(user, now);

    if (
      !user ||
      !validPassword ||
      user.status !== 'ACTIVE' ||
      (user.activeAt !== null && user.activeAt > now) ||
      temporaryPasswordExpired
    ) {
      logFailedLoginSecurityEvent(req.correlationId);
      throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
    }

    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const maxAgeMs = getSessionAbsoluteTtlMs(user.role, req.body.remember);
    const expiresAt = new Date(now.valueOf() + maxAgeMs);

    await prisma.$transaction(async (transaction) => {
      const claimedUser = await transaction.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          status: 'ACTIVE',
          AND: [
            {
              OR: [{ activeAt: null }, { activeAt: { lte: now } }],
            },
            {
              OR: [
                { mustChangePassword: false },
                {
                  mustChangePassword: true,
                  temporaryPasswordExpiresAt: { gt: now },
                },
              ],
            },
          ],
        },
        data: { lastLoginAt: now },
      });
      if (claimedUser.count !== 1) {
        logFailedLoginSecurityEvent(req.correlationId);
        throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401);
      }

      await transaction.authSession.create({
        data: {
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(csrfToken),
          userId: user.id,
          expiresAt,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'auth.login',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
        },
      });
      await cleanupStaleSessions(transaction, now);
    });

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
  }),
);

router.get(
  '/session',
  authenticate,
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: {
        username: req.auth!.username,
        role: req.auth!.role,
        mustChangePassword: req.auth!.mustChangePassword,
      },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/password/change',
  authenticate,
  verifyCsrf,
  validateRequest(
    z.object({
      body: passwordChangeBodySchema,
      query: z.object({}).strict(),
      params: z.object({}).strict(),
    }),
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
    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const now = new Date();
    const { expiresAt } = await prisma.$transaction(async (transaction) => {
      const changedUser = await transaction.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          status: 'ACTIVE',
          AND: [
            {
              OR: [{ activeAt: null }, { activeAt: { lte: now } }],
            },
            {
              OR: [
                { mustChangePassword: false },
                {
                  mustChangePassword: true,
                  temporaryPasswordExpiresAt: { gt: now },
                },
              ],
            },
          ],
        },
        data: {
          passwordHash,
          mustChangePassword: false,
          temporaryPasswordExpiresAt: null,
          passwordChangedAt: now,
        },
      });
      if (changedUser.count !== 1) {
        throw new AppError('Parola başka bir işlem tarafından değiştirildi.', 409);
      }

      const currentSession = await transaction.authSession.findUnique({
        where: { id: req.auth!.sessionId },
        select: { expiresAt: true },
      });
      if (!currentSession || currentSession.expiresAt <= now) {
        throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
      }

      const rotatedSession = await transaction.authSession.updateMany({
        where: {
          id: req.auth!.sessionId,
          userId: user.id,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(csrfToken),
          lastUsedAt: now,
        },
      });
      if (rotatedSession.count !== 1) {
        throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
      }

      await transaction.authSession.updateMany({
        where: {
          userId: user.id,
          id: { not: req.auth!.sessionId },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.messageTask.updateMany({
        where: {
          wedding: { customerUserId: user.id },
          kind: { in: ['ACCOUNT_ACTIVATION', 'PASSWORD_RESET'] },
          status: 'PENDING',
        },
        data: {
          status: 'CANCELLED',
          sentAt: null,
          sentById: null,
          secretCiphertext: null,
          secretIv: null,
          secretAuthTag: null,
        },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: user.id,
          action: 'auth.password_changed',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
        },
      });

      return currentSession;
    });

    const remainingMaxAgeMs = Math.max(1, expiresAt.valueOf() - Date.now());
    res.cookie(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(remainingMaxAgeMs));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(remainingMaxAgeMs));

    res.json({
      success: true,
      data: { mustChangePassword: false },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/logout',
  authenticate,
  verifyCsrf,
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      await transaction.authSession.updateMany({
        where: {
          id: req.auth!.sessionId,
          userId: req.auth!.userId,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.auditLog.create({
        data: {
          actorUserId: req.auth!.userId,
          action: 'auth.logout',
          targetType: 'User',
          targetId: req.auth!.userId,
          correlationId: req.correlationId,
        },
      });
    });
    clearAuthCookies(res);
    res.json({ success: true, data: null, correlationId: req.correlationId });
  }),
);

export default router;
