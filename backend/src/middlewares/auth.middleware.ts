import type { UserRole } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.config.js";
import { prisma } from "../config/prisma.js";
import { hashToken, tokenHashesMatch } from "../utils/crypto.js";
import { AppError } from "../utils/appError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const CSRF_COOKIE_NAME = "dugunajansim_csrf";
export const ADMIN_STEP_UP_TTL_MS = 5 * 60 * 1000;

const parseCookies = (header: string | undefined): Map<string, string | undefined> => {
  const cookies = new Map<string, string | undefined>();
  if (!header) return cookies;

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (!name) continue;
    if (cookies.has(name)) {
      cookies.set(name, undefined);
      continue;
    }
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      cookies.set(name, undefined);
    }
  }
  return cookies;
};

export const getCookie = (req: Request, name: string): string | undefined =>
  parseCookies(req.headers.cookie).get(name);

export const getSessionIdleTimeoutMs = (role: UserRole): number =>
  role === "MUSTERI"
    ? env.CUSTOMER_SESSION_IDLE_HOURS * 60 * 60 * 1000
    : role === "ADMIN"
      ? env.ADMIN_SESSION_IDLE_MINUTES * 60 * 1000
      : env.SALON_SESSION_IDLE_MINUTES * 60 * 1000;

export const calculateSessionTouchIntervalMs = (idleTimeoutMs: number): number =>
  Math.min(5 * 60 * 1000, Math.floor(idleTimeoutMs / 2));

export const getSessionTouchIntervalMs = (role: UserRole): number =>
  calculateSessionTouchIntervalMs(getSessionIdleTimeoutMs(role));

export const getSessionAbsoluteTtlMs = (role: UserRole, remember: boolean): number =>
  role === "ADMIN"
    ? env.ADMIN_SESSION_TTL_HOURS * 60 * 60 * 1000
    : role === "MUSTERI" && remember
      ? env.REMEMBER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
      : env.SESSION_TTL_HOURS * 60 * 60 * 1000;

export const isMfaRequiredRole = (
  role: UserRole,
  mfaEnabled = env.MFA_ENABLED
): boolean => mfaEnabled && role === "ADMIN";

export const isAdminStepUpFresh = (
  verifiedAt: Date | null | undefined,
  now = new Date(),
  ttlMs = ADMIN_STEP_UP_TTL_MS
): boolean => {
  if (!verifiedAt || ttlMs <= 0) return false;
  const ageMs = now.valueOf() - verifiedAt.valueOf();
  return ageMs >= 0 && ageMs < ttlMs;
};

const adminStepUpRequiredError = (): AppError =>
  new AppError("Bu işlem için güncel yönetici doğrulaması gerekli.", 428, true, undefined, {
    code: "ADMIN_STEP_UP_REQUIRED"
  });

export const assertRecentAdminStepUp = (
  verifiedAt: Date | null | undefined,
  now = new Date()
): void => {
  if (!isAdminStepUpFresh(verifiedAt, now)) throw adminStepUpRequiredError();
};

export const isMfaEnrollmentRequired = (
  role: UserRole,
  mfaEnabled: boolean,
  environment = env.NODE_ENV,
  featureEnabled = env.MFA_ENABLED
): boolean =>
  environment === "production" && isMfaRequiredRole(role, featureEnabled) && !mfaEnabled;

export const isTemporaryPasswordExpired = (
  user: {
    mustChangePassword: boolean;
    temporaryPasswordExpiresAt: Date | null;
  },
  now: Date
): boolean =>
  user.mustChangePassword &&
  (user.temporaryPasswordExpiresAt === null || user.temporaryPasswordExpiresAt <= now);

export const authenticate = asyncHandler(
  async (req, res, next) => {
    res.set("Cache-Control", "no-store");
    const token = getCookie(req, env.SESSION_COOKIE_NAME);
    if (!token) {
      if (req.headers.cookie) clearAuthCookies(res);
      throw new AppError("Oturum açmanız gerekiyor.", 401);
    }

    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashToken(token) },
      select: {
        id: true,
        expiresAt: true,
        lastUsedAt: true,
        mfaVerifiedAt: true,
        adminStepUpVerifiedAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            role: true,
            status: true,
            activeAt: true,
            mustChangePassword: true,
            temporaryPasswordExpiresAt: true,
            totpEnabledAt: true,
            venueId: true,
            managedVenueAssignments: {
              select: { venueId: true },
              orderBy: { venueId: "asc" }
            }
          }
        }
      }
    });

    const now = new Date();
    const idleTimeoutMs = session === null ? 0 : getSessionIdleTimeoutMs(session.user.role);
    const idleExpired =
      session !== null && now.valueOf() - session.lastUsedAt.valueOf() >= idleTimeoutMs;
    const temporaryPasswordExpired =
      session !== null && isTemporaryPasswordExpired(session.user, now);
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      idleExpired ||
      session.user.status !== "ACTIVE" ||
      (session.user.activeAt && session.user.activeAt > now) ||
      temporaryPasswordExpired
    ) {
      clearAuthCookies(res);
      if (session && !session.revokedAt) {
        await prisma.authSession.updateMany({
          where: { id: session.id, revokedAt: null },
          data: { revokedAt: now }
        });
      }
      throw new AppError("Oturum geçersiz veya süresi dolmuş.", 401);
    }

    const mfaApplies = isMfaRequiredRole(session.user.role);
    const venueIds = [
      ...new Set([
        ...session.user.managedVenueAssignments.map((assignment) => assignment.venueId),
        ...(session.user.venueId ? [session.user.venueId] : [])
      ])
    ];
    req.auth = {
      userId: session.user.id,
      username: session.user.username,
      role: session.user.role,
      sessionId: session.id,
      mustChangePassword: session.user.mustChangePassword,
      mfaEnabled: mfaApplies && session.user.totpEnabledAt !== null,
      mfaVerified: mfaApplies && session.mfaVerifiedAt !== null,
      adminStepUpVerifiedAt: session.adminStepUpVerifiedAt,
      mustEnrollMfa: isMfaEnrollmentRequired(
        session.user.role,
        session.user.totpEnabledAt !== null
      ),
      venueId: session.user.venueId,
      venueIds
    };

    if (
      now.valueOf() - session.lastUsedAt.valueOf() >=
      getSessionTouchIntervalMs(session.user.role)
    ) {
      const touched = await prisma.authSession.updateMany({
        where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
        data: { lastUsedAt: now }
      });
      if (touched.count !== 1) {
        clearAuthCookies(res);
        throw new AppError("Oturum geçersiz veya süresi dolmuş.", 401);
      }
    }

    next();
  },
  { unauthenticatedActorRole: "auth" }
);

export const requireChangedPassword = (req: Request, _res: Response, next: NextFunction): void => {
  if (req.auth?.mustChangePassword) {
    next(
      new AppError("Devam etmek için geçici parolanızı değiştirin.", 428, true, {
        code: "PASSWORD_CHANGE_REQUIRED"
      })
    );
    return;
  }
  if (req.auth?.mustEnrollMfa) {
    next(
      new AppError("Devam etmek için iki adımlı doğrulamayı kurun.", 428, true, {
        code: "MFA_ENROLLMENT_REQUIRED"
      })
    );
    return;
  }
  if (req.auth && isMfaRequiredRole(req.auth.role) && req.auth.mfaEnabled && !req.auth.mfaVerified) {
    next(
      new AppError("İki adımlı doğrulama gerekli.", 401, true, {
        code: "MFA_REQUIRED"
      })
    );
    return;
  }
  next();
};

export const requireRole =
  (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      next(new AppError("Bu işlem için yetkiniz bulunmuyor.", 403));
      return;
    }
    next();
  };

export const requireRecentAdminStepUp = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  try {
    assertRecentAdminStepUp(req.auth?.adminStepUpVerifiedAt);
    next();
  } catch (error) {
    next(error);
  }
};

export const verifyCsrf = asyncHandler(async (req, _res, next) => {
  const headerToken = req.get("X-CSRF-Token");
  const cookieToken = getCookie(req, CSRF_COOKIE_NAME);

  if (!req.auth || !headerToken || !cookieToken || headerToken !== cookieToken) {
    throw new AppError("CSRF doğrulaması başarısız.", 403);
  }

  const session = await prisma.authSession.findUnique({
    where: { id: req.auth.sessionId },
    select: { csrfTokenHash: true, revokedAt: true, expiresAt: true }
  });
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    !tokenHashesMatch(headerToken, session.csrfTokenHash)
  ) {
    throw new AppError("CSRF doğrulaması başarısız.", 403);
  }
  next();
});

export const sessionCookieOptions = (maxAgeMs: number, environment = env.NODE_ENV) => ({
  httpOnly: true,
  secure: environment === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeMs
});

export const csrfCookieOptions = (maxAgeMs: number, environment = env.NODE_ENV) => ({
  httpOnly: false,
  secure: environment === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: maxAgeMs
});

export const clearAuthCookies = (res: Response): void => {
  const options = {
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/"
  };
  res.clearCookie(env.SESSION_COOKIE_NAME, options);
  res.clearCookie(CSRF_COOKIE_NAME, options);
};

export { CSRF_COOKIE_NAME };
