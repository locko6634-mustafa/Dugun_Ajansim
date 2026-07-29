import type { UserRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';
import { hashToken, tokenHashesMatch } from '../utils/crypto.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const CSRF_COOKIE_NAME = 'dugunajansim_csrf';

const parseCookies = (header: string | undefined): Map<string, string> => {
  const cookies = new Map<string, string>();
  if (!header) return cookies;

  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    if (name) cookies.set(name, decodeURIComponent(value));
  }
  return cookies;
};

export const getCookie = (req: Request, name: string): string | undefined =>
  parseCookies(req.headers.cookie).get(name);

export const authenticate = asyncHandler(async (req, _res, next) => {
  const token = getCookie(req, env.SESSION_COOKIE_NAME);
  if (!token) {
    throw new AppError('Oturum açmanız gerekiyor.', 401);
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  const now = new Date();
  if (
    !session ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.user.status !== 'ACTIVE' ||
    (session.user.activeAt && session.user.activeAt > now)
  ) {
    throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
  }

  req.auth = {
    userId: session.user.id,
    username: session.user.username,
    role: session.user.role,
    sessionId: session.id,
    mustChangePassword: session.user.mustChangePassword,
  };

  if (now.valueOf() - session.lastUsedAt.valueOf() > 5 * 60 * 1000) {
    await prisma.authSession.update({
      where: { id: session.id },
      data: { lastUsedAt: now },
    });
  }

  next();
});

export const requireChangedPassword = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (req.auth?.mustChangePassword) {
    next(new AppError('Devam etmek için geçici parolanızı değiştirin.', 428));
    return;
  }
  next();
};

export const requireRole = (...roles: UserRole[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      next(new AppError('Bu işlem için yetkiniz bulunmuyor.', 403));
      return;
    }
    next();
  };

export const verifyCsrf = (req: Request, _res: Response, next: NextFunction): void => {
  const headerToken = req.get('X-CSRF-Token');
  const cookieToken = getCookie(req, CSRF_COOKIE_NAME);

  if (!req.auth || !headerToken || !cookieToken || headerToken !== cookieToken) {
    next(new AppError('CSRF doğrulaması başarısız.', 403));
    return;
  }

  void prisma.authSession
    .findUnique({
      where: { id: req.auth.sessionId },
      select: { csrfTokenHash: true },
    })
    .then((session) => {
      if (!session || !tokenHashesMatch(headerToken, session.csrfTokenHash)) {
        next(new AppError('CSRF doğrulaması başarısız.', 403));
        return;
      }
      next();
    })
    .catch(next);
};

export const sessionCookieOptions = (maxAgeMs: number) => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: maxAgeMs,
});

export const csrfCookieOptions = (maxAgeMs: number) => ({
  httpOnly: false,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: maxAgeMs,
});

export const clearAuthCookies = (res: Response): void => {
  res.clearCookie(env.SESSION_COOKIE_NAME, { path: '/' });
  res.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
};

export { CSRF_COOKIE_NAME };
