import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { env } from '../config/env.config.js';
import { createOpaqueToken, hashToken } from './crypto.js';

export const TRUSTED_DEVICE_COOKIE_NAME = 'dugunajansim_trusted_device';
export const DAILY_MFA_TTL_MS = 24 * 60 * 60 * 1000;
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const normalizedUserAgent = (req: Request): string =>
  String(req.get('user-agent') ?? 'bilinmeyen-tarayici')
    .trim()
    .slice(0, 512);

export const userAgentHash = (req: Request): string => hashToken(normalizedUserAgent(req));

export const describeDevice = (req: Request): string => {
  const value = normalizedUserAgent(req);
  const browser = /Edg\//i.test(value)
    ? 'Edge'
    : /Firefox\//i.test(value)
      ? 'Firefox'
      : /Chrome\//i.test(value)
        ? 'Chrome'
        : /Safari\//i.test(value)
          ? 'Safari'
          : 'Tarayıcı';
  const platform = /Windows/i.test(value)
    ? 'Windows'
    : /Android/i.test(value)
      ? 'Android'
      : /iPhone|iPad/i.test(value)
        ? 'iOS'
        : /Macintosh/i.test(value)
          ? 'macOS'
          : /Linux/i.test(value)
            ? 'Linux'
            : 'Bilinmeyen cihaz';
  return `${browser} / ${platform}`;
};

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge,
});

export const setTrustedDeviceCookie = (res: Response, token: string, maxAge: number): void => {
  res.cookie(TRUSTED_DEVICE_COOKIE_NAME, token, cookieOptions(maxAge));
};

export const clearTrustedDeviceCookie = (res: Response): void => {
  const { maxAge: _maxAge, ...options } = cookieOptions(1);
  res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, options);
};

export const readTrustedDeviceToken = (req: Request): string | undefined => {
  const matches = String(req.headers.cookie ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter((entry) => entry.startsWith(`${TRUSTED_DEVICE_COOKIE_NAME}=`));
  if (matches.length !== 1) return undefined;
  try {
    return decodeURIComponent(matches[0]!.slice(TRUSTED_DEVICE_COOKIE_NAME.length + 1));
  } catch {
    return undefined;
  }
};

export const findUsableDevice = async (
  client: Pick<Prisma.TransactionClient, 'trustedDevice'>,
  req: Request,
  userId: string,
  now: Date,
) => {
  const token = readTrustedDeviceToken(req);
  if (!token) return null;
  const device = await client.trustedDevice.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!device || device.userId !== userId || device.revokedAt || device.expiresAt <= now) {
    return null;
  }
  if (device.userAgentHash !== userAgentHash(req)) {
    await client.trustedDevice.updateMany({
      where: { id: device.id, revokedAt: null },
      data: { revokedAt: now },
    });
    return null;
  }
  return device;
};

export const createOrRotateDevice = async (
  client: Pick<Prisma.TransactionClient, 'trustedDevice'>,
  req: Request,
  userId: string,
  now: Date,
  trusted: boolean,
) => {
  const token = createOpaqueToken();
  const expiresAt = new Date(now.valueOf() + (trusted ? TRUSTED_DEVICE_TTL_MS : DAILY_MFA_TTL_MS));
  const existingToken = readTrustedDeviceToken(req);
  if (existingToken) {
    await client.trustedDevice.updateMany({
      where: { tokenHash: hashToken(existingToken), userId, revokedAt: null },
      data: { revokedAt: now },
    });
  }
  const device = await client.trustedDevice.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      name: describeDevice(req),
      userAgentHash: userAgentHash(req),
      trusted,
      lastMfaAt: now,
      lastUsedAt: now,
      expiresAt,
    },
  });
  return { device, token, maxAge: expiresAt.valueOf() - now.valueOf() };
};
