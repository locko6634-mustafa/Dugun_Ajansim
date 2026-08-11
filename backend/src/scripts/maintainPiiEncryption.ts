import { env } from "../config/env.config.js";
import { prisma, runWithRlsContext } from "../config/prisma.js";
import {
  bookingFingerprintCryptography,
  serializeBookingFingerprintPayload
} from "../utils/booking-fingerprint.js";
import {
  buildDeliveryDriveUrlData,
  decryptDeliveryDriveUrl
} from "../utils/delivery-crypto.js";
import {
  BOOKING_APPLICATION_PII_SCHEMA_VERSION,
  bookingApplicationLegacyPiiMatches,
  buildBookingApplicationPiiData,
  buildMessageTaskPiiData,
  buildStaffPiiData,
  buildWeddingPiiData,
  decryptBookingApplicationPii,
  decryptMessageTaskPii,
  decryptStaffPii,
  decryptWeddingPii,
  messageTaskLegacyPiiMatches,
  piiCryptography,
  staffLegacyPiiMatches,
  weddingLegacyPiiMatches,
  type NullablePiiEnvelope
} from "../utils/pii-crypto.js";

const DEFAULT_BATCH_SIZE = 75;
const MIN_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;

type EnvelopeRow = NullablePiiEnvelope & {
  id: string;
  piiRevision: number;
};

type CoupleRow = EnvelopeRow & {
  brideFirstName: string | null;
  brideLastName: string | null;
  bridePhone: string | null;
  groomFirstName: string | null;
  groomLastName: string | null;
  groomPhone: string | null;
  primaryEmail: string | null;
  note: string | null;
  primaryEmailBlindIndex: string | null;
  bridePhoneBlindIndex: string | null;
  groomPhoneBlindIndex: string | null;
  piiBlindIndexKeyId: string | null;
  piiBlindIndexVersion: number | null;
};

type BookingRow = CoupleRow & {
  rejectionReason: string | null;
  idempotencyKey: string | null;
  idempotencyFingerprint: string | null;
  idempotencyFingerprintHmac: string | null;
  idempotencyFingerprintKeyId: string | null;
  idempotencyFingerprintVersion: number | null;
  source: string;
  status: string;
  primaryContact: string;
  weddingStartsAt: Date;
  weddingEndsAt: Date;
  venueId: string | null;
  venueName: string | null;
  venueIsPartner: boolean | null;
  packageCodeSnapshot: string;
  paymentMethod: string;
  privacyConsentAt: Date | null;
  marketingConsentAt: Date | null;
};

type WeddingRow = CoupleRow;
type MessageRow = EnvelopeRow & {
  recipientPhone: string | null;
  recipientPhoneBlindIndex: string | null;
  piiBlindIndexKeyId: string | null;
  piiBlindIndexVersion: number | null;
};
type StaffRow = EnvelopeRow & {
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneBlindIndex: string | null;
  piiBlindIndexKeyId: string | null;
  piiBlindIndexVersion: number | null;
};
type DeliveryRow = {
  id: string;
  driveUrlCiphertext: string | null;
  driveUrlIv: string | null;
  driveUrlAuthTag: string | null;
  driveUrlKeyId: string | null;
  encryptionVersion: number;
};

type Verification = {
  total: number;
  missingEnvelope: number;
  invalidEnvelope: number;
  blindIndexMismatch: number;
  fingerprintMismatch: number;
  inactiveKey: number;
  legacyPlaintext: number;
  legacyMismatch: number;
  privateVenueLinks: number;
  orphanPrivateVenues: number;
};

const emptyVerification = (): Verification => ({
  total: 0,
  missingEnvelope: 0,
  invalidEnvelope: 0,
  blindIndexMismatch: 0,
  fingerprintMismatch: 0,
  inactiveKey: 0,
  legacyPlaintext: 0,
  legacyMismatch: 0,
  privateVenueLinks: 0,
  orphanPrivateVenues: 0
});

const parseBatchSize = (): number => {
  const argument = process.argv.find((value) => value.startsWith("--batch-size="));
  if (!argument) return DEFAULT_BATCH_SIZE;
  const value = Number(argument.slice("--batch-size=".length));
  if (!Number.isInteger(value) || value < MIN_BATCH_SIZE || value > MAX_BATCH_SIZE) {
    throw new Error(`--batch-size ${MIN_BATCH_SIZE}-${MAX_BATCH_SIZE} arasında olmalıdır.`);
  }
  return value;
};

const hasBookingLegacyPlaintext = (
  row: Pick<
    CoupleRow,
    | "brideFirstName"
    | "brideLastName"
    | "bridePhone"
    | "groomFirstName"
    | "groomLastName"
    | "groomPhone"
    | "primaryEmail"
    | "note"
  > & { rejectionReason?: string | null }
): boolean =>
  [
    row.brideFirstName,
    row.brideLastName,
    row.bridePhone,
    row.groomFirstName,
    row.groomLastName,
    row.groomPhone,
    row.primaryEmail,
    row.note
  ].some((value) => value !== null) || row.rejectionReason != null;

const normalizeVenueName = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("tr-TR");

const privateVenueNameMatches = (
  row: Pick<BookingRow, "venueIsPartner" | "venueName">,
  customVenueName: string | null
): boolean =>
  row.venueIsPartner !== false ||
  (row.venueName !== null &&
    customVenueName !== null &&
    normalizeVenueName(row.venueName) === normalizeVenueName(customVenueName));

const backfillBookings = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<BookingRow[]>`
      SELECT
        b."id", b."brideFirstName", b."brideLastName", b."bridePhone",
        b."groomFirstName", b."groomLastName", b."groomPhone", b."primaryEmail",
        b."note", b."rejectionReason", b."piiCiphertext", b."piiIv", b."piiAuthTag",
        b."piiKeyId", b."piiEncryptionVersion", b."piiSchemaVersion", b."piiRevision",
        b."primaryEmailBlindIndex", b."bridePhoneBlindIndex", b."groomPhoneBlindIndex",
        b."piiBlindIndexKeyId", b."piiBlindIndexVersion", b."idempotencyKey",
        b."idempotencyFingerprint", b."idempotencyFingerprintHmac",
        b."idempotencyFingerprintKeyId", b."idempotencyFingerprintVersion",
        b."source"::text AS "source", b."status"::text AS "status",
        b."primaryContact"::text AS "primaryContact", b."weddingStartsAt", b."weddingEndsAt",
        b."venueId", v."name" AS "venueName", v."isPartner" AS "venueIsPartner",
        b."packageCodeSnapshot", b."paymentMethod"::text AS "paymentMethod",
        b."privacyConsentAt", b."marketingConsentAt"
      FROM "booking_applications" b
      LEFT JOIN "venues" v ON v."id" = b."venueId"
      WHERE b."piiCiphertext" IS NULL
         OR b."piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR b."piiSchemaVersion" IS DISTINCT FROM ${BOOKING_APPLICATION_PII_SCHEMA_VERSION}
         OR b."piiBlindIndexKeyId" IS DISTINCT FROM ${piiCryptography.blindIndexKeyId}
         OR b."piiBlindIndexVersion" IS DISTINCT FROM ${piiCryptography.blindIndexVersion}
         OR b."primaryEmailBlindIndex" IS NULL
         OR b."bridePhoneBlindIndex" IS NULL
         OR b."groomPhoneBlindIndex" IS NULL
         OR (
           b."idempotencyKey" IS NULL AND (
             b."idempotencyFingerprintHmac" IS NOT NULL OR
             b."idempotencyFingerprintKeyId" IS NOT NULL OR
             b."idempotencyFingerprintVersion" IS NOT NULL
           )
         )
         OR (
           b."idempotencyKey" IS NOT NULL AND (
             b."idempotencyFingerprintHmac" IS NULL OR
             b."idempotencyFingerprintKeyId" IS DISTINCT FROM ${bookingFingerprintCryptography.activeKeyId} OR
             b."idempotencyFingerprintVersion" IS DISTINCT FROM 2
           )
         )
      ORDER BY b."id"
      LIMIT ${batchSize}
      FOR UPDATE OF b SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const currentPayload = decryptBookingApplicationPii(row.id, row, piiCryptography, "dual");
      if (!bookingApplicationLegacyPiiMatches(row, currentPayload)) {
        throw new Error("BookingApplication legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const payload = {
        ...currentPayload,
        customVenueName:
          currentPayload.customVenueName ??
          (row.venueIsPartner === false ? row.venueName : null)
      };
      if (!privateVenueNameMatches(row, payload.customVenueName)) {
        throw new Error("BookingApplication özel salon adı şifreli PII ile uyuşmuyor.");
      }
      const serviceCodes = (
        await transaction.bookingApplicationService.findMany({
          where: { applicationId: row.id },
          select: { codeSnapshot: true },
          orderBy: { codeSnapshot: "asc" }
        })
      ).map((service) => service.codeSnapshot);
      const fingerprintEnvelope = row.idempotencyKey
        ? bookingFingerprintCryptography.create(
            serializeBookingFingerprintPayload({
              source: row.source,
              brideFirstName: payload.brideFirstName,
              brideLastName: payload.brideLastName,
              bridePhone: payload.bridePhone,
              groomFirstName: payload.groomFirstName,
              groomLastName: payload.groomLastName,
              groomPhone: payload.groomPhone,
              primaryContact: row.primaryContact,
              primaryEmail: payload.primaryEmail,
              startsAt: row.weddingStartsAt,
              endsAt: row.weddingEndsAt,
              venueId: row.venueIsPartner ? row.venueId : null,
              customVenueName: row.venueIsPartner ? null : payload.customVenueName,
              packageCode: row.packageCodeSnapshot,
              serviceCodes,
              paymentMethod: row.paymentMethod,
              note: payload.note,
              privacyConsent: row.privacyConsentAt !== null,
              marketingConsent: row.marketingConsentAt !== null
            })
          )
        : null;
      const mode =
        row.piiCiphertext === null || hasBookingLegacyPlaintext(row) ? "dual" : "encrypted";
      const result = await transaction.bookingApplication.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId
        },
        data: {
          ...buildBookingApplicationPiiData(row.id, payload, row.piiRevision + 1, mode),
          ...(fingerprintEnvelope ?? {
            idempotencyFingerprintHmac: null,
            idempotencyFingerprintKeyId: null,
            idempotencyFingerprintVersion: null
          })
        }
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
        "bridePhoneBlindIndex", "groomPhoneBlindIndex", "piiBlindIndexKeyId",
        "piiBlindIndexVersion"
      FROM "weddings"
      WHERE "piiCiphertext" IS NULL
         OR "piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR "piiBlindIndexKeyId" IS DISTINCT FROM ${piiCryptography.blindIndexKeyId}
         OR "piiBlindIndexVersion" IS DISTINCT FROM ${piiCryptography.blindIndexVersion}
         OR "primaryEmailBlindIndex" IS NULL
         OR "bridePhoneBlindIndex" IS NULL
         OR "groomPhoneBlindIndex" IS NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptWeddingPii(row.id, row, piiCryptography, "dual");
      if (!weddingLegacyPiiMatches(row, payload)) {
        throw new Error("Wedding legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const mode =
        row.piiCiphertext === null || hasBookingLegacyPlaintext(row) ? "dual" : "encrypted";
      const result = await transaction.wedding.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId
        },
        data: buildWeddingPiiData(row.id, payload, row.piiRevision + 1, mode)
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
        "piiEncryptionVersion", "piiSchemaVersion", "piiRevision", "recipientPhoneBlindIndex",
        "piiBlindIndexKeyId", "piiBlindIndexVersion"
      FROM "message_tasks"
      WHERE "piiCiphertext" IS NULL
         OR "piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR "piiBlindIndexKeyId" IS DISTINCT FROM ${piiCryptography.blindIndexKeyId}
         OR "piiBlindIndexVersion" IS DISTINCT FROM ${piiCryptography.blindIndexVersion}
         OR "recipientPhoneBlindIndex" IS NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptMessageTaskPii(row.id, row, piiCryptography, "dual");
      if (!messageTaskLegacyPiiMatches(row, payload)) {
        throw new Error("MessageTask legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const mode = row.piiCiphertext === null || row.recipientPhone !== null ? "dual" : "encrypted";
      const result = await transaction.messageTask.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId
        },
        data: buildMessageTaskPiiData(row.id, payload, row.piiRevision + 1, mode)
      });
      updated += result.count;
    }
    return updated;
  });

const backfillStaff = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<StaffRow[]>`
      SELECT
        "id", "firstName", "lastName", "phone", "piiCiphertext", "piiIv",
        "piiAuthTag", "piiKeyId", "piiEncryptionVersion", "piiSchemaVersion",
        "piiRevision", "phoneBlindIndex", "piiBlindIndexKeyId", "piiBlindIndexVersion"
      FROM "staff"
      WHERE "piiCiphertext" IS NULL
         OR "piiKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
         OR "piiBlindIndexKeyId" IS DISTINCT FROM ${piiCryptography.blindIndexKeyId}
         OR "piiBlindIndexVersion" IS DISTINCT FROM ${piiCryptography.blindIndexVersion}
         OR "phoneBlindIndex" IS NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptStaffPii(row.id, row, piiCryptography, "dual");
      if (!staffLegacyPiiMatches(row, payload)) {
        throw new Error("Staff legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const mode =
        row.piiCiphertext === null ||
        row.firstName !== null ||
        row.lastName !== null ||
        row.phone !== null
          ? "dual"
          : "encrypted";
      const result = await transaction.staff.updateMany({
        where: {
          id: row.id,
          piiRevision: row.piiRevision,
          piiCiphertext: row.piiCiphertext,
          piiKeyId: row.piiKeyId
        },
        data: buildStaffPiiData(row.id, payload, row.piiRevision + 1, mode)
      });
      updated += result.count;
    }
    return updated;
  });

const backfillDeliveries = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<DeliveryRow[]>`
      SELECT "id", "driveUrlCiphertext", "driveUrlIv", "driveUrlAuthTag",
             "driveUrlKeyId", "encryptionVersion"
      FROM "deliveries"
      WHERE "encryptionVersion" IS DISTINCT FROM 2
      OR (
        "driveUrlCiphertext" IS NOT NULL AND (
          "driveUrlKeyId" IS DISTINCT FROM ${env.DATA_ENCRYPTION_ACTIVE_KEY_ID}
        )
      ) OR ("driveUrlCiphertext" IS NULL AND "driveUrlKeyId" IS NOT NULL)
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const driveUrl = decryptDeliveryDriveUrl(row);
      const result = await transaction.delivery.updateMany({
        where: {
          id: row.id,
          driveUrlCiphertext: row.driveUrlCiphertext,
          driveUrlKeyId: row.driveUrlKeyId,
          encryptionVersion: row.encryptionVersion
        },
        data: buildDeliveryDriveUrlData(row.id, driveUrl)
      });
      updated += result.count;
    }
    return updated;
  });

const redactBookingLegacy = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<BookingRow[]>`
      SELECT
        b."id", b."brideFirstName", b."brideLastName", b."bridePhone",
        b."groomFirstName", b."groomLastName", b."groomPhone", b."primaryEmail",
        b."note", b."rejectionReason", b."piiCiphertext", b."piiIv", b."piiAuthTag",
        b."piiKeyId", b."piiEncryptionVersion", b."piiSchemaVersion", b."piiRevision",
        b."primaryEmailBlindIndex", b."bridePhoneBlindIndex", b."groomPhoneBlindIndex",
        b."idempotencyKey", b."idempotencyFingerprint", b."idempotencyFingerprintHmac",
        b."idempotencyFingerprintKeyId", b."idempotencyFingerprintVersion",
        b."status"::text AS "status", b."venueId", v."name" AS "venueName",
        v."isPartner" AS "venueIsPartner", b."source"::text AS "source",
        b."primaryContact"::text AS "primaryContact", b."weddingStartsAt", b."weddingEndsAt",
        b."packageCodeSnapshot", b."paymentMethod"::text AS "paymentMethod",
        b."privacyConsentAt", b."marketingConsentAt"
      FROM "booking_applications" b
      LEFT JOIN "venues" v ON v."id" = b."venueId"
      WHERE (
        b."brideFirstName" IS NOT NULL OR b."brideLastName" IS NOT NULL OR
        b."bridePhone" IS NOT NULL OR b."groomFirstName" IS NOT NULL OR
        b."groomLastName" IS NOT NULL OR b."groomPhone" IS NOT NULL OR
        b."primaryEmail" IS NOT NULL OR b."note" IS NOT NULL OR
        b."rejectionReason" IS NOT NULL OR b."idempotencyFingerprint" IS NOT NULL OR
        (b."venueId" IS NOT NULL AND v."isPartner" = false AND b."status" <> 'ONAYLANDI')
      )
      ORDER BY b."id"
      LIMIT ${batchSize}
      FOR UPDATE OF b SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptBookingApplicationPii(row.id, row, piiCryptography, "strict");
      if (!bookingApplicationLegacyPiiMatches(row, payload)) {
        throw new Error("BookingApplication legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      if (!privateVenueNameMatches(row, payload.customVenueName)) {
        throw new Error("BookingApplication özel salon adı şifreli PII ile uyuşmuyor.");
      }
      if (row.idempotencyKey) {
        const serviceCodes = (
          await transaction.bookingApplicationService.findMany({
            where: { applicationId: row.id },
            select: { codeSnapshot: true },
            orderBy: { codeSnapshot: "asc" }
          })
        ).map((service) => service.codeSnapshot);
        const canonicalPayload = serializeBookingFingerprintPayload({
          source: row.source,
          brideFirstName: payload.brideFirstName,
          brideLastName: payload.brideLastName,
          bridePhone: payload.bridePhone,
          groomFirstName: payload.groomFirstName,
          groomLastName: payload.groomLastName,
          groomPhone: payload.groomPhone,
          primaryContact: row.primaryContact,
          primaryEmail: payload.primaryEmail,
          startsAt: row.weddingStartsAt,
          endsAt: row.weddingEndsAt,
          venueId: row.venueIsPartner ? row.venueId : null,
          customVenueName: row.venueIsPartner ? null : payload.customVenueName,
          packageCode: row.packageCodeSnapshot,
          serviceCodes,
          paymentMethod: row.paymentMethod,
          note: payload.note,
          privacyConsent: row.privacyConsentAt !== null,
          marketingConsent: row.marketingConsentAt !== null
        });
        if (
          row.idempotencyFingerprintKeyId !== bookingFingerprintCryptography.activeKeyId ||
          !bookingFingerprintCryptography.verify(canonicalPayload, row)
        ) {
          throw new Error("Idempotency HMAC doğrulanmadan legacy fingerprint silinemez.");
        }
      } else if (
        row.idempotencyFingerprint !== null ||
        row.idempotencyFingerprintHmac !== null ||
        row.idempotencyFingerprintKeyId !== null ||
        row.idempotencyFingerprintVersion !== null
      ) {
        throw new Error("Anahtarsız idempotency doğrulama verisi silinemez.");
      }
      const detachUnapprovedPrivateVenue =
        row.venueId !== null && row.venueIsPartner === false && row.status !== "ONAYLANDI";
      const result = await transaction.bookingApplication.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: {
          ...buildBookingApplicationPiiData(row.id, payload, row.piiRevision + 1, "encrypted"),
          idempotencyFingerprint: null,
          ...(detachUnapprovedPrivateVenue ? { venueId: null } : {})
        }
      });
      updated += result.count;
      if (result.count === 1 && detachUnapprovedPrivateVenue) {
        await transaction.venue.deleteMany({
          where: {
            id: row.venueId!,
            isPartner: false,
            applications: { none: {} },
            weddings: { none: {} },
            staff: { none: {} },
            managers: { none: {} }
          }
        });
      }
    }
    const orphanPrivateVenues = await transaction.venue.findMany({
      where: {
        isPartner: false,
        applications: { none: {} },
        weddings: { none: {} },
        staff: { none: {} },
        managers: { none: {} }
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize
    });
    if (orphanPrivateVenues.length > 0) {
      const deleted = await transaction.venue.deleteMany({
        where: {
          id: { in: orphanPrivateVenues.map((venue) => venue.id) },
          isPartner: false,
          applications: { none: {} },
          weddings: { none: {} },
          staff: { none: {} },
          managers: { none: {} }
        }
      });
      updated += deleted.count;
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
      const payload = decryptWeddingPii(row.id, row, piiCryptography, "strict");
      if (!weddingLegacyPiiMatches(row, payload)) {
        throw new Error("Wedding legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const result = await transaction.wedding.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: buildWeddingPiiData(row.id, payload, row.piiRevision + 1, "encrypted")
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
      const payload = decryptMessageTaskPii(row.id, row, piiCryptography, "strict");
      if (!messageTaskLegacyPiiMatches(row, payload)) {
        throw new Error("MessageTask legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const result = await transaction.messageTask.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: buildMessageTaskPiiData(row.id, payload, row.piiRevision + 1, "encrypted")
      });
      updated += result.count;
    }
    return updated;
  });

const redactStaffLegacy = (batchSize: number) =>
  prisma.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<StaffRow[]>`
      SELECT
        "id", "firstName", "lastName", "phone", "piiCiphertext", "piiIv",
        "piiAuthTag", "piiKeyId", "piiEncryptionVersion", "piiSchemaVersion",
        "piiRevision", "phoneBlindIndex", "piiBlindIndexKeyId", "piiBlindIndexVersion"
      FROM "staff"
      WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL OR "phone" IS NOT NULL
      ORDER BY "id"
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `;
    let updated = 0;
    for (const row of rows) {
      const payload = decryptStaffPii(row.id, row, piiCryptography, "strict");
      if (!staffLegacyPiiMatches(row, payload)) {
        throw new Error("Staff legacy ve şifreli PII değerleri uyuşmuyor.");
      }
      const result = await transaction.staff.updateMany({
        where: { id: row.id, piiRevision: row.piiRevision, piiCiphertext: row.piiCiphertext },
        data: buildStaffPiiData(row.id, payload, row.piiRevision + 1, "encrypted")
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
      orderBy: { id: "asc" },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        brideFirstName: true,
        brideLastName: true,
        bridePhone: true,
        groomFirstName: true,
        groomLastName: true,
        groomPhone: true,
        primaryEmail: true,
        note: true,
        rejectionReason: true,
        piiCiphertext: true,
        piiIv: true,
        piiAuthTag: true,
        piiKeyId: true,
        piiEncryptionVersion: true,
        piiSchemaVersion: true,
        piiRevision: true,
        primaryEmailBlindIndex: true,
        bridePhoneBlindIndex: true,
        groomPhoneBlindIndex: true,
        piiBlindIndexKeyId: true,
        piiBlindIndexVersion: true,
        idempotencyKey: true,
        idempotencyFingerprint: true,
        idempotencyFingerprintHmac: true,
        idempotencyFingerprintKeyId: true,
        idempotencyFingerprintVersion: true,
        source: true,
        status: true,
        primaryContact: true,
        weddingStartsAt: true,
        weddingEndsAt: true,
        venueId: true,
        venue: { select: { isPartner: true, name: true } },
        packageCodeSnapshot: true,
        paymentMethod: true,
        privacyConsentAt: true,
        marketingConsentAt: true,
        services: { select: { codeSnapshot: true }, orderBy: { codeSnapshot: "asc" } }
      }
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.total += 1;
      if (hasBookingLegacyPlaintext(row) || row.idempotencyFingerprint !== null) {
        result.legacyPlaintext += 1;
      }
      if (row.venueId !== null && row.venue?.isPartner === false && row.status !== "ONAYLANDI") {
        result.privateVenueLinks += 1;
      }
      if (!row.piiCiphertext) {
        result.missingEnvelope += 1;
        continue;
      }
      try {
        const payload = decryptBookingApplicationPii(row.id, row, piiCryptography, "strict");
        if (
          !bookingApplicationLegacyPiiMatches(row, payload) ||
          !privateVenueNameMatches(
            {
              venueIsPartner: row.venue?.isPartner ?? null,
              venueName: row.venue?.name ?? null
            },
            payload.customVenueName
          )
        ) {
          result.legacyMismatch += 1;
        }
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (row.piiSchemaVersion !== BOOKING_APPLICATION_PII_SCHEMA_VERSION) {
          result.invalidEnvelope += 1;
        }
        if (
          row.piiBlindIndexKeyId !== piiCryptography.blindIndexKeyId ||
          row.piiBlindIndexVersion !== piiCryptography.blindIndexVersion ||
          row.primaryEmailBlindIndex !==
            piiCryptography.blindIndex(
              "BookingApplication.primaryEmail",
              payload.primaryEmail,
              "email"
            ) ||
          row.bridePhoneBlindIndex !==
            piiCryptography.blindIndex(
              "BookingApplication.bridePhone",
              payload.bridePhone,
              "phone"
            ) ||
          row.groomPhoneBlindIndex !==
            piiCryptography.blindIndex("BookingApplication.groomPhone", payload.groomPhone, "phone")
        )
          result.blindIndexMismatch += 1;
        if (row.idempotencyKey) {
          const canonicalPayload = serializeBookingFingerprintPayload({
            source: row.source,
            brideFirstName: payload.brideFirstName,
            brideLastName: payload.brideLastName,
            bridePhone: payload.bridePhone,
            groomFirstName: payload.groomFirstName,
            groomLastName: payload.groomLastName,
            groomPhone: payload.groomPhone,
            primaryContact: row.primaryContact,
            primaryEmail: payload.primaryEmail,
            startsAt: row.weddingStartsAt,
            endsAt: row.weddingEndsAt,
            venueId: row.venue?.isPartner ? row.venueId : null,
            customVenueName: row.venue?.isPartner ? null : payload.customVenueName,
            packageCode: row.packageCodeSnapshot,
            serviceCodes: row.services.map((service) => service.codeSnapshot),
            paymentMethod: row.paymentMethod,
            note: payload.note,
            privacyConsent: row.privacyConsentAt !== null,
            marketingConsent: row.marketingConsentAt !== null
          });
          if (
            row.idempotencyFingerprintKeyId !== bookingFingerprintCryptography.activeKeyId ||
            !bookingFingerprintCryptography.verify(canonicalPayload, row)
          ) {
            result.fingerprintMismatch += 1;
          }
        } else if (
          row.idempotencyFingerprintHmac !== null ||
          row.idempotencyFingerprintKeyId !== null ||
          row.idempotencyFingerprintVersion !== null
        ) {
          result.fingerprintMismatch += 1;
        }
      } catch {
        result.invalidEnvelope += 1;
      }
    }
    cursor = rows.at(-1)?.id;
  }
  result.orphanPrivateVenues = await prisma.venue.count({
    where: {
      isPartner: false,
      applications: { none: {} },
      weddings: { none: {} },
      staff: { none: {} },
      managers: { none: {} }
    }
  });
  return result;
};

const verifyWeddings = async (): Promise<Verification> => {
  const result = emptyVerification();
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.wedding.findMany({
      orderBy: { id: "asc" },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        brideFirstName: true,
        brideLastName: true,
        bridePhone: true,
        groomFirstName: true,
        groomLastName: true,
        groomPhone: true,
        primaryEmail: true,
        note: true,
        piiCiphertext: true,
        piiIv: true,
        piiAuthTag: true,
        piiKeyId: true,
        piiEncryptionVersion: true,
        piiSchemaVersion: true,
        piiRevision: true,
        primaryEmailBlindIndex: true,
        bridePhoneBlindIndex: true,
        groomPhoneBlindIndex: true,
        piiBlindIndexKeyId: true,
        piiBlindIndexVersion: true
      }
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
        const payload = decryptWeddingPii(row.id, row, piiCryptography, "strict");
        if (!weddingLegacyPiiMatches(row, payload)) result.legacyMismatch += 1;
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (
          row.piiBlindIndexKeyId !== piiCryptography.blindIndexKeyId ||
          row.piiBlindIndexVersion !== piiCryptography.blindIndexVersion ||
          row.primaryEmailBlindIndex !==
            piiCryptography.blindIndex("Wedding.primaryEmail", payload.primaryEmail, "email") ||
          row.bridePhoneBlindIndex !==
            piiCryptography.blindIndex("Wedding.bridePhone", payload.bridePhone, "phone") ||
          row.groomPhoneBlindIndex !==
            piiCryptography.blindIndex("Wedding.groomPhone", payload.groomPhone, "phone")
        )
          result.blindIndexMismatch += 1;
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
      orderBy: { id: "asc" },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        recipientPhone: true,
        piiCiphertext: true,
        piiIv: true,
        piiAuthTag: true,
        piiKeyId: true,
        piiEncryptionVersion: true,
        piiSchemaVersion: true,
        piiRevision: true,
        recipientPhoneBlindIndex: true,
        piiBlindIndexKeyId: true,
        piiBlindIndexVersion: true
      }
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
        const payload = decryptMessageTaskPii(row.id, row, piiCryptography, "strict");
        if (!messageTaskLegacyPiiMatches(row, payload)) result.legacyMismatch += 1;
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (
          row.piiBlindIndexKeyId !== piiCryptography.blindIndexKeyId ||
          row.piiBlindIndexVersion !== piiCryptography.blindIndexVersion ||
          row.recipientPhoneBlindIndex !==
          piiCryptography.blindIndex("MessageTask.recipientPhone", payload.recipientPhone, "phone")
        )
          result.blindIndexMismatch += 1;
      } catch {
        result.invalidEnvelope += 1;
      }
    }
    cursor = rows.at(-1)?.id;
  }
  return result;
};

const verifyStaff = async (): Promise<Verification> => {
  const result = emptyVerification();
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.staff.findMany({
      orderBy: { id: "asc" },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        piiCiphertext: true,
        piiIv: true,
        piiAuthTag: true,
        piiKeyId: true,
        piiEncryptionVersion: true,
        piiSchemaVersion: true,
        piiRevision: true,
        phoneBlindIndex: true,
        piiBlindIndexKeyId: true,
        piiBlindIndexVersion: true
      }
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.total += 1;
      if (row.firstName !== null || row.lastName !== null || row.phone !== null) {
        result.legacyPlaintext += 1;
      }
      if (!row.piiCiphertext) {
        result.missingEnvelope += 1;
        continue;
      }
      try {
        const payload = decryptStaffPii(row.id, row, piiCryptography, "strict");
        if (!staffLegacyPiiMatches(row, payload)) result.legacyMismatch += 1;
        if (row.piiKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) result.inactiveKey += 1;
        if (
          row.piiBlindIndexKeyId !== piiCryptography.blindIndexKeyId ||
          row.piiBlindIndexVersion !== piiCryptography.blindIndexVersion ||
          row.phoneBlindIndex !== piiCryptography.blindIndex("Staff.phone", payload.phone, "phone")
        ) {
          result.blindIndexMismatch += 1;
        }
      } catch {
        result.invalidEnvelope += 1;
      }
    }
    cursor = rows.at(-1)?.id;
  }
  return result;
};

const verifyDeliveries = async (): Promise<Verification> => {
  const result = emptyVerification();
  let cursor: string | undefined;
  while (true) {
    const rows = await prisma.delivery.findMany({
      orderBy: { id: "asc" },
      take: MAX_BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        driveUrlCiphertext: true,
        driveUrlIv: true,
        driveUrlAuthTag: true,
        driveUrlKeyId: true,
        encryptionVersion: true
      }
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      result.total += 1;
      try {
        const driveUrl = decryptDeliveryDriveUrl(row);
        if (driveUrl !== null && row.driveUrlKeyId !== env.DATA_ENCRYPTION_ACTIVE_KEY_ID) {
          result.inactiveKey += 1;
        }
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
  value.fingerprintMismatch > 0 ||
  value.legacyMismatch > 0 ||
  value.inactiveKey > 0 ||
  value.legacyPlaintext > 0 ||
  value.privateVenueLinks > 0 ||
  value.orphanPrivateVenues > 0;

const hasBackfillVerificationFailure = (value: Verification): boolean =>
  value.missingEnvelope > 0 ||
  value.invalidEnvelope > 0 ||
  value.blindIndexMismatch > 0 ||
  value.fingerprintMismatch > 0 ||
  value.legacyMismatch > 0 ||
  value.inactiveKey > 0;

const main = async () => {
  const operation = process.argv[2];
  if (operation === "--backfill") {
    const batchSize = parseBatchSize();
    const result = {
      bookingApplications: await backfillBookings(batchSize),
      weddings: await backfillWeddings(batchSize),
      messageTasks: await backfillMessages(batchSize),
      staff: await backfillStaff(batchSize),
      deliveries: await backfillDeliveries(batchSize)
    };
    console.log(JSON.stringify({ operation: "backfill", batchSize, updated: result }));
    return;
  }
  if (operation === "--redact-legacy") {
    const batchSize = parseBatchSize();
    const result = {
      bookingApplications: await redactBookingLegacy(batchSize),
      weddings: await redactWeddingLegacy(batchSize),
      messageTasks: await redactMessageLegacy(batchSize),
      staff: await redactStaffLegacy(batchSize)
    };
    console.log(JSON.stringify({ operation: "redact-legacy", batchSize, updated: result }));
    return;
  }
  if (operation === "--verify" || operation === "--verify-backfill") {
    const result = {
      bookingApplications: await verifyBookings(),
      weddings: await verifyWeddings(),
      messageTasks: await verifyMessages(),
      staff: await verifyStaff(),
      deliveries: await verifyDeliveries()
    };
    const ready = !Object.values(result).some(
      operation === "--verify" ? hasVerificationFailure : hasBackfillVerificationFailure
    );
    console.log(
      JSON.stringify({
        operation: operation === "--verify" ? "verify" : "verify-backfill",
        ready,
        models: result
      })
    );
    if (!ready) process.exitCode = 2;
    return;
  }
  throw new Error(
    "Kullanım: maintainPiiEncryption.ts --verify | --verify-backfill | --backfill | --redact-legacy [--batch-size=50..100]"
  );
};

runWithRlsContext({ actorRole: "maintenance", purpose: "maintenance.pii" }, main)
  .catch(() => {
    console.error("PII bakım işlemi başarısız oldu; hassas veri ayrıntıları loglanmadı.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
