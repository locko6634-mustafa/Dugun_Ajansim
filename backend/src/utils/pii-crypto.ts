import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { z } from 'zod';
import {
  env,
  parseDataEncryptionKeyring,
  parsePiiBlindIndexKeyring,
} from '../config/env.config.js';
import { normalizePhone } from './domain.js';

export const PII_ENCRYPTION_VERSION = 3;
export const PII_BLIND_INDEX_VERSION = 1;
export const BOOKING_APPLICATION_PII_SCHEMA_VERSION = 2;
export const WEDDING_PII_SCHEMA_VERSION = 1;
export const MESSAGE_TASK_PII_SCHEMA_VERSION = 1;
export const STAFF_PII_SCHEMA_VERSION = 1;

const GCM_IV_BYTES = 12;
const GCM_AUTH_TAG_BYTES = 16;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const HEX_32_BYTE_PATTERN = /^[a-fA-F0-9]{64}$/;

export type PiiEncryptionMode = 'dual' | 'encrypted' | 'strict';
export type PiiModel = 'BookingApplication' | 'Wedding' | 'MessageTask' | 'Staff';
export type BlindIndexContext =
  | 'BookingApplication.primaryEmail'
  | 'BookingApplication.bridePhone'
  | 'BookingApplication.groomPhone'
  | 'Wedding.primaryEmail'
  | 'Wedding.bridePhone'
  | 'Wedding.groomPhone'
  | 'MessageTask.recipientPhone'
  | 'Staff.phone';

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
    customVenueName: z.string().trim().min(1).max(160).nullable().default(null),
  })
  .strict();

export const weddingPiiSchema = bookingApplicationPiiSchema
  .omit({ rejectionReason: true, customVenueName: true })
  .strict();
export const messageTaskPiiSchema = z.object({ recipientPhone: phoneSchema }).strict();
export const staffPiiSchema = z
  .object({ firstName: personNameSchema, lastName: personNameSchema, phone: phoneSchema })
  .strict();

export type BookingApplicationPii = z.infer<typeof bookingApplicationPiiSchema>;
export type WeddingPii = z.infer<typeof weddingPiiSchema>;
export type MessageTaskPii = z.infer<typeof messageTaskPiiSchema>;
export type StaffPii = z.infer<typeof staffPiiSchema>;
type NullablePayloadFields<Payload extends object> = {
  [Key in keyof Payload]?: Payload[Key] | null;
};

type PiiCryptographyConfig = {
  activeKeyId: string;
  keyring: Record<string, string>;
  blindIndexKey?: string;
  blindIndexActiveKeyId?: string;
  blindIndexKeyring?: Record<string, string>;
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

export const assertPiiWriteAllowed = (
  environment: Pick<
    typeof env,
    'NODE_ENV' | 'ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES'
  > = env,
): void => {
  if (
    environment.NODE_ENV !== 'production' &&
    !environment.ALLOW_NON_PRODUCTION_SYNTHETIC_PII_WRITES
  ) {
    throw new Error(
      'Production dışı ortamda PII yazımı kapalıdır. Yalnız sentetik veri için açık opt-in gerekir.',
    );
  }
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
  if (!KEY_ID_PATTERN.test(config.activeKeyId)) {
    throw new Error('PII keyring yapılandırması geçersiz.');
  }

  const encryptionKeys = new Map<string, Buffer>();
  for (const [keyId, rawKey] of Object.entries(config.keyring)) {
    if (!KEY_ID_PATTERN.test(keyId) || !HEX_32_BYTE_PATTERN.test(rawKey)) {
      throw new Error('PII keyring yapılandırması geçersiz.');
    }
    encryptionKeys.set(keyId, Buffer.from(rawKey, 'hex'));
  }
  if (!encryptionKeys.has(config.activeKeyId)) {
    throw new Error('Aktif PII encryption key keyring içinde bulunamadı.');
  }
  const blindIndexKeyring: Record<string, string> =
    config.blindIndexKeyring ??
    (config.blindIndexKey
      ? { legacy: config.blindIndexKey }
      : (Object.create(null) as Record<string, string>));
  const blindIndexKeyId = config.blindIndexActiveKeyId ?? 'legacy';
  const blindIndexEntries = Object.entries(blindIndexKeyring);
  if (
    !KEY_ID_PATTERN.test(blindIndexKeyId) ||
    blindIndexEntries.length < 1 ||
    blindIndexEntries.length > 8
  ) {
    throw new Error('PII blind-index keyring yapılandırması geçersiz.');
  }
  const encryptionMaterials = new Set(
    Object.values(config.keyring).map((rawKey) => rawKey.toLowerCase()),
  );
  const blindIndexKeys = new Map<string, Buffer>();
  const blindIndexMaterials = new Set<string>();
  for (const [keyId, rawKey] of blindIndexEntries) {
    const normalizedKey = rawKey.toLowerCase();
    if (
      !KEY_ID_PATTERN.test(keyId) ||
      !HEX_32_BYTE_PATTERN.test(rawKey) ||
      blindIndexMaterials.has(normalizedKey) ||
      encryptionMaterials.has(normalizedKey)
    ) {
      throw new Error('PII blind-index anahtarları benzersiz ve encryption keylerden ayrı olmalıdır.');
    }
    blindIndexMaterials.add(normalizedKey);
    blindIndexKeys.set(keyId, Buffer.from(rawKey, 'hex'));
  }
  if (!blindIndexKeys.has(blindIndexKeyId)) {
    throw new Error('Aktif PII blind-index anahtarı keyring içinde bulunamadı.');
  }

  const encryptPayload = (
    model: PiiModel,
    recordId: string,
    schemaVersion: number,
    payload: unknown,
  ): PiiEnvelope => {
    assertPiiWriteAllowed();
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
    keyId = blindIndexKeyId,
  ): string => {
    const key = blindIndexKeys.get(keyId);
    if (!key) throw new Error('PII blind-index anahtarı bulunamadı.');
    return createHmac('sha256', key)
      .update(`dugun-ajansim:blind:v1:${context}\0${normalizeBlindIndexValue(value, kind)}`, 'utf8')
      .digest('hex');
  };

  const blindIndexCandidates = (
    context: BlindIndexContext,
    value: string,
    kind: 'email' | 'phone',
  ) =>
    [...blindIndexKeys.keys()].map((keyId) => ({
      keyId,
      version: PII_BLIND_INDEX_VERSION,
      value: blindIndex(context, value, kind, keyId),
    }));

  return Object.freeze({
    encryptPayload,
    decryptPayload,
    blindIndex,
    blindIndexCandidates,
    blindIndexKeyId,
    blindIndexVersion: PII_BLIND_INDEX_VERSION,
  });
};

export type PiiCryptography = ReturnType<typeof createPiiCryptography>;

export const piiCryptography = createPiiCryptography({
  activeKeyId: env.DATA_ENCRYPTION_ACTIVE_KEY_ID,
  keyring: parseDataEncryptionKeyring(env.DATA_ENCRYPTION_KEYRING_JSON),
  blindIndexActiveKeyId: env.PII_BLIND_INDEX_ACTIVE_KEY_ID,
  blindIndexKeyring: parsePiiBlindIndexKeyring(env.PII_BLIND_INDEX_KEYRING_JSON),
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
    piiBlindIndexKeyId: cryptography.blindIndexKeyId,
    piiBlindIndexVersion: cryptography.blindIndexVersion,
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
    customVenueName: null,
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
    piiBlindIndexKeyId: cryptography.blindIndexKeyId,
    piiBlindIndexVersion: cryptography.blindIndexVersion,
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
    piiBlindIndexKeyId: cryptography.blindIndexKeyId,
    piiBlindIndexVersion: cryptography.blindIndexVersion,
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

export const encryptStaffPii = (
  recordId: string,
  input: unknown,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = staffPiiSchema.parse(input);
  return {
    ...cryptography.encryptPayload('Staff', recordId, STAFF_PII_SCHEMA_VERSION, payload),
    phoneBlindIndex: cryptography.blindIndex('Staff.phone', payload.phone, 'phone'),
    piiBlindIndexKeyId: cryptography.blindIndexKeyId,
    piiBlindIndexVersion: cryptography.blindIndexVersion,
  };
};

export const decryptStaffPii = (
  recordId: string,
  source: NullablePiiEnvelope & NullablePayloadFields<StaffPii>,
  cryptography: PiiCryptography = piiCryptography,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): StaffPii => {
  const envelope = envelopeOrNull(source);
  if (envelope) {
    return staffPiiSchema.parse(cryptography.decryptPayload('Staff', recordId, envelope));
  }
  if (mode === 'strict') throw new Error('Şifreli personel PII payload bulunamadı.');
  return staffPiiSchema.parse({
    firstName: source.firstName,
    lastName: source.lastName,
    phone: source.phone,
  });
};

type LegacyPiiString = string | null | undefined;

const normalizeLegacyText = (value: string): string => value.normalize('NFKC').trim();
const normalizeLegacyEmail = (value: string): string => normalizeLegacyText(value).toLowerCase();
const normalizeLegacyPhone = (value: string): string => normalizePhone(normalizeLegacyText(value));

const legacyValueMatches = (
  legacyValue: LegacyPiiString,
  encryptedValue: LegacyPiiString,
  normalize: (value: string) => string = normalizeLegacyText,
): boolean =>
  legacyValue == null ||
  (encryptedValue != null && normalize(legacyValue) === normalize(encryptedValue));

export const bookingApplicationLegacyPiiMatches = (
  source: NullablePayloadFields<BookingApplicationPii>,
  payload: BookingApplicationPii,
): boolean =>
  legacyValueMatches(source.brideFirstName, payload.brideFirstName) &&
  legacyValueMatches(source.brideLastName, payload.brideLastName) &&
  legacyValueMatches(source.bridePhone, payload.bridePhone, normalizeLegacyPhone) &&
  legacyValueMatches(source.groomFirstName, payload.groomFirstName) &&
  legacyValueMatches(source.groomLastName, payload.groomLastName) &&
  legacyValueMatches(source.groomPhone, payload.groomPhone, normalizeLegacyPhone) &&
  legacyValueMatches(source.primaryEmail, payload.primaryEmail, normalizeLegacyEmail) &&
  legacyValueMatches(source.note, payload.note) &&
  legacyValueMatches(source.rejectionReason, payload.rejectionReason);

export const weddingLegacyPiiMatches = (
  source: NullablePayloadFields<WeddingPii>,
  payload: WeddingPii,
): boolean =>
  legacyValueMatches(source.brideFirstName, payload.brideFirstName) &&
  legacyValueMatches(source.brideLastName, payload.brideLastName) &&
  legacyValueMatches(source.bridePhone, payload.bridePhone, normalizeLegacyPhone) &&
  legacyValueMatches(source.groomFirstName, payload.groomFirstName) &&
  legacyValueMatches(source.groomLastName, payload.groomLastName) &&
  legacyValueMatches(source.groomPhone, payload.groomPhone, normalizeLegacyPhone) &&
  legacyValueMatches(source.primaryEmail, payload.primaryEmail, normalizeLegacyEmail) &&
  legacyValueMatches(source.note, payload.note);

export const messageTaskLegacyPiiMatches = (
  source: NullablePayloadFields<MessageTaskPii>,
  payload: MessageTaskPii,
): boolean => legacyValueMatches(source.recipientPhone, payload.recipientPhone, normalizeLegacyPhone);

export const staffLegacyPiiMatches = (
  source: NullablePayloadFields<StaffPii>,
  payload: StaffPii,
): boolean =>
  legacyValueMatches(source.firstName, payload.firstName) &&
  legacyValueMatches(source.lastName, payload.lastName) &&
  legacyValueMatches(source.phone, payload.phone, normalizeLegacyPhone);

export const legacyPiiValue = <Value>(
  value: Value,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): Value | null => (mode === 'encrypted' ? null : value);

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

export const buildStaffPiiData = (
  recordId: string,
  input: unknown,
  piiRevision: number,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
  cryptography: PiiCryptography = piiCryptography,
) => {
  const payload = staffPiiSchema.parse(input);
  return {
    firstName: legacyPiiValue(payload.firstName, mode),
    lastName: legacyPiiValue(payload.lastName, mode),
    phone: legacyPiiValue(payload.phone, mode),
    ...encryptStaffPii(recordId, payload, cryptography),
    piiRevision,
  };
};

type EnvelopePersistenceKey =
  | keyof NullablePiiEnvelope
  | 'piiRevision'
  | 'primaryEmailBlindIndex'
  | 'bridePhoneBlindIndex'
  | 'groomPhoneBlindIndex'
  | 'recipientPhoneBlindIndex'
  | 'phoneBlindIndex'
  | 'piiBlindIndexKeyId'
  | 'piiBlindIndexVersion';

export type DecryptedBookingApplication<Row> = Omit<
  Row,
  EnvelopePersistenceKey | keyof BookingApplicationPii
> &
  BookingApplicationPii;
export type DecryptedWedding<Row> = Omit<Row, EnvelopePersistenceKey | keyof WeddingPii> & WeddingPii;
export type DecryptedMessageTask<Row> = Omit<Row, EnvelopePersistenceKey | keyof MessageTaskPii> &
  MessageTaskPii;
type StaffPhotoPersistenceKey = 'photoStorageKey' | 'photoUpdatedAt';
export type DecryptedStaff<Row> = Omit<
  Row,
  EnvelopePersistenceKey | StaffPhotoPersistenceKey | keyof StaffPii
> &
  StaffPii;

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
    phoneBlindIndex: _phoneBlindIndex,
    piiBlindIndexKeyId: _blindIndexKeyId,
    piiBlindIndexVersion: _blindIndexVersion,
    idempotencyKey: _idempotencyKey,
    idempotencyFingerprint: _idempotencyFingerprint,
    idempotencyFingerprintHmac: _idempotencyFingerprintHmac,
    idempotencyFingerprintKeyId: _idempotencyFingerprintKeyId,
    idempotencyFingerprintVersion: _idempotencyFingerprintVersion,
    paymentFlowTokenHash: _paymentFlowTokenHash,
    ...safe
  } = source;
  return safe;
};

export const bookingApplicationWithDecryptedPii = <
  Row extends NullablePiiEnvelope & NullablePayloadFields<BookingApplicationPii> & { id: string },
>(
  row: Row,
  cryptography: PiiCryptography = piiCryptography,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): DecryptedBookingApplication<Row> => {
  const pii = decryptBookingApplicationPii(row.id, row, cryptography, mode);
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

export const staffWithDecryptedPii = <
  Row extends NullablePiiEnvelope &
    NullablePayloadFields<StaffPii> & {
      id: string;
      photoStorageKey?: string | null;
      photoUpdatedAt?: Date | null;
    },
>(
  row: Row,
  cryptography: PiiCryptography = piiCryptography,
  mode: PiiEncryptionMode = env.PII_ENCRYPTION_MODE,
): DecryptedStaff<Row> => {
  const pii = decryptStaffPii(row.id, row, cryptography, mode);
  const {
    firstName: _firstName,
    lastName: _lastName,
    phone: _phone,
    photoStorageKey: _photoStorageKey,
    photoUpdatedAt: _photoUpdatedAt,
    ...withoutLegacyPii
  } = row;
  return {
    ...stripEnvelopePersistence(withoutLegacyPii),
    ...pii,
  } as DecryptedStaff<Row>;
};
