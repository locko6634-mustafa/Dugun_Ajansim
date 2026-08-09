import { env } from '../config/env.config.js';
import { prisma } from '../config/prisma.js';
import {
  buildBookingApplicationPiiData,
  buildMessageTaskPiiData,
  buildWeddingPiiData,
  decryptBookingApplicationPii,
  decryptMessageTaskPii,
  decryptWeddingPii,
  piiCryptography,
  type NullablePiiEnvelope,
} from '../utils/pii-crypto.js';

const DEFAULT_BATCH_SIZE = 75;
const MIN_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

type EnvelopeRow = NullablePiiEnvelope & {
  id: string;
  piiRevision: number;
};

type BookingRow = EnvelopeRow & {
  brideFirstName: string | null;
  brideLastName: string | null;
  bridePhone: string | null;
  groomFirstName: string | null;
  groomLastName: string | null;
  groomPhone: string | null;
  primaryEmail: string | null;
  note: string | null;
  rejectionReason: string | null;
  primaryEmailBlindIndex: string | null;
  bridePhoneBlindIndex: string | null;
  groomPhoneBlindIndex: string | null;
};

type WeddingRow = Omit<BookingRow, 'rejectionReason'>;
type MessageRow = EnvelopeRow & {
  recipientPhone: string | null;
  recipientPhoneBlindIndex: string | null;
};

type Verification = {
  total: number;
  missingEnvelope: number;
  invalidEnvelope: number;
  blindIndexMismatch: number;
  inactiveKey: number;
  legacyPlaintext: number;
};

const emptyVerification = (): Verification => ({
  total: 0,
  missingEnvelope: 0,
  invalidEnvelope: 0,
  blindIndexMismatch: 0,
  inactiveKey: 0,
  legacyPlaintext: 0,
});

const parseBatchSize = (): number => {
  const argument = process.argv.find((value) => value.startsWith('--batch-size='));
  if (!argument) return DEFAULT_BATCH_SIZE;
  const value = Number(argument.slice('--batch-size='.length));
  if (!Number.isInteger(value) || value < MIN_BATCH_SIZE || value > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size ${MIN_BATCH_SIZE}-${MAX_BATCH_SIZE} arasında olmalıdır.`);
  }
  return value;
};

const hasBookingLegacyPlaintext = (row: BookingRow | WeddingRow): boolean =>
  [
    row.brideFirstName,
    row.brideLastName,
    row.bridePhone,
    row.groomFirstName,
    row.groomLastName,
    row.groomPhone,
    row.primaryEmail,
    row.note,
  ].some((value) => value !== null) ||
  ('rejectionReason' in row && row.rejectionReason !== null);

const backfillBookings = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<BookingRow[]>`
      SELECT
        "id", "brideFirstName", "brideLastName", "bridePhone",
        "groomFirstName", "groomLastName", "groomPhone", "primaryEmail",
        "note", "rejectionReason", "piiCiphertext", "piiIv", "piiAuthTag",
        "piiKeyId", "piiEncryptionVersion", "piiSchemaVersion", "piiRevision",
        "primaryEmailBlindIndex", "bridePhoneBlindIndex", "groomPhoneBlindIndex"
      FROM "booking_applications"
      WHERE "piiCiphertext" IS NULL
         OR "piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR "primaryEmailBlindIndex" IS NULL
         OR "bridePhoneBlindIndex" IS NULL
         OR "groomPhoneBlindIndex" IS NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptBookingApplicationPii(row.id, row, piiCryptography, 'dual');
      const mode = row.piiCiphertext === null || hasBookingLegacyPlaintext(row) ? 'dual' : 'encrypted';
      const result = await transaction.bookingApplication.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId,
        },
        data: buildBookingApplicationPiiData(row.id, payload, row.piiRevision + 1, mode),
      });
      updated += result.count;
    }
    return updated;
  });

const backfillWeddings = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<WeddingRow[]>`
      SELECT
        "id", "brideFirstName", "brideLastName", "bridePhone",
        "groomFirstName", "groomLastName", "groomPhone", "primaryEmail", "note",
        "piiCiphertext", "piiIv", "piiAuthTag", "piiKeyId", "piiEncryptionVersion",
        "piiSchemaVersion", "piiRevision", "primaryEmailBlindIndex",
        "bridePhoneBlindIndex", "groomPhoneBlindIndex"
      FROM "weddings"
      WHERE "piiCiphertext" IS NULL
         OR "piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR "primaryEmailBlindIndex" IS NULL
         OR "bridePhoneBlindIndex" IS NULL
         OR "groomPhoneBlindIndex" IS NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptWeddingPii(row.id, row, piiCryptography, 'dual');
      const mode = row.piiCiphertext === null || hasBookingLegacyPlaintext(row) ? 'dual' : 'encrypted';
      const result = await transaction.wedding.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId,
        },
        data: buildWeddingPiiData(row.id, payload, row.piiRevision + 1, mode),
      });
      updated += result.count;
    }
    return updated;
  });

const backfillMessages = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<MessageRow[]>`
      SELECT
        "id", "recipientPhone", "piiCiphertext", "piiIv", "piiAuthTag", "piiKeyId",
        "piiEncryptionVersion", "piiSchemaVersion", "piiRevision", "recipientPhoneBlindIndex"
      FROM "message_tasks"
      WHERE "piiCiphertext" IS NULL
         OR "piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR "recipientPhoneBlindIndex" IS NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptMessageTaskPii(row.id, row, piiCryptography, 'dual');
      const mode = row.piiCiphertext === null || row.recipientPhone !== null ? 'dual' : 'encrypted';
      const result = await transaction.messageTask.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId,
        },
        data: buildMessageTaskPiiData(row.id, payload, row.piiRevision + 1, mode),
      });
      updated += result.count;
    }
    return updated;
  });

const redactBookingLegacy = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<BookingRow[]>`
      SELECT
        "id", "brideFirstName", "brideLastName", "bridePhone",
        "groomFirstName", "groomLastName", "groomPhone", "primaryEmail",
        "note", "rejectionReason", "piiCiphertext", "piiIv", "piiAuthTag",
        "piiKeyId", "piiEncryptionVersion", "piiSchemaVersion", "piiRevision",
        "primaryEmailBlindIndex", "bridePhoneBlindIndex", "groomPhoneBlindIndex"
      FROM "booking_applications"
      WHERE (
        "brideFirstName" IS NOT NULL OR "brideLastName" IS NOT NULL OR
        "bridePhone" IS NOT NULL OR "groomFirstName" IS NOT NULL OR
        "groomLastName" IS NOT NULL OR "groomPhone" IS NOT NULL OR
        "primaryEmail" IS NOT NULL OR "note" IS NOT NULL OR "rejectionReason" IS NOT NULL
      )
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptBookingApplicationPii(row.id, row, piiCryptography, 'strict');
      const result = await transaction.bookingApplication.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: buildBookingApplicationPiiData(row.id, payload, row.piiRevision + 1, 'encrypted'),
      });
      updated += result.count;
    }
    return updated;
  });

const redactWeddingLegacy = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<WeddingRow[]>`
      SELECT
        "id", "brideFirstName", "brideLastName", "bridePhone",
        "groomFirstName", "groomLastName", "groomPhone", "primaryEmail", "note",
        "piiCiphertext", "piiIv", "piiAuthTag", "piiKeyId", "piiEncryptionVersion",
        "piiSchemaVersion", "piiRevision", "primaryEmailBlindIndex",
        "bridePhoneBlindIndex", "groomPhoneBlindIndex"
      FROM "weddings"
      WHERE (
        "brideFirstName" IS NOT NULL OR "brideLastName" IS NOT NULL OR
        "bridePhone" IS NOT NULL OR "groomFirstName" IS NOT NULL OR
        "groomLastName" IS NOT NULL OR "groomPhone" IS NOT NULL OR
        "primaryEmail" IS NOT NULL OR "note" IS NOT NULL
      )
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptWeddingPii(row.id, row, piiCryptography, 'strict');
      const result = await transaction.wedding.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: buildWeddingPiiData(row.id, payload, row.piiRevision + 1, 'encrypted'),
      });
      updated += result.count;
    }
    return updated;
  });

const redactMessageLegacy = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<MessageRow[]>`
      SELECT
        "id", "recipientPhone", "piiCiphertext", "piiIv", "piiAuthTag", "piiKeyId",
        "piiEncryptionVersion", "piiSchemaVersion", "piiRevision", "recipientPhoneBlindIndex"
      FROM "message_tasks"
      WHERE "recipientPhone" IS NOT NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptMessageTaskPii(row.id, row, piiCryptography, 'strict');
      const result = await transaction.messageTask.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: buildMessageTaskPiiData(row.id, payload, row.piiRevision + 1, 'encrypted'),
      });
      updated += result.count;
    }
    return updated;
  });

const verifyBookings = async (): Promise<Verification> => {
  const result = emptyVerification();
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.bookingApplication.findMany({
      orderBy: { id: 'asc' },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, brideFirstName: true, brideLastName: true, bridePhone: true,
        groomFirstName: true, groomLastName: true, groomPhone: true, primaryEmail: true,
        note: true, rejectionReason: true, piiCiphertext: true, piiIv: true, piiAuthTag: true,
        piiKeyId: true, piiEncryptionVersion: true, piiSchemaVersion: true, piiRevision: true,
        primaryEmailBlindIndex: true, bridePhoneBlindIndex: true, groomPhoneBlindIndex: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.total += 1;
      if (hasBookingLegacyPlaintext(row)) result.legacyPlaintext += 1;
      if (!row.piiCiphertext) {
        result.missingEnvelope += 1;
        continue;
      }
      try {
        const payload = decryptBookingApplicationPii(row.id, row, piiCryptography, 'strict');
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (
          row.primaryEmailBlindIndex !== piiCryptography.blindIndex('BookingApplication.primaryEmail', payload.primaryEmail, 'email') ||
          row.bridePhoneBlindIndex !== piiCryptography.blindIndex('BookingApplication.bridePhone', payload.bridePhone, 'phone') ||
          row.groomPhoneBlindIndex !== piiCryptography.blindIndex('BookingApplication.groomPhone', payload.groomPhone, 'phone')
        ) result.blindIndexMismatch += 1;
      } catch {
        result.invalidEnvelope += 1;
      }
    }
    cursor = rows.at(-1)?.id;
  }
  return result;
};

const verifyWeddings = async (): Promise<Verification> => {
  const result = emptyVerification();
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.wedding.findMany({
      orderBy: { id: 'asc' },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, brideFirstName: true, brideLastName: true, bridePhone: true,
        groomFirstName: true, groomLastName: true, groomPhone: true, primaryEmail: true,
        note: true, piiCiphertext: true, piiIv: true, piiAuthTag: true, piiKeyId: true,
        piiEncryptionVersion: true, piiSchemaVersion: true, piiRevision: true,
        primaryEmailBlindIndex: true, bridePhoneBlindIndex: true, groomPhoneBlindIndex: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.total += 1;
      if (hasBookingLegacyPlaintext(row)) result.legacyPlaintext += 1;
      if (!row.piiCiphertext) {
        result.missingEnvelope += 1;
        continue;
      }
      try {
        const payload = decryptWeddingPii(row.id, row, piiCryptography, 'strict');
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (
          row.primaryEmailBlindIndex !== piiCryptography.blindIndex('Wedding.primaryEmail', payload.primaryEmail, 'email') ||
          row.bridePhoneBlindIndex !== piiCryptography.blindIndex('Wedding.bridePhone', payload.bridePhone, 'phone') ||
          row.groomPhoneBlindIndex !== piiCryptography.blindIndex('Wedding.groomPhone', payload.groomPhone, 'phone')
        ) result.blindIndexMismatch += 1;
      } catch {
        result.invalidEnvelope += 1;
      }
    }
    cursor = rows.at(-1)?.id;
  }
  return result;
};

const verifyMessages = async (): Promise<Verification> => {
  const result = emptyVerification();
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.messageTask.findMany({
      orderBy: { id: 'asc' },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, recipientPhone: true, piiCiphertext: true, piiIv: true, piiAuthTag: true,
        piiKeyId: true, piiEncryptionVersion: true, piiSchemaVersion: true, piiRevision: true,
        recipientPhoneBlindIndex: true,
      },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.total += 1;
      if (row.recipientPhone !== null) result.legacyPlaintext += 1;
      if (!row.piiCiphertext) {
        result.missingEnvelope += 1;
        continue;
      }
      try {
        const payload = decryptMessageTaskPii(row.id, row, piiCryptography, 'strict');
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (
          row.recipientPhoneBlindIndex !== piiCryptography.blindIndex('MessageTask.recipientPhone', payload.recipientPhone, 'phone')
        ) result.blindIndexMismatch += 1;
      } catch {
        result.invalidEnvelope += 1;
      }
    }
    cursor = rows.at(-1)?.id;
  }
  return result;
};

const hasVerificationFailure = (value: Verification): boolean =>
  value.missingEnvelope > 0 ||
  value.invalidEnvelope > 0 ||
  value.blindIndexMismatch > 0 ||
  value.inactiveKey > 0 ||
  value.legacyPlaintext > 0;

const main = async () => {
  const operation = process.argv[2];
  if (operation === '--backfill') {
    const batchSize = parseBatchSize();
    const result = {
      bookingApplications: await backfillBookings(batchSize),
      weddings: await backfillWeddings(batchSize),
      messageTasks: await backfillMessages(batchSize),
    };
    console.log(JSON.stringify({ operation: 'backfill', batchSize, updated: result }));
    return;
  }
  if (operation === '--redact-legacy') {
    const batchSize = parseBatchSize();
    const result = {
      bookingApplications: await redactBookingLegacy(batchSize),
      weddings: await redactWeddingLegacy(batchSize),
      messageTasks: await redactMessageLegacy(batchSize),
    };
    console.log(JSON.stringify({ operation: 'redact-legacy', batchSize, updated: result }));
    return;
  }
  if (operation === '--verify') {
    const result = {
      bookingApplications: await verifyBookings(),
      weddings: await verifyWeddings(),
      messageTasks: await verifyMessages(),
    };
    const ready = !Object.values(result).some(hasVerificationFailure);
    console.log(JSON.stringify({ operation: 'verify', ready, models: result }));
    if (!ready) process.exitCode = 2;
    return;
  }
  throw new Error(
    'Kullanım: maintainPiiEncryption.ts --verify | --backfill | --redact-legacy [--batch-size=50..100]',
  );
};

main()
  .catch(() => {
    console.error('PII bakım işlemi başarısız oldu; hassas veri ayrıntıları loglanmadı.');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
