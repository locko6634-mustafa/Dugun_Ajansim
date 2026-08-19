import { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env, parseDataEncryptionKeyring } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';
import {
  ADMIN_STEP_UP_TTL_MS,
  authenticate,
  clearAuthCookies,
  csrfCookieOptions,
  CSRF_COOKIE_NAME,
  getCookie,
  getSessionAbsoluteTtlMs,
  isMfaEnrollmentRequired,
  isMfaRequiredRole,
  isTemporaryPasswordExpired,
  requireChangedPassword,
  requireRole,
  sessionCookieOptions,
  verifyCsrf,
} from '../middlewares/auth.middleware.js';
import {
  createRateLimitHandler,
  loginAccountRateLimitKeyGenerator,
  rateLimitKeyGenerator,
} from '../middlewares/rateLimit.middleware.js';
import { DatabaseRateLimitStore } from '../middlewares/databaseRateLimitStore.js';
import { validateRequest } from '../middlewares/validate.middleware.js';
import {
  isPasswordSimilarToUsername,
  loginBodySchema,
  mfaEnrollmentBodySchema,
  mfaProtectedActionBodySchema,
  passwordChangeBodySchema,
  passwordSetupBodySchema,
} from '../schemas/api.schemas.js';
import {
  createOpaqueToken,
  decryptValueWithKey,
  decryptValue,
  encryptValueWithKey,
  hashPassword,
  hashToken,
  verifyPassword,
} from '../utils/crypto.js';
import { AppError } from '../utils/appError.js';
import { writeAuditLog } from '../utils/audit.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { normalizeUsername } from '../utils/domain.js';
import { logFailedLoginSecurityEvent } from '../utils/securityLogger.js';
import { cleanupStaleSessions } from '../utils/sessionMaintenance.js';
import {
  createTotpEnrollmentUri,
  createTotpSecret,
  findMatchingTotpStep,
  TOTP_ENROLLMENT_TTL_MINUTES,
  totpEncryptionAad,
} from '../utils/totp.js';
import {
  clearTrustedDeviceCookie,
  createOrRotateDevice,
  findUsableDevice,
  readTrustedDeviceToken,
  setTrustedDeviceCookie,
} from '../utils/trustedDevice.js';

const router = Router();
const INVALID_CREDENTIALS_MESSAGE = 'Kullanıcı adı veya parola hatalı.';
const INVALID_MFA_MESSAGE = 'Kullanıcı adı, parola veya doğrulama kodu hatalı.';
const INVALID_ADMIN_STEP_UP_MESSAGE = 'Yönetici doğrulama bilgileri hatalı.';
const MFA_RESTRICTED_SESSION_TTL_MS = 10 * 60 * 1000;
const DUMMY_LOGIN_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$aoZyQyB8eVS3LeO40/kqYQ$c0LhPvExxPfDSalntYXGc0qjrgJKJPj7Npz2xelpmnk';
const dataEncryptionKeyring = parseDataEncryptionKeyring(env.DATA_ENCRYPTION_KEYRING_JSON);
const emptyRequestSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});
const mfaProtectedRequestSchema = z.object({
  body: mfaProtectedActionBodySchema,
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

const requireMfaFeatureEnabled = (
  _req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  if (!env.MFA_ENABLED) {
    next(new AppError('İki adımlı doğrulama özelliği etkin değil.', 404));
    return;
  }
  next();
};

router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

export const isSuccessfulLoginAttempt = (_req: Request, res: Response): boolean =>
  res.statusCode < 400;

const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  store: new DatabaseRateLimitStore('auth-login-ip'),
  skipSuccessfulRequests: true,
  requestWasSuccessful: isSuccessfulLoginAttempt,
  handler: createRateLimitHandler('Çok fazla giriş denemesi yaptınız.'),
});

const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: loginAccountRateLimitKeyGenerator,
  store: new DatabaseRateLimitStore('auth-login-account'),
  skipSuccessfulRequests: true,
  requestWasSuccessful: isSuccessfulLoginAttempt,
  handler: createRateLimitHandler('Çok fazla giriş denemesi yaptınız.'),
});

const mfaManagementLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  store: new DatabaseRateLimitStore('auth-mfa-management-ip'),
  skipSuccessfulRequests: true,
  handler: createRateLimitHandler('Çok fazla iki adımlı doğrulama denemesi yaptınız.'),
});

const adminStepUpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  store: new DatabaseRateLimitStore('auth-admin-step-up-ip'),
  skipSuccessfulRequests: true,
  requestWasSuccessful: isSuccessfulLoginAttempt,
  handler: createRateLimitHandler('Çok fazla yönetici doğrulama denemesi yaptınız.'),
});

const adminStepUpAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ?? 'invalid-admin-account',
  store: new DatabaseRateLimitStore('auth-admin-step-up-account'),
  skipSuccessfulRequests: true,
  requestWasSuccessful: isSuccessfulLoginAttempt,
  handler: createRateLimitHandler('Çok fazla yönetici doğrulama denemesi yaptınız.'),
});

const passwordSetupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKeyGenerator,
  store: new DatabaseRateLimitStore('auth-password-setup-ip'),
  handler: createRateLimitHandler('Çok fazla parola kurulum denemesi yaptınız.'),
});

const decryptTotpSecret = (user: {
  id: string;
  totpSecretCiphertext: string | null;
  totpSecretIv: string | null;
  totpSecretAuthTag: string | null;
  totpKeyId: string | null;
}): string => {
  if (!user.totpSecretCiphertext || !user.totpSecretIv || !user.totpSecretAuthTag) {
    throw new Error('Etkin iki adımlı doğrulama kaydı eksik.');
  }
  const envelope = {
    ciphertext: user.totpSecretCiphertext,
    iv: user.totpSecretIv,
    authTag: user.totpSecretAuthTag,
  };
  if (user.totpKeyId === null) return decryptValue(envelope, totpEncryptionAad(user.id));
  const key = dataEncryptionKeyring[user.totpKeyId];
  if (!key) throw new Error('TOTP şifreleme anahtarı keyring içinde bulunamadı.');
  return decryptValueWithKey(envelope, key, totpEncryptionAad(user.id));
};

router.post(
  '/login',
  loginIpLimiter,
  loginAccountLimiter,
  validateRequest(
    z.object({
      body: loginBodySchema,
      query: z.object({}).strict(),
      params: z.object({}).strict(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const username = normalizeUsername(req.body.username);
    const user = await prisma.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        role: true,
        status: true,
        activeAt: true,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: true,
        venueId: true,
        managedVenueAssignments: {
          select: { venueId: true },
          orderBy: { venueId: 'asc' },
        },
        totpSecretCiphertext: true,
        totpSecretIv: true,
        totpSecretAuthTag: true,
        totpKeyId: true,
        totpEnabledAt: true,
        totpLastUsedStep: true,
      },
    });
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
    const mfaApplies = isMfaRequiredRole(user.role) && user.totpEnabledAt !== null;
    let matchedTotpStep: bigint | undefined;
    const usableDevice =
      !mfaApplies ? null : await findUsableDevice(prisma, req, user.id, now);
    if (mfaApplies && !usableDevice && readTrustedDeviceToken(req)) clearTrustedDeviceCookie(res);
    let rotatedTotpSecret:
      { ciphertext: string; iv: string; authTag: string; keyId: string } | undefined;
    if (mfaApplies && !usableDevice) {
      if (!req.body.totpCode) {
        throw new AppError('İki adımlı doğrulama kodu gerekli.', 401, true, {
          code: 'MFA_REQUIRED',
        });
      }
      const totpSecret = decryptTotpSecret(user);
      matchedTotpStep = findMatchingTotpStep(totpSecret, req.body.totpCode, now);
      if (
        matchedTotpStep === undefined ||
        (user.totpLastUsedStep !== null && matchedTotpStep <= user.totpLastUsedStep)
      ) {
        logFailedLoginSecurityEvent(req.correlationId);
        throw new AppError(INVALID_MFA_MESSAGE, 401);
      }
      if (user.totpKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) {
        const rotated = encryptValueWithKey(
          totpSecret,
          dataEncryptionKeyring[env.DATA_ENCRYPTION_ACTIVE_KEY_ID]!,
          totpEncryptionAad(user.id),
        );
        rotatedTotpSecret = {
          ...rotated,
          keyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
        };
      }
    }

    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const mustEnrollMfa = isMfaEnrollmentRequired(user.role, user.totpEnabledAt !== null);
    const configuredMaxAgeMs = getSessionAbsoluteTtlMs(user.role, req.body.remember);
    const maxAgeMs = mustEnrollMfa
      ? Math.min(configuredMaxAgeMs, MFA_RESTRICTED_SESSION_TTL_MS)
      : configuredMaxAgeMs;
    const expiresAt = new Date(now.valueOf() + maxAgeMs);
    let deviceCookie: { token: string; maxAge: number } | undefined;

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
            ...(matchedTotpStep === undefined
              ? []
              : [
                  {
                    OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: matchedTotpStep } }],
                  },
                ]),
            ...(matchedTotpStep === undefined
              ? []
              : [{ totpSecretCiphertext: user.totpSecretCiphertext }]),
          ],
        },
        data: {
          lastLoginAt: now,
          ...(matchedTotpStep === undefined ? {} : { totpLastUsedStep: matchedTotpStep }),
          ...(rotatedTotpSecret
            ? {
                totpSecretCiphertext: rotatedTotpSecret.ciphertext,
                totpSecretIv: rotatedTotpSecret.iv,
                totpSecretAuthTag: rotatedTotpSecret.authTag,
                totpKeyId: rotatedTotpSecret.keyId,
              }
            : {}),
        },
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
          mfaVerifiedAt: mfaApplies ? now : null,
        },
      });
      if (usableDevice) {
        await transaction.trustedDevice.updateMany({
          where: { id: usableDevice.id, revokedAt: null, expiresAt: { gt: now } },
          data: { lastUsedAt: now },
        });
      } else if (matchedTotpStep !== undefined) {
        const createdDevice = await createOrRotateDevice(
          transaction,
          req,
          user.id,
          now,
          req.body.trustDevice,
        );
        deviceCookie = { token: createdDevice.token, maxAge: createdDevice.maxAge };
      }
      await writeAuditLog(transaction, {
        data: {
          actorUserId: user.id,
          action: 'auth.login',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
          metadata: {
            mfaMethod: usableDevice ? 'recognized_device' : matchedTotpStep ? 'totp' : 'none',
          },
        },
      });
      await cleanupStaleSessions(transaction, now);
    });

    res.cookie(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(maxAgeMs));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(maxAgeMs));
    if (deviceCookie) setTrustedDeviceCookie(res, deviceCookie.token, deviceCookie.maxAge);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        username: user.username,
        role: user.role,
        mustChangePassword: user.mustChangePassword,
        mfaEnabled: mfaApplies,
        mfaVerified: mfaApplies,
        mustEnrollMfa,
        venueId: user.venueId,
        venueIds: [
          ...new Set([
            ...user.managedVenueAssignments.map((assignment) => assignment.venueId),
            ...(user.venueId ? [user.venueId] : []),
          ]),
        ],
      },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/admin-step-up',
  authenticate,
  requireChangedPassword,
  requireRole('ADMIN'),
  requireMfaFeatureEnabled,
  adminStepUpLimiter,
  adminStepUpAccountLimiter,
  verifyCsrf,
  validateRequest(mfaProtectedRequestSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        status: true,
        activeAt: true,
        mustChangePassword: true,
        totpSecretCiphertext: true,
        totpSecretIv: true,
        totpSecretAuthTag: true,
        totpKeyId: true,
        totpEnabledAt: true,
        totpLastUsedStep: true,
      },
    });
    if (
      !user ||
      user.role !== 'ADMIN' ||
      user.status !== 'ACTIVE' ||
      user.mustChangePassword ||
      user.totpEnabledAt === null ||
      !(await verifyPassword(user.passwordHash, req.body.currentPassword))
    ) {
      throw new AppError(INVALID_ADMIN_STEP_UP_MESSAGE, 401);
    }

    const now = new Date();
    const totpSecret = decryptTotpSecret(user);
    const matchedTotpStep = findMatchingTotpStep(totpSecret, req.body.totpCode, now);
    if (
      matchedTotpStep === undefined ||
      (user.totpLastUsedStep !== null && matchedTotpStep <= user.totpLastUsedStep)
    ) {
      throw new AppError(INVALID_ADMIN_STEP_UP_MESSAGE, 401);
    }

    const rotatedTotpSecret =
      user.totpKeyId === env.DATA_ENCRYPTION_ACTIVE_KEY_ID
        ? undefined
        : {
            ...encryptValueWithKey(
              totpSecret,
              dataEncryptionKeyring[env.DATA_ENCRYPTION_ACTIVE_KEY_ID]!,
              totpEncryptionAad(user.id),
            ),
            keyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
          };
    const currentToken = getCookie(req, env.SESSION_COOKIE_NAME);
    if (!currentToken) throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();

    const { expiresAt } = await prisma.$transaction(async (transaction) => {
      const claimedUser = await transaction.user.updateMany({
        where: {
          id: user.id,
          passwordHash: user.passwordHash,
          role: 'ADMIN',
          status: 'ACTIVE',
          mustChangePassword: false,
          totpEnabledAt: user.totpEnabledAt,
          totpSecretCiphertext: user.totpSecretCiphertext,
          AND: [
            { OR: [{ activeAt: null }, { activeAt: { lte: now } }] },
            user.totpLastUsedStep === null
              ? { totpLastUsedStep: null }
              : { totpLastUsedStep: user.totpLastUsedStep },
          ],
        },
        data: {
          totpLastUsedStep: matchedTotpStep,
          ...(rotatedTotpSecret
            ? {
                totpSecretCiphertext: rotatedTotpSecret.ciphertext,
                totpSecretIv: rotatedTotpSecret.iv,
                totpSecretAuthTag: rotatedTotpSecret.authTag,
                totpKeyId: rotatedTotpSecret.keyId,
              }
            : {}),
        },
      });
      if (claimedUser.count !== 1) {
        throw new AppError(INVALID_ADMIN_STEP_UP_MESSAGE, 401);
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
          tokenHash: hashToken(currentToken),
          mfaVerifiedAt: { lte: now },
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: {
          tokenHash: hashToken(token),
          csrfTokenHash: hashToken(csrfToken),
          lastUsedAt: now,
          adminStepUpVerifiedAt: now,
        },
      });
      if (rotatedSession.count !== 1) {
        throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
      }
      await writeAuditLog(transaction, {
        data: {
          actorUserId: user.id,
          action: 'auth.admin_step_up',
          targetType: 'AuthSession',
          targetId: req.auth!.sessionId,
          correlationId: req.correlationId,
        },
      });
      return currentSession;
    });

    const remainingMaxAgeMs = Math.max(1, expiresAt.valueOf() - Date.now());
    const validUntil = new Date(
      Math.min(expiresAt.valueOf(), now.valueOf() + ADMIN_STEP_UP_TTL_MS),
    );
    res.cookie(env.SESSION_COOKIE_NAME, token, sessionCookieOptions(remainingMaxAgeMs));
    res.cookie(CSRF_COOKIE_NAME, csrfToken, csrfCookieOptions(remainingMaxAgeMs));
    res.json({
      success: true,
      data: { validUntil },
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
        mfaEnabled: req.auth!.mfaEnabled,
        mfaVerified: req.auth!.mfaVerified,
        mustEnrollMfa: req.auth!.mustEnrollMfa,
        venueId: req.auth!.venueId,
        venueIds: req.auth!.venueIds,
      },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/password/setup',
  passwordSetupLimiter,
  validateRequest(
    z.object({
      body: passwordSetupBodySchema,
      query: z.object({}).strict(),
      params: z.object({}).strict(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const tokenHash = hashToken(req.body.token);
    const setupToken = await prisma.passwordSetupToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });
    const invalidToken =
      !setupToken ||
      setupToken.usedAt !== null ||
      setupToken.revokedAt !== null ||
      setupToken.expiresAt <= now ||
      setupToken.purpose !== req.body.purpose ||
      setupToken.user.status !== 'ACTIVE';
    if (invalidToken || !setupToken) {
      throw new AppError('Parola kurulum bağlantısı geçersiz veya süresi dolmuş.', 410);
    }
    if (setupToken.user.activeAt !== null && setupToken.user.activeAt > now) {
      throw new AppError('Hesap aktivasyon zamanı henüz gelmedi.', 409, true, undefined, {
        code: 'PASSWORD_SETUP_NOT_ACTIVE',
      });
    }
    if (isPasswordSimilarToUsername(req.body.newPassword, setupToken.user.username)) {
      throw new AppError('Yeni parola kullanıcı adına benzememelidir.', 400);
    }

    const passwordHash = await hashPassword(req.body.newPassword);
    await prisma.$transaction(async (transaction) => {
      const claimedToken = await transaction.passwordSetupToken.updateMany({
        where: {
          id: setupToken.id,
          tokenHash,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (claimedToken.count !== 1) {
        throw new AppError('Parola kurulum bağlantısı geçersiz veya süresi dolmuş.', 410);
      }

      const changedUser = await transaction.user.updateMany({
        where: {
          id: setupToken.user.id,
          updatedAt: setupToken.user.updatedAt,
          status: 'ACTIVE',
          OR: [{ activeAt: null }, { activeAt: { lte: now } }],
        },
        data: {
          passwordHash,
          mustChangePassword: false,
          temporaryPasswordExpiresAt: null,
          passwordChangedAt: now,
        },
      });
      if (changedUser.count !== 1) {
        throw new AppError('Hesap başka bir işlemde güncellendi.', 409);
      }
      await transaction.passwordSetupToken.updateMany({
        where: {
          userId: setupToken.user.id,
          id: { not: setupToken.id },
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
      await transaction.authSession.updateMany({
        where: { userId: setupToken.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.trustedDevice.updateMany({
        where: { userId: setupToken.user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.messageTask.updateMany({
        where: {
          wedding: { customerUserId: setupToken.user.id },
          kind: { in: ['ACCOUNT_ACTIVATION', 'PASSWORD_RESET'] },
          status: { in: ['PLANNED', 'PREPARED', 'READY_TO_SEND', 'FAILED'] },
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledReason: 'password_setup_completed',
          preparedAt: null,
          readyAt: null,
          failedAt: null,
          failureReason: null,
          nextAttemptAt: null,
          preparedTokenId: null,
          preparedMessageCiphertext: null,
          preparedMessageIv: null,
          preparedMessageAuthTag: null,
          sentAt: null,
          sentById: null,
          secretCiphertext: null,
          secretIv: null,
          secretAuthTag: null,
        },
      });
      await writeAuditLog(transaction, {
        data: {
          action: 'auth.password_setup',
          targetType: 'User',
          targetId: setupToken.user.id,
          correlationId: req.correlationId,
          metadata: { purpose: setupToken.purpose },
        },
      });
    });

    res.json({
      success: true,
      data: { username: setupToken.user.username },
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
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        status: true,
        activeAt: true,
        mustChangePassword: true,
        temporaryPasswordExpiresAt: true,
      },
    });
    if (!user || !(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw new AppError('Mevcut parola hatalı.', 401);
    }
    if (await verifyPassword(user.passwordHash, req.body.newPassword)) {
      throw new AppError('Yeni parola mevcut paroladan farklı olmalıdır.', 400);
    }
    if (isPasswordSimilarToUsername(req.body.newPassword, user.username)) {
      throw new AppError('Yeni parola kullanıcı adına benzememelidir.', 400);
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

      await transaction.passwordSetupToken.updateMany({
        where: { userId: user.id, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

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
          adminStepUpVerifiedAt: null,
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
      await transaction.trustedDevice.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.messageTask.updateMany({
        where: {
          wedding: { customerUserId: user.id },
          kind: { in: ['ACCOUNT_ACTIVATION', 'PASSWORD_RESET'] },
          status: { in: ['PLANNED', 'PREPARED', 'READY_TO_SEND', 'FAILED'] },
        },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledReason: 'password_changed',
          preparedAt: null,
          readyAt: null,
          failedAt: null,
          failureReason: null,
          nextAttemptAt: null,
          preparedTokenId: null,
          preparedMessageCiphertext: null,
          preparedMessageIv: null,
          preparedMessageAuthTag: null,
          sentAt: null,
          sentById: null,
          secretCiphertext: null,
          secretIv: null,
          secretAuthTag: null,
        },
      });
      await writeAuditLog(transaction, {
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
    clearTrustedDeviceCookie(res);

    res.json({
      success: true,
      data: {
        role: req.auth!.role,
        mustChangePassword: false,
        mfaEnabled: req.auth!.mfaEnabled,
        mfaVerified: req.auth!.mfaVerified,
        mustEnrollMfa: req.auth!.mustEnrollMfa,
      },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/mfa/enroll',
  mfaManagementLimiter,
  authenticate,
  requireRole('ADMIN'),
  requireMfaFeatureEnabled,
  verifyCsrf,
  validateRequest(
    z.object({
      body: mfaEnrollmentBodySchema,
      query: z.object({}).strict(),
      params: z.object({}).strict(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        username: true,
        passwordHash: true,
        role: true,
        status: true,
        mustChangePassword: true,
        totpEnabledAt: true,
        updatedAt: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError('Bu hesap iki adımlı doğrulama kurulumunu desteklemiyor.', 403);
    }
    if (user.mustChangePassword) {
      throw new AppError('Önce geçici parolanızı değiştirin.', 428, true, {
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    if (user.totpEnabledAt !== null) {
      throw new AppError('İki adımlı doğrulama zaten etkin.', 409);
    }
    if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw new AppError('Mevcut parola hatalı.', 401);
    }

    const secret = createTotpSecret();
    const encrypted = encryptValueWithKey(
      secret,
      dataEncryptionKeyring[env.DATA_ENCRYPTION_ACTIVE_KEY_ID]!,
      totpEncryptionAad(user.id),
    );
    const now = new Date();
    const enrollmentExpiresAt = new Date(now.valueOf() + TOTP_ENROLLMENT_TTL_MINUTES * 60 * 1000);
    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.user.updateMany({
        where: {
          id: user.id,
          updatedAt: user.updatedAt,
          status: 'ACTIVE',
          totpEnabledAt: null,
        },
        data: {
          totpSecretCiphertext: encrypted.ciphertext,
          totpSecretIv: encrypted.iv,
          totpSecretAuthTag: encrypted.authTag,
          totpKeyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
          totpEnrollmentExpiresAt: enrollmentExpiresAt,
          totpLastUsedStep: null,
        },
      });
      if (claimed.count !== 1) {
        throw new AppError('MFA kurulumu başka bir işlem tarafından değiştirildi.', 409);
      }
      await writeAuditLog(transaction, {
        data: {
          actorUserId: user.id,
          action: 'auth.mfa_enrollment_started',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
        },
      });
    });

    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        secret,
        otpauthUri: createTotpEnrollmentUri(secret, user.username),
        expiresAt: enrollmentExpiresAt,
      },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/mfa/confirm',
  mfaManagementLimiter,
  authenticate,
  requireRole('ADMIN'),
  requireMfaFeatureEnabled,
  verifyCsrf,
  validateRequest(mfaProtectedRequestSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        status: true,
        mustChangePassword: true,
        totpSecretCiphertext: true,
        totpSecretIv: true,
        totpSecretAuthTag: true,
        totpKeyId: true,
        totpEnrollmentExpiresAt: true,
        totpEnabledAt: true,
        updatedAt: true,
      },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new AppError('Bu hesap iki adımlı doğrulama kurulumunu desteklemiyor.', 403);
    }
    if (user.mustChangePassword) {
      throw new AppError('Önce geçici parolanızı değiştirin.', 428, true, {
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    if (user.totpEnabledAt !== null) {
      throw new AppError('İki adımlı doğrulama zaten etkin.', 409);
    }
    const now = new Date();
    if (!user.totpEnrollmentExpiresAt || user.totpEnrollmentExpiresAt <= now) {
      throw new AppError('MFA kurulumu süresi doldu. Kurulumu yeniden başlatın.', 410);
    }
    if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw new AppError('Mevcut parola hatalı.', 401);
    }
    const matchedStep = findMatchingTotpStep(decryptTotpSecret(user), req.body.totpCode, now);
    if (matchedStep === undefined) {
      throw new AppError('Doğrulama kodu hatalı.', 401);
    }

    const token = createOpaqueToken();
    const csrfToken = createOpaqueToken();
    const { expiresAt } = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.user.updateMany({
        where: {
          id: user.id,
          updatedAt: user.updatedAt,
          status: 'ACTIVE',
          totpEnabledAt: null,
          totpEnrollmentExpiresAt: { gt: now },
          totpSecretCiphertext: user.totpSecretCiphertext,
        },
        data: {
          totpEnabledAt: now,
          totpEnrollmentExpiresAt: null,
          totpLastUsedStep: matchedStep,
        },
      });
      if (claimed.count !== 1) {
        throw new AppError('MFA kurulumu başka bir işlem tarafından değiştirildi.', 409);
      }

      const currentSession = await transaction.authSession.findUnique({
        where: { id: req.auth!.sessionId },
        select: { expiresAt: true },
      });
      if (!currentSession || currentSession.expiresAt <= now) {
        throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
      }
      const rotated = await transaction.authSession.updateMany({
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
          mfaVerifiedAt: now,
          adminStepUpVerifiedAt: null,
        },
      });
      if (rotated.count !== 1) {
        throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
      }
      await transaction.authSession.updateMany({
        where: { userId: user.id, id: { not: req.auth!.sessionId }, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.trustedDevice.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAuditLog(transaction, {
        data: {
          actorUserId: user.id,
          action: 'auth.mfa_enabled',
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
    clearTrustedDeviceCookie(res);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: { mfaEnabled: true, mustEnrollMfa: false },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/mfa/disable',
  mfaManagementLimiter,
  authenticate,
  requireRole('ADMIN'),
  requireMfaFeatureEnabled,
  verifyCsrf,
  validateRequest(mfaProtectedRequestSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.auth!.userId },
      select: {
        id: true,
        passwordHash: true,
        role: true,
        status: true,
        mustChangePassword: true,
        totpSecretCiphertext: true,
        totpSecretIv: true,
        totpSecretAuthTag: true,
        totpKeyId: true,
        totpEnabledAt: true,
        totpLastUsedStep: true,
        updatedAt: true,
      },
    });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      user.mustChangePassword ||
      user.totpEnabledAt === null ||
      user.totpLastUsedStep === null
    ) {
      throw new AppError('Etkin iki adımlı doğrulama kaydı bulunamadı.', 409);
    }
    if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) {
      throw new AppError('Mevcut parola hatalı.', 401);
    }
    const now = new Date();
    const matchedStep = findMatchingTotpStep(decryptTotpSecret(user), req.body.totpCode, now);
    if (matchedStep === undefined || matchedStep <= user.totpLastUsedStep) {
      throw new AppError('Doğrulama kodu hatalı veya daha önce kullanılmış.', 401);
    }

    await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.user.updateMany({
        where: {
          id: user.id,
          updatedAt: user.updatedAt,
          status: 'ACTIVE',
          totpEnabledAt: { not: null },
          totpLastUsedStep: user.totpLastUsedStep,
        },
        data: {
          totpSecretCiphertext: null,
          totpSecretIv: null,
          totpSecretAuthTag: null,
          totpKeyId: null,
          totpEnrollmentExpiresAt: null,
          totpEnabledAt: null,
          totpLastUsedStep: null,
        },
      });
      if (claimed.count !== 1) {
        throw new AppError('MFA ayarı başka bir işlem tarafından değiştirildi.', 409);
      }
      await transaction.authSession.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.trustedDevice.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAuditLog(transaction, {
        data: {
          actorUserId: user.id,
          action: 'auth.mfa_disabled',
          targetType: 'User',
          targetId: user.id,
          correlationId: req.correlationId,
        },
      });
    });

    clearAuthCookies(res);
    clearTrustedDeviceCookie(res);
    res.set('Cache-Control', 'no-store');
    res.json({
      success: true,
      data: {
        mfaEnabled: false,
        mustEnrollMfa: isMfaEnrollmentRequired(user.role, false),
      },
      correlationId: req.correlationId,
    });
  }),
);

router.post(
  '/devices/revoke-all',
  authenticate,
  requireChangedPassword,
  requireRole('ADMIN'),
  verifyCsrf,
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const result = await prisma.$transaction(async (transaction) => {
      const revoked = await transaction.trustedDevice.updateMany({
        where: { userId: req.auth!.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await writeAuditLog(transaction, {
        data: {
          actorUserId: req.auth!.userId,
          action: 'auth.trusted_devices_revoked',
          targetType: 'User',
          targetId: req.auth!.userId,
          correlationId: req.correlationId,
          metadata: { count: revoked.count },
        },
      });
      return revoked;
    });
    clearTrustedDeviceCookie(res);
    res.json({ success: true, data: { revoked: result.count }, correlationId: req.correlationId });
  }),
);

router.get(
  '/devices',
  authenticate,
  requireChangedPassword,
  requireRole('ADMIN'),
  validateRequest(emptyRequestSchema),
  asyncHandler(async (req, res) => {
    const now = new Date();
    const currentToken = readTrustedDeviceToken(req);
    const currentHash = currentToken ? hashToken(currentToken) : null;
    const devices = await prisma.trustedDevice.findMany({
      where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: now } },
      select: {
        id: true,
        tokenHash: true,
        name: true,
        trusted: true,
        lastMfaAt: true,
        lastUsedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: [{ lastUsedAt: 'desc' }, { id: 'asc' }],
    });
    res.json({
      success: true,
      data: devices.map(({ tokenHash, ...device }) => ({
        ...device,
        current: currentHash !== null && tokenHash === currentHash,
      })),
      correlationId: req.correlationId,
    });
  }),
);

router.delete(
  '/devices/:id',
  authenticate,
  requireChangedPassword,
  requireRole('ADMIN'),
  verifyCsrf,
  validateRequest(
    z.object({
      body: z.object({}).strict().optional().default({}),
      query: z.object({}).strict(),
      params: z.object({ id: z.string().uuid() }).strict(),
    }),
  ),
  asyncHandler(async (req, res) => {
    const currentToken = readTrustedDeviceToken(req);
    const currentHash = currentToken ? hashToken(currentToken) : null;
    const device = await prisma.trustedDevice.findFirst({
      where: { id: req.params.id, userId: req.auth!.userId, revokedAt: null },
      select: { id: true, tokenHash: true },
    });
    if (!device) throw new AppError('Güvenilen cihaz bulunamadı.', 404);
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const revoked = await transaction.trustedDevice.updateMany({
        where: { id: device.id, userId: req.auth!.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (revoked.count !== 1) {
        throw new AppError('Cihaz kaydı başka bir işlemde değiştirildi.', 409);
      }
      await writeAuditLog(transaction, {
        data: {
          actorUserId: req.auth!.userId,
          action: 'auth.trusted_device_revoked',
          targetType: 'TrustedDevice',
          targetId: device.id,
          correlationId: req.correlationId,
        },
      });
    });
    if (currentHash === device.tokenHash) clearTrustedDeviceCookie(res);
    res.json({ success: true, data: { id: device.id }, correlationId: req.correlationId });
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
      await writeAuditLog(transaction, {
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
