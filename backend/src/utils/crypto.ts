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

const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;

const decodeCanonicalBase64 = (value: string): Buffer => {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new Error('Şifreli veri biçimi geçersiz.');
  }
  return decoded;
};

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

const parseEncryptionKey = (keyHex: string): Buffer => {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) throw new Error('Şifreleme anahtarı biçimi geçersiz.');
  return Buffer.from(keyHex, 'hex');
};

const encryptValueWithBuffer = (value: string, key: Buffer, aad?: string): EncryptedValue => {
  const iv = randomBytes(GCM_IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_AUTH_TAG_BYTES,
  });
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
};

const decryptValueWithBuffer = (value: EncryptedValue, key: Buffer, aad?: string): string => {
  const iv = decodeCanonicalBase64(value.iv);
  const authTag = decodeCanonicalBase64(value.authTag);
  const ciphertext = decodeCanonicalBase64(value.ciphertext);
  if (iv.length !== GCM_IV_BYTES || authTag.length !== GCM_AUTH_TAG_BYTES) {
    throw new Error('Şifreli veri biçimi geçersiz.');
  }

  const decipher = createDecipheriv('aes-256-gcm', key, iv, {
    authTagLength: GCM_AUTH_TAG_BYTES,
  });
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

export const encryptValueWithKey = (value: string, keyHex: string, aad?: string): EncryptedValue =>
  encryptValueWithBuffer(value, parseEncryptionKey(keyHex), aad);

export const decryptValueWithKey = (
  value: EncryptedValue,
  keyHex: string,
  aad?: string,
): string => decryptValueWithBuffer(value, parseEncryptionKey(keyHex), aad);

export const encryptValue = (value: string, aad?: string): EncryptedValue =>
  encryptValueWithBuffer(value, parseEncryptionKey(env.DATA_ENCRYPTION_KEY), aad);

export const decryptValue = (value: EncryptedValue, aad?: string): string =>
  decryptValueWithBuffer(value, parseEncryptionKey(env.DATA_ENCRYPTION_KEY), aad);
