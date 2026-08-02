import { env } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';
import { hashToken, tokenHashesMatch } from '../utils/crypto.js';
import { AppError } from '../utils/appError.js';
import { asyncHandler } from '../utils/asyncHandler.js';
const CSRF_COOKIE_NAME = 'dugunajansim_csrf';
const parseCookies = (header) => {
    const cookies = new Map();
    if (!header)
        return cookies;
    for (const entry of header.split(';')) {
        const separator = entry.indexOf('=');
        if (separator < 0)
            continue;
        const name = entry.slice(0, separator).trim();
        const value = entry.slice(separator + 1).trim();
        if (!name)
            continue;
        if (cookies.has(name)) {
            cookies.set(name, undefined);
            continue;
        }
        try {
            cookies.set(name, decodeURIComponent(value));
        }
        catch {
            cookies.set(name, undefined);
        }
    }
    return cookies;
};
export const getCookie = (req, name) => parseCookies(req.headers.cookie).get(name);
export const getSessionIdleTimeoutMs = (role) => role === 'MUSTERI'
    ? env.CUSTOMER_SESSION_IDLE_HOURS * 60 * 60 * 1000
    : env.ADMIN_SESSION_IDLE_MINUTES * 60 * 1000;
export const calculateSessionTouchIntervalMs = (idleTimeoutMs) => Math.min(5 * 60 * 1000, Math.floor(idleTimeoutMs / 2));
export const getSessionTouchIntervalMs = (role) => calculateSessionTouchIntervalMs(getSessionIdleTimeoutMs(role));
export const getSessionAbsoluteTtlMs = (role, remember) => role === 'MUSTERI' && remember
    ? env.REMEMBER_SESSION_TTL_DAYS * 24 * 60 * 60 * 1000
    : env.SESSION_TTL_HOURS * 60 * 60 * 1000;
export const isTemporaryPasswordExpired = (user, now) => user.mustChangePassword &&
    (user.temporaryPasswordExpiresAt === null || user.temporaryPasswordExpiresAt <= now);
export const authenticate = asyncHandler(async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const token = getCookie(req, env.SESSION_COOKIE_NAME);
    if (!token) {
        if (req.headers.cookie)
            clearAuthCookies(res);
        throw new AppError('Oturum açmanız gerekiyor.', 401);
    }
    const session = await prisma.authSession.findUnique({
        where: { tokenHash: hashToken(token) },
        include: { user: true },
    });
    const now = new Date();
    const idleTimeoutMs = session === null ? 0 : getSessionIdleTimeoutMs(session.user.role);
    const idleExpired = session !== null && now.valueOf() - session.lastUsedAt.valueOf() >= idleTimeoutMs;
    const temporaryPasswordExpired = session !== null && isTemporaryPasswordExpired(session.user, now);
    if (!session ||
        session.revokedAt ||
        session.expiresAt <= now ||
        idleExpired ||
        session.user.status !== 'ACTIVE' ||
        (session.user.activeAt && session.user.activeAt > now) ||
        temporaryPasswordExpired) {
        clearAuthCookies(res);
        if (session && !session.revokedAt) {
            await prisma.authSession.updateMany({
                where: { id: session.id, revokedAt: null },
                data: { revokedAt: now },
            });
        }
        throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
    }
    req.auth = {
        userId: session.user.id,
        username: session.user.username,
        role: session.user.role,
        sessionId: session.id,
        mustChangePassword: session.user.mustChangePassword,
    };
    if (now.valueOf() - session.lastUsedAt.valueOf() >=
        getSessionTouchIntervalMs(session.user.role)) {
        const touched = await prisma.authSession.updateMany({
            where: { id: session.id, revokedAt: null, expiresAt: { gt: now } },
            data: { lastUsedAt: now },
        });
        if (touched.count !== 1) {
            clearAuthCookies(res);
            throw new AppError('Oturum geçersiz veya süresi dolmuş.', 401);
        }
    }
    next();
});
export const requireChangedPassword = (req, _res, next) => {
    if (req.auth?.mustChangePassword) {
        next(new AppError('Devam etmek için geçici parolanızı değiştirin.', 428));
        return;
    }
    next();
};
export const requireRole = (...roles) => (req, _res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
        next(new AppError('Bu işlem için yetkiniz bulunmuyor.', 403));
        return;
    }
    next();
};
export const verifyCsrf = (req, _res, next) => {
    const headerToken = req.get('X-CSRF-Token');
    const cookieToken = getCookie(req, CSRF_COOKIE_NAME);
    if (!req.auth || !headerToken || !cookieToken || headerToken !== cookieToken) {
        next(new AppError('CSRF doğrulaması başarısız.', 403));
        return;
    }
    void prisma.authSession
        .findUnique({
        where: { id: req.auth.sessionId },
        select: { csrfTokenHash: true, revokedAt: true, expiresAt: true },
    })
        .then((session) => {
        if (!session ||
            session.revokedAt ||
            session.expiresAt <= new Date() ||
            !tokenHashesMatch(headerToken, session.csrfTokenHash)) {
            next(new AppError('CSRF doğrulaması başarısız.', 403));
            return;
        }
        next();
    })
        .catch(next);
};
export const sessionCookieOptions = (maxAgeMs) => ({
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
});
export const csrfCookieOptions = (maxAgeMs) => ({
    httpOnly: false,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
});
export const clearAuthCookies = (res) => {
    const options = {
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
    };
    res.clearCookie(env.SESSION_COOKIE_NAME, options);
    res.clearCookie(CSRF_COOKIE_NAME, options);
};
export { CSRF_COOKIE_NAME };
