import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual, } from 'node:crypto';
import argon2 from 'argon2';
import { env } from '../config/env.config.js';
const encryptionKey = Buffer.from(env.DATA_ENCRYPTION_KEY, 'hex');
const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const decodeCanonicalBase64 = (value) => {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
        throw new Error('Şifreli veri biçimi geçersiz.');
    }
    return decoded;
};
export const hashPassword = (password) => argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
});
export const verifyPassword = (hash, password) => argon2.verify(hash, password);
export const createOpaqueToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const hashToken = (token) => createHash('sha256').update(token, 'utf8').digest('hex');
export const tokenHashesMatch = (plainToken, storedHash) => {
    const candidate = Buffer.from(hashToken(plainToken), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
};
export const encryptValue = (value, aad) => {
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv, {
        authTagLength: GCM_AUTH_TAG_BYTES,
    });
    if (aad !== undefined)
        cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
    };
};
export const decryptValue = (value, aad) => {
    const iv = decodeCanonicalBase64(value.iv);
    const authTag = decodeCanonicalBase64(value.authTag);
    const ciphertext = decodeCanonicalBase64(value.ciphertext);
    if (iv.length !== GCM_IV_BYTES || authTag.length !== GCM_AUTH_TAG_BYTES) {
        throw new Error('Şifreli veri biçimi geçersiz.');
    }
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv, {
        authTagLength: GCM_AUTH_TAG_BYTES,
    });
    if (aad !== undefined)
        decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};
