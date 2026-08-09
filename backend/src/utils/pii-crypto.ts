import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';
import { env, parseDataEncryptionKeyring } from '../config/env.config.js';
import { normalizePhone } from './domain.js';

export const PII_ENCRYPTION_VERSION = 3;
export const BOOKING_APPLICATION_PII_SCHEMA_VERSION = 1;
export const WEDDING_PII_SCHEMA_VERSION = 1;
export const MESSAGE_TASK_PII_SCHEMA_VERSION = 1;

const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX_32_BYTE_PATTERN = /^[a-fA-F0-9]{64}$/;

export type PiiEncryptionMode = 'dual' | 'encrypted' | 'strict';
export type PiiModel = 'BookingApplication' | 'Wedding' | 'MessageTask';
export type BlindIndexContext =
  | 'BookingApplication.primaryEmail'
  | 'BookingApplication.bridePhone'
  | 'BookingApplication.groomPhone'
  | 'Wedding.primaryEmail'
  | 'Wedding.bridePhone'
  | 'Wedding.groomPhone'
  | 'MessageTask.recipientPhone';

export type PiiEnvelope = {
  piiCiphertext: string;
  piiIv: string;
  piiAuthTag: string;
  piiKeyId: string;
  piiEncryptionVersion: number;
  piiSchemaVersion: number;
};

export type NullablePiiEnvelope = {
  piiCiphertext: string | null;
  piiIv: string | null;
  piiAuthTag: string | null;
  piiKeyId: string | null;
  piiEncryptionVersion: number | null;
  piiSchemaVersion: number | null;
};

const personNameSchema = z.string().trim().min(1).max(100);
const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{9,14}$/);
const emailSchema = z.string().trim().toLowerCase().email().max(254);
const nullableNoteSchema = z.string().trim().max(2000).nullable();

export const bookingApplicationPiiSchema = z
  .object({
    brideFirstName: personNameSchema,
    brideLastName: personNameSchema,
    bridePhone: phoneSchema,
    groomFirstName: personNameSchema,
    groomLastName: personNameSchema,
    groomPhone: phoneSchema,
    primaryEmail: emailSchema,
    note: nullableNoteSchema,
    rejectionReason: nullableNoteSchema,
  })
  .strict();

export const weddingPiiSchema = bookingApplicationPiiSchema.omit({ rejectionReason: true }).strict();
export const messageTaskPiiSchema = z.object({ recipientPhone: phoneSchema }).strict();

export type BookingApplicationPii = z.infer<typeof bookingApplicationPiiSchema>;
export type WeddingPii = z.infer<typeof weddingPiiSchema>;
export type MessageTaskPii = z.infer<typeof messageTaskPiiSchema>;
type NullablePayloadFields<Payload extends object> = {
  [Key in keyof Payload]?: Payload[Key] | null;
};

type PiiCryptographyConfig = {
  activeKeyId: string;
  keyring: Record<string, string>;
  blindIndexKey: string;
};

const decodeCanonicalBase64 = (value: string): Buffer => {
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new Error('Şifreli PII veri biçimi geçersiz.');
  }
  return decoded;
};

const normalizeBlindIndexValue = (value: string, kind: 'email' | 'phone'): string => {
  const normalized = value.normalize('NFKC').trim();
  if (kind === 'email') return normalized.toLowerCase();
  return normalizePhone(normalized).replace(/\D/g, '');
};

const piiAad = (
  model: PiiModel,
  recordId: string,
  schemaVersion: number,
  keyId: string,
): Buffer => {
  if (!recordId || recordId.includes(':') || !KEY_ID_PATTERN.test(keyId)) {
    throw new Error('PII şifreleme bağlamı geçersiz.');
  }
  return Buffer.from(
    `dugun-ajansim:pii:aes-256-gcm:v${PII_ENCRYPTION_VERSION}:${model}:${recordId}:piiPayload:${schemaVersion}:${keyId}`,
    'utf8',
  );
};

export const createPiiCryptography = (config: PiiCryptographyConfig) => {
  if (!KEY_ID_PATTERN.test(config.activeKeyId) || !HEX_32_BYTE_PATTERN.test(config.blindIndexKey)) {
    throw new Error('PII keyring yapılandırması geçersiz.');
  }

  const encryptionKeys = new Map<string, Buffer>();
  const normalizedBlindIndexKey = config.blindIndexKey.toLowerCase();
  for (const [keyId, rawKey] of Object.entries(config.keyring)) {
    if (!KEY_ID_PATTERN.test(keyId) || !HEX_32_BYTE_PATTERN.test(rawKey)) {
      throw new Error('PII keyring yapılandırması geçersiz.');
    }
    if (rawKey.toLowerCase() === normalizedBlindIndexKey) {
      throw new Error('PII blind-index anahtarı encryption key anahtarından ayrı olmalıdır.');
    }
    encryptionKeys.set(keyId, Buffer.from(rawKey, 'hex'));
  }
  if (!encryptionKeys.has(config.activeKeyId)) {
    throw new Error('Aktif PII encryption key keyring içinde bulunamadı.');
  }
  const blindIndexKey = Buffer.from(config.blindIndexKey, 'hex');

  const encryptPayload = (
    model: PiiModel,
    recordId: string,
    schemaVersion: number,
    payload: unknown,
  ): PiiEnvelope => {
    const keyId = config.activeKeyId;
    const encryptionKey = encryptionKeys.get(keyId)!;
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv, {
      authTagLength: GCM_AUTH_TAG_BYTES,
    });
    cipher.setAAD(piiAad(model, recordId, schemaVersion, keyId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return {
      piiCiphertext: ciphertext.toString('base64'),
      piiIv: iv.toString('base64'),
      piiAuthTag: cipher.getAuthTag().toString('base64'),
      piiKeyId: keyId,
      piiEncryptionVersion: PII_ENCRYPTION_VERSION,
      piiSchemaVersion: schemaVersion,
    };
  };

  const decryptPayload = (
    model: PiiModel,
    recordId: string,
    envelope: PiiEnvelope,
  ): unknown => {
    if (envelope.piiEncryptionVersion !== PII_ENCRYPTION_VERSION) {
      throw new Error('Desteklenmeyen PII encryption sürümü.');
    }
    const encryptionKey = encryptionKeys.get(envelope.piiKeyId);
    if (!encryptionKey) throw new Error('PII encryption key bulunamadı.');
    const iv = decodeCanonicalBase64(envelope.piiIv);
    const authTag = decodeCanonicalBase64(envelope.piiAuthTag);
    const ciphertext = decodeCanonicalBase64(envelope.piiCiphertext);
    if (iv.length !== GCM_IV_BYTES || authTag.length !== GCM_AUTH_TAG_BYTES) {
      throw new Error('Şifreli PII veri biçimi geçersiz.');
    }

    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, iv, {
      authTagLength: GCM_AUTH_TAG_BYTES,
    });
    decipher.setAAD(
      piiAad(model, recordId, envelope.piiSchemaVersion, envelope.piiKeyId),
    );
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext) as unknown;
  };

  const blindIndex = (
    context: BlindIndexContext,
    value: string,
    kind: 'email' | 'phone',
  ): string =>
    createHmac('sha256', blindIndexKey)
      .update(`dugun-ajansim:blind:v1:${context}\0${normalizeBlindIndexValue(value, kind)}`, 'utf8')
      .digest('hex');

  return Object.freeze({ encryptPayload, decryptPayload, blindIndex });
};

export type PiiCryptography = ReturnType<typeof createPiiCryptography>;

export const piiCryptography = createPiiCryptography({
  activeKeyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
  keyring: parseDataEncryptionKeyring(env.DATA_ENCRYPTION_KEYRING_JSON),
  blindIndexKey: env.PII_BLIND_INDEX_KEY,
});

const envelopeOrNull = (source: NullablePiiEnvelope): PiiEnvelope | null => {
  const parts = [
    source.piiCiphertext,
    source.piiIv,
    source.piiAuthTag,
    source.piiKeyId,
    source.piiEncryptionVersion,
    source.piiSchemaVersion,
  ];
  if (parts.every((part) => part === null)) return null;
  if (parts.some((part) => part === null)) throw new Error('Şifreli PII zarfı eksik.');
  return source as PiiEnvelope;
};

export const encryptBookingApplicationPii = (
  recordId: string,
  input: unknown,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = bookingApplicationPiiSchema.parse(input);
  return {
    ...cryptography.encryptPayload(
      'BookingApplication',
      recordId,
      BOOKING_APPLICATION_PII_SCHEMA_VERSION,
      payload,
    ),
    primaryEmailBlindIndex: cryptography.blindIndex(
      'BookingApplication.primaryEmail',
      payload.primaryEmail,
      'email',
    ),
    bridePhoneBlindIndex: cryptography.blindIndex(
      'BookingApplication.bridePhone',
      payload.bridePhone,
      'phone',
    ),
    groomPhoneBlindIndex: cryptography.blindIndex(
      'BookingApplication.groomPhone',
      payload.groomPhone,
      'phone',
    ),
  };
};

export const decryptBookingApplicationPii = (
  recordId: string,
  source: NullablePiiEnvelope & NullablePayloadFields<BookingApplicationPii>,
  cryptography: PiiCryptography = piiCryptography,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): BookingApplicationPii => {
  const envelope = envelopeOrNull(source);
  if (envelope) {
    return bookingApplicationPiiSchema.parse(
      cryptography.decryptPayload('BookingApplication', recordId, envelope),
    );
  }
  if (mode === 'strict') throw new Error('Şifreli başvuru PII payload bulunamadı.');
  return bookingApplicationPiiSchema.parse({
    brideFirstName: source.brideFirstName,
    brideLastName: source.brideLastName,
    bridePhone: source.bridePhone,
    groomFirstName: source.groomFirstName,
    groomLastName: source.groomLastName,
    groomPhone: source.groomPhone,
    primaryEmail: source.primaryEmail,
    note: source.note ?? null,
    rejectionReason: source.rejectionReason ?? null,
  });
};

export const encryptWeddingPii = (
  recordId: string,
  input: unknown,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = weddingPiiSchema.parse(input);
  return {
    ...cryptography.encryptPayload('Wedding', recordId, WEDDING_PII_SCHEMA_VERSION, payload),
    primaryEmailBlindIndex: cryptography.blindIndex(
      'Wedding.primaryEmail',
      payload.primaryEmail,
      'email',
    ),
    bridePhoneBlindIndex: cryptography.blindIndex(
      'Wedding.bridePhone',
      payload.bridePhone,
      'phone',
    ),
    groomPhoneBlindIndex: cryptography.blindIndex(
      'Wedding.groomPhone',
      payload.groomPhone,
      'phone',
    ),
  };
};

export const decryptWeddingPii = (
  recordId: string,
  source: NullablePiiEnvelope & NullablePayloadFields<WeddingPii>,
  cryptography: PiiCryptography = piiCryptography,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): WeddingPii => {
  const envelope = envelopeOrNull(source);
  if (envelope) {
    return weddingPiiSchema.parse(cryptography.decryptPayload('Wedding', recordId, envelope));
  }
  if (mode === 'strict') throw new Error('Şifreli düğün PII payload bulunamadı.');
  return weddingPiiSchema.parse({
    brideFirstName: source.brideFirstName,
    brideLastName: source.brideLastName,
    bridePhone: source.bridePhone,
    groomFirstName: source.groomFirstName,
    groomLastName: source.groomLastName,
    groomPhone: source.groomPhone,
    primaryEmail: source.primaryEmail,
    note: source.note ?? null,
  });
};

export const encryptMessageTaskPii = (
  recordId: string,
  input: unknown,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = messageTaskPiiSchema.parse(input);
  return {
    ...cryptography.encryptPayload(
      'MessageTask',
      recordId,
      MESSAGE_TASK_PII_SCHEMA_VERSION,
      payload,
    ),
    recipientPhoneBlindIndex: cryptography.blindIndex(
      'MessageTask.recipientPhone',
      payload.recipientPhone,
      'phone',
    ),
  };
};

export const decryptMessageTaskPii = (
  recordId: string,
  source: NullablePiiEnvelope & NullablePayloadFields<MessageTaskPii>,
  cryptography: PiiCryptography = piiCryptography,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): MessageTaskPii => {
  const envelope = envelopeOrNull(source);
  if (envelope) {
    return messageTaskPiiSchema.parse(
      cryptography.decryptPayload('MessageTask', recordId, envelope),
    );
  }
  if (mode === 'strict') throw new Error('Şifreli mesaj PII payload bulunamadı.');
  return messageTaskPiiSchema.parse({ recipientPhone: source.recipientPhone });
};

export const legacyPiiValue = <Value>(
  value: Value,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): Value | null => (mode === 'dual' ? value : null);

export const buildBookingApplicationPiiData = (
  recordId: string,
  input: unknown,
  piiRevision: number,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = bookingApplicationPiiSchema.parse(input);
  return {
    brideFirstName: legacyPiiValue(payload.brideFirstName, mode),
    brideLastName: legacyPiiValue(payload.brideLastName, mode),
    bridePhone: legacyPiiValue(payload.bridePhone, mode),
    groomFirstName: legacyPiiValue(payload.groomFirstName, mode),
    groomLastName: legacyPiiValue(payload.groomLastName, mode),
    groomPhone: legacyPiiValue(payload.groomPhone, mode),
    primaryEmail: legacyPiiValue(payload.primaryEmail, mode),
    note: legacyPiiValue(payload.note, mode),
    rejectionReason: legacyPiiValue(payload.rejectionReason, mode),
    ...encryptBookingApplicationPii(recordId, payload, cryptography),
    piiRevision,
  };
};

export const buildWeddingPiiData = (
  recordId: string,
  input: unknown,
  piiRevision: number,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = weddingPiiSchema.parse(input);
  return {
    brideFirstName: legacyPiiValue(payload.brideFirstName, mode),
    brideLastName: legacyPiiValue(payload.brideLastName, mode),
    bridePhone: legacyPiiValue(payload.bridePhone, mode),
    groomFirstName: legacyPiiValue(payload.groomFirstName, mode),
    groomLastName: legacyPiiValue(payload.groomLastName, mode),
    groomPhone: legacyPiiValue(payload.groomPhone, mode),
    primaryEmail: legacyPiiValue(payload.primaryEmail, mode),
    note: legacyPiiValue(payload.note, mode),
    ...encryptWeddingPii(recordId, payload, cryptography),
    piiRevision,
  };
};

export const buildMessageTaskPiiData = (
  recordId: string,
  input: unknown,
  piiRevision: number,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = messageTaskPiiSchema.parse(input);
  return {
    recipientPhone: legacyPiiValue(payload.recipientPhone, mode),
    ...encryptMessageTaskPii(recordId, payload, cryptography),
    piiRevision,
  };
};

type EnvelopePersistenceKey =
  | keyof NullablePiiEnvelope
  | 'piiRevision'
  | 'primaryEmailBlindIndex'
  | 'bridePhoneBlindIndex'
  | 'groomPhoneBlindIndex'
  | 'recipientPhoneBlindIndex';

export type DecryptedBookingApplication<Row> = Omit<
  Row,
  EnvelopePersistenceKey | keyof BookingApplicationPii
> &
  BookingApplicationPii;
export type DecryptedWedding<Row> = Omit<Row, EnvelopePersistenceKey | keyof WeddingPii> & WeddingPii;
export type DecryptedMessageTask<Row> = Omit<Row, EnvelopePersistenceKey | keyof MessageTaskPii> &
  MessageTaskPii;

const stripEnvelopePersistence = (source: Record<string, unknown>): Record<string, unknown> => {
  const {
    piiCiphertext: _ciphertext,
    piiIv: _iv,
    piiAuthTag: _authTag,
    piiKeyId: _keyId,
    piiEncryptionVersion: _encryptionVersion,
    piiSchemaVersion: _schemaVersion,
    piiRevision: _revision,
    primaryEmailBlindIndex: _emailBlindIndex,
    bridePhoneBlindIndex: _bridePhoneBlindIndex,
    groomPhoneBlindIndex: _groomPhoneBlindIndex,
    recipientPhoneBlindIndex: _recipientPhoneBlindIndex,
    ...safe
  } = source;
  return safe;
};

export const bookingApplicationWithDecryptedPii = <
  Row extends NullablePiiEnvelope & NullablePayloadFields<BookingApplicationPii> & { id: string },
>(row: Row): DecryptedBookingApplication<Row> => {
  const pii = decryptBookingApplicationPii(row.id, row);
  const {
    brideFirstName: _brideFirstName,
    brideLastName: _brideLastName,
    bridePhone: _bridePhone,
    groomFirstName: _groomFirstName,
    groomLastName: _groomLastName,
    groomPhone: _groomPhone,
    primaryEmail: _primaryEmail,
    note: _note,
    rejectionReason: _rejectionReason,
    ...withoutLegacyPii
  } = row;
  return {
    ...stripEnvelopePersistence(withoutLegacyPii),
    ...pii,
  } as DecryptedBookingApplication<Row>;
};

export const weddingWithDecryptedPii = <
  Row extends NullablePiiEnvelope & NullablePayloadFields<WeddingPii> & { id: string },
>(row: Row): DecryptedWedding<Row> => {
  const pii = decryptWeddingPii(row.id, row);
  const {
    brideFirstName: _brideFirstName,
    brideLastName: _brideLastName,
    bridePhone: _bridePhone,
    groomFirstName: _groomFirstName,
    groomLastName: _groomLastName,
    groomPhone: _groomPhone,
    primaryEmail: _primaryEmail,
    note: _note,
    ...withoutLegacyPii
  } = row;
  return {
    ...stripEnvelopePersistence(withoutLegacyPii),
    ...pii,
  } as DecryptedWedding<Row>;
};

export const messageTaskWithDecryptedPii = <
  Row extends NullablePiiEnvelope & NullablePayloadFields<MessageTaskPii> & { id: string },
>(row: Row): DecryptedMessageTask<Row> => {
  const pii = decryptMessageTaskPii(row.id, row);
  const { recipientPhone: _recipientPhone, ...withoutLegacyPii } = row;
  return {
    ...stripEnvelopePersistence(withoutLegacyPii),
    ...pii,
  } as DecryptedMessageTask<Row>;
};
