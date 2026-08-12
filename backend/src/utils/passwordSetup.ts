import type { PasswordSetupPurpose, Prisma } from '@prisma/client';
import { env } from '../config/env.config.js';
import { createOpaqueToken, hashToken } from './crypto.js';

type PasswordSetupClient = Pick<Prisma.TransactionClient, 'passwordSetupToken'>;

export const issuePasswordSetupToken = async (
  transaction: PasswordSetupClient,
  input: {
    userId: string;
    purpose: PasswordSetupPurpose;
    createdById: string;
    notBefore?: Date | null;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> => {
  const now = new Date();
  await transaction.passwordSetupToken.updateMany({
    where: { userId: input.userId, usedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });

  const token = createOpaqueToken();
  const validityStartsAt = input.notBefore && input.notBefore > now ? input.notBefore : now;
  const expiresAt = new Date(
    validityStartsAt.valueOf() + env.TEMPORARY_PASSWORD_TTL_HOURS * 60 * 60 * 1_000,
  );
  const setupToken = await transaction.passwordSetupToken.create({
    data: {
      tokenHash: hashToken(token),
      userId: input.userId,
      purpose: input.purpose,
      expiresAt,
      createdById: input.createdById,
    },
  });
  return { id: setupToken.id, token, expiresAt };
};

export const createPasswordSetupUrl = (
  token: string,
  purpose: PasswordSetupPurpose,
): string => {
  const url = new URL('/login.html', env.CORS_ORIGIN[0]);
  url.hash = new URLSearchParams({ setup: token, purpose }).toString();
  return url.toString();
};
