import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.config.js';

const RESET_CODE_PATTERN = /^\d{6}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const hashPasswordResetCode = (challengeId: string, code: string): string =>
  createHmac('sha256', Buffer.from(env.PASSWORD_RESET_CODE_HMAC_KEY, 'hex'))
    .update(`${challengeId}\0${code}`, 'utf8')
    .digest('hex');

export const createPasswordResetChallenge = (): {
  challengeId: string;
  code: string;
  codeHash: string;
} => {
  const challengeId = randomUUID();
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  return { challengeId, code, codeHash: hashPasswordResetCode(challengeId, code) };
};

export const verifyPasswordResetCode = (
  challengeId: string,
  code: string,
  expectedHash: string,
): boolean => {
  if (
    !UUID_PATTERN.test(challengeId) ||
    !RESET_CODE_PATTERN.test(code) ||
    !SHA256_HEX_PATTERN.test(expectedHash)
  ) {
    return false;
  }

  const candidate = Buffer.from(hashPasswordResetCode(challengeId, code), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};
