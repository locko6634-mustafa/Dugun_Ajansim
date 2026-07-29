import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from 'argon2';
import { env } from '../config/env.config.js';

export type EncryptedValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

const encryptionKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex');

export const hashPassword = (password: string): Promise<string> =>
  argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

export const verifyPassword = (hash: string, password: string): Promise<boolean> =>
  argon2.verify(hash, password);

export const createOpaqueToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export const tokenHashesMatch = (plainToken: string, storedHash: string): boolean => {
  const candidate = Buffer.from(hashToken(plainToken), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
};

export const encryptValue = (value: string): EncryptedValue => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
};

export const decryptValue = (value: EncryptedValue): string => {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey,
    Buffer.from(value.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
};
