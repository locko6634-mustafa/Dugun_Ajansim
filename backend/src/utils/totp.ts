import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_ENROLLMENT_TTL_MINUTES = 10;

const encodeBase32 = (value: Buffer): string => {
  let bits = 0;
  let buffer = 0;
  let encoded = '';

  for (const byte of value) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }

  if (bits > 0) encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  return encoded;
};

const decodeBase32 = (value: string): Buffer => {
  const normalized = value.trim().toUpperCase();
  if (!normalized || !/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error('TOTP sırrı biçimi geçersiz.');
  }

  let bits = 0;
  let buffer = 0;
  const decoded: number[] = [];
  for (const character of normalized) {
    buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(decoded);
};

export const createTotpSecret = (): string => encodeBase32(randomBytes(20));

export const totpEncryptionAad = (userId: string): string => `user-totp:${userId}:v1`;

export const createTotpEnrollmentUri = (
  secret: string,
  username: string,
  issuer = 'Düğün Ajansım',
): string => {
  const label = encodeURIComponent(`${issuer}:${username}`);
  const parameters = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${parameters.toString()}`;
};

export const generateTotpCode = (
  secret: string,
  step: bigint,
  digits = TOTP_DIGITS,
): string => {
  if (step < 0n || digits < 6 || digits > 8) throw new Error('TOTP parametreleri geçersiz.');
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const truncated = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(truncated % 10 ** digits).padStart(digits, '0');
};

const codesMatch = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left, 'ascii');
  const rightBuffer = Buffer.from(right, 'ascii');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

export const findMatchingTotpStep = (
  secret: string,
  code: string,
  now = new Date(),
  window = 1,
): bigint | undefined => {
  if (!/^\d{6}$/.test(code) || !Number.isInteger(window) || window < 0 || window > 1) {
    return undefined;
  }

  const currentStep = BigInt(Math.floor(now.valueOf() / 1000 / TOTP_PERIOD_SECONDS));
  const offsets = [
    0,
    ...Array.from({ length: window }, (_, index) => -(index + 1)),
    ...Array.from({ length: window }, (_, index) => index + 1),
  ];
  for (const offset of offsets) {
    const candidateStep = currentStep + BigInt(offset);
    if (candidateStep >= 0n && codesMatch(generateTotpCode(secret, candidateStep), code)) {
      return candidateStep;
    }
  }
  return undefined;
};
