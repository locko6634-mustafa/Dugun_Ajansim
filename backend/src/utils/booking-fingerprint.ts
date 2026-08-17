import { createHmac, timingSafeEqual } from 'node:crypto';
import { env, parseDataEncryptionKeyring } from '../config/env.config.js';

export const BOOKING_FINGERPRINT_VERSION = 2;

type BookingFingerprintConfig = {
  activeKeyId: string;
  keyring: Record<string, string>;
};

export type BookingFingerprintEnvelope = {
  idempotencyFingerprintHmac: string;
  idempotencyFingerprintKeyId: string;
  idempotencyFingerprintVersion: number;
};

export type BookingFingerprintPayloadInput = {
  source: string;
  eventType?: string;
  brideFirstName: string;
  brideLastName: string;
  bridePhone: string;
  groomFirstName: string;
  groomLastName: string;
  groomPhone: string;
  primaryContact: string;
  primaryEmail: string;
  startsAt: Date;
  endsAt: Date;
  venueId: string | null;
  customVenueName: string | null;
  packageCode: string;
  serviceCodes: string[];
  paymentMethod: string;
  note: string | null;
  privacyConsent: boolean;
  marketingConsent: boolean;
};

export const serializeBookingFingerprintPayload = (
  input: BookingFingerprintPayloadInput,
): string =>
  JSON.stringify({
    source: input.source,
    ...(input.eventType && input.eventType !== 'WEDDING' ? { eventType: input.eventType } : {}),
    brideFirstName: input.brideFirstName,
    brideLastName: input.brideLastName,
    bridePhone: input.bridePhone,
    groomFirstName: input.groomFirstName,
    groomLastName: input.groomLastName,
    groomPhone: input.groomPhone,
    primaryContact: input.primaryContact,
    primaryEmail: input.primaryEmail,
    startsAt: input.startsAt.toISOString(),
    endsAt: input.endsAt.toISOString(),
    venueId: input.venueId,
    customVenueName: input.customVenueName,
    packageCode: input.packageCode,
    serviceCodes: [...input.serviceCodes].sort(),
    paymentMethod: input.paymentMethod,
    note: input.note,
    privacyConsent: input.privacyConsent,
    marketingConsent: input.marketingConsent,
  });

const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX_32_BYTE_PATTERN = /^[a-fA-F0-9]{64}$/;

const deriveFingerprintKey = (rawKey: string): Buffer =>
  createHmac('sha256', Buffer.from(rawKey, 'hex'))
    .update('dugun-ajansim:key-derivation:booking-idempotency:v2', 'utf8')
    .digest();

const digestMatches = (expectedHex: string, candidateHex: string): boolean => {
  if (!HEX_32_BYTE_PATTERN.test(expectedHex) || !HEX_32_BYTE_PATTERN.test(candidateHex)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expectedHex, 'hex'), Buffer.from(candidateHex, 'hex'));
};

export const createBookingFingerprintCryptography = (config: BookingFingerprintConfig) => {
  if (!KEY_ID_PATTERN.test(config.activeKeyId)) {
    throw new Error('Idempotency fingerprint aktif key ID biçimi geçersiz.');
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, rawKey] of Object.entries(config.keyring)) {
    if (!KEY_ID_PATTERN.test(keyId) || !HEX_32_BYTE_PATTERN.test(rawKey)) {
      throw new Error('Idempotency fingerprint keyring yapılandırması geçersiz.');
    }
    keys.set(keyId, deriveFingerprintKey(rawKey));
  }
  if (!keys.has(config.activeKeyId)) {
    throw new Error('Idempotency fingerprint aktif anahtarı keyring içinde bulunamadı.');
  }

  const digest = (canonicalPayload: string, keyId: string): string => {
    const key = keys.get(keyId);
    if (!key) throw new Error('Idempotency fingerprint anahtarı bulunamadı.');
    return createHmac('sha256', key)
      .update(`dugun-ajansim:booking-idempotency:v${BOOKING_FINGERPRINT_VERSION}\0`, 'utf8')
      .update(canonicalPayload, 'utf8')
      .digest('hex');
  };

  const create = (canonicalPayload: string): BookingFingerprintEnvelope => ({
    idempotencyFingerprintHmac: digest(canonicalPayload, config.activeKeyId),
    idempotencyFingerprintKeyId: config.activeKeyId,
    idempotencyFingerprintVersion: BOOKING_FINGERPRINT_VERSION,
  });

  const verify = (
    canonicalPayload: string,
    envelope: {
      idempotencyFingerprintHmac: string | null;
      idempotencyFingerprintKeyId: string | null;
      idempotencyFingerprintVersion: number | null;
    },
  ): boolean => {
    if (
      !envelope.idempotencyFingerprintHmac ||
      !envelope.idempotencyFingerprintKeyId ||
      envelope.idempotencyFingerprintVersion !== BOOKING_FINGERPRINT_VERSION
    ) {
      return false;
    }
    const key = keys.get(envelope.idempotencyFingerprintKeyId);
    if (!key) return false;
    return digestMatches(
      envelope.idempotencyFingerprintHmac,
      digest(canonicalPayload, envelope.idempotencyFingerprintKeyId),
    );
  };

  return Object.freeze({ create, verify, activeKeyId: config.activeKeyId });
};

export const bookingFingerprintCryptography = createBookingFingerprintCryptography({
  activeKeyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
  keyring: parseDataEncryptionKeyring(env.DATA_ENCRYPTION_KEYRING_JSON),
});

export const bookingFingerprintNeedsRepair = (
  canonicalPayload: string | null,
  envelope: {
    idempotencyFingerprintHmac: string | null;
    idempotencyFingerprintKeyId: string | null;
    idempotencyFingerprintVersion: number | null;
  },
  cryptography = bookingFingerprintCryptography,
): boolean =>
  canonicalPayload === null
    ? envelope.idempotencyFingerprintHmac !== null ||
      envelope.idempotencyFingerprintKeyId !== null ||
      envelope.idempotencyFingerprintVersion !== null
    : envelope.idempotencyFingerprintKeyId !== cryptography.activeKeyId ||
      !cryptography.verify(canonicalPayload, envelope);

export const legacyFingerprintMatches = (expected: string | null, candidate: string): boolean =>
  expected !== null && digestMatches(expected, candidate);
