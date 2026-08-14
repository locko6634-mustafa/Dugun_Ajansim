import { Prisma, type BookingSource, type User } from "@prisma/client";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { setTimeout as wait } from "node:timers/promises";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.config.js";
import type { z } from "zod";
import type { bookingBodySchema } from "../schemas/api.schemas.js";
import { AppError } from "../utils/appError.js";
import {
  bookingFingerprintCryptography,
  legacyFingerprintMatches,
  serializeBookingFingerprintPayload
} from "../utils/booking-fingerprint.js";
import { writeAuditLog } from "../utils/audit.js";
import { createOpaqueToken, hashPassword, hashToken, tokenHashesMatch } from "../utils/crypto.js";
import {
  addCalendarDays,
  assertWeddingStartsInFuture,
  atIstanbulTime,
  createWeddingRange,
  formatIstanbulTime,
  getIstanbulDate,
  isStrictGregorianDate,
  normalizePhone,
  randomReferenceCode
} from "../utils/domain.js";
import {
  buildBookingApplicationPiiData,
  buildMessageTaskPiiData,
  buildWeddingPiiData,
  decryptBookingApplicationPii
} from "../utils/pii-crypto.js";

export type BookingInput = Omit<z.infer<typeof bookingBodySchema>, "privacyConsent"> & {
  privacyConsent: boolean;
};

type CreateBookingOptions = {
  source: BookingSource;
  idempotencyKey?: string;
  paymentFlowKey?: string;
  actor?: Pick<User, "id">;
  correlationId: string;
};

export const paymentPolicy = Object.freeze({
  cashDiscountPercent: 10,
  depositMaximumCents: 500_000
});

const bookingTransactionRetryPolicy = Object.freeze({
  maxAttempts: 6,
  baseDelayMs: 25,
  maximumDelayMs: 400
});

const waitForBookingTransactionRetry = (attempt: number) => {
  const maximumDelay = Math.min(
    bookingTransactionRetryPolicy.baseDelayMs * 2 ** attempt,
    bookingTransactionRetryPolicy.maximumDelayMs
  );
  const minimumDelay = Math.ceil(maximumDelay / 2);
  return wait(randomInt(minimumDelay, maximumDelay + 1));
};

const isRetryableBookingTransactionError = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2002" || error.code === "P2034") return true;
  const rawDatabaseCode = error.code === "P2010" ? String(error.meta?.code ?? "") : "";
  return rawDatabaseCode === "40001" || rawDatabaseCode === "40P01";
};

export const calculatePayment = (
  subtotalCents: number,
  paymentMethod: "CASH" | "DEPOSIT"
): { totalPriceCents: number; payableNowCents: number } => {
  const totalPriceCents =
    paymentMethod === "CASH"
      ? Math.round((subtotalCents * (100 - paymentPolicy.cashDiscountPercent)) / 100)
      : subtotalCents;
  return {
    totalPriceCents,
    payableNowCents:
      paymentMethod === "CASH"
        ? totalPriceCents
        : Math.min(paymentPolicy.depositMaximumCents, totalPriceCents)
  };
};

const createAudit = (
  transaction: Prisma.TransactionClient,
  input: {
    actorUserId?: string;
    action: string;
    targetType: string;
    targetId?: string;
    correlationId: string;
    metadata?: Prisma.InputJsonValue;
  }
) =>
  writeAuditLog(transaction, {
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      correlationId: input.correlationId,
      metadata: input.metadata
    }
  });

const deleteOrphanedCustomerVenue = (transaction: Prisma.TransactionClient, venueId: string) =>
  transaction.venue.deleteMany({
    where: {
      id: venueId,
      isPartner: false,
      applications: { none: {} },
      weddings: { none: {} },
      staff: { none: {} },
      managers: { none: {} }
    }
  });

const idempotencySelect = {
  id: true,
  referenceCode: true,
  status: true,
  packageCodeSnapshot: true,
  packageNameSnapshot: true,
  packagePriceCents: true,
  services: { select: { codeSnapshot: true, nameSnapshot: true, priceCents: true } },
  totalPriceCents: true,
  payableNowCents: true,
  paymentNotificationChannel: true,
  paymentFlowExpiresAt: true,
  whatsappHandoffAt: true,
  paymentFlowExpiredAt: true,
  paymentFlowTokenHash: true,
  idempotencyFingerprint: true,
  idempotencyFingerprintHmac: true,
  idempotencyFingerprintKeyId: true,
  idempotencyFingerprintVersion: true
} satisfies Prisma.BookingApplicationSelect;

const assertIdempotencyFingerprint = (
  existing: {
    idempotencyFingerprint: string | null;
    idempotencyFingerprintHmac: string | null;
    idempotencyFingerprintKeyId: string | null;
    idempotencyFingerprintVersion: number | null;
  },
  canonicalPayload: string,
  legacyFingerprint: string
): "hmac" | "legacy" => {
  const hasHmacMetadata =
    existing.idempotencyFingerprintHmac !== null ||
    existing.idempotencyFingerprintKeyId !== null ||
    existing.idempotencyFingerprintVersion !== null;
  const matches = hasHmacMetadata
    ? bookingFingerprintCryptography.verify(canonicalPayload, existing)
    : legacyFingerprintMatches(existing.idempotencyFingerprint, legacyFingerprint);
  if (!matches) {
    throw new AppError("Idempotency anahtarı farklı bir başvuru için kullanılmış.", 409);
  }
  return hasHmacMetadata ? "hmac" : "legacy";
};

const upgradeLegacyIdempotencyFingerprint = async (
  transaction: Prisma.TransactionClient,
  existing: {
    id: string;
    idempotencyFingerprint: string | null;
    idempotencyFingerprintHmac: string | null;
    idempotencyFingerprintKeyId: string | null;
    idempotencyFingerprintVersion: number | null;
  },
  fingerprintEnvelope: ReturnType<typeof bookingFingerprintCryptography.create>
): Promise<void> => {
  const upgraded = await transaction.bookingApplication.updateMany({
    where: {
      id: existing.id,
      idempotencyFingerprint: existing.idempotencyFingerprint,
      idempotencyFingerprintHmac: null,
      idempotencyFingerprintKeyId: null,
      idempotencyFingerprintVersion: null
    },
    data: {
      idempotencyFingerprint: null,
      ...fingerprintEnvelope
    }
  });
  if (upgraded.count !== 1) {
    throw new AppError("Idempotency kaydı başka bir işlemde güncellendi.", 409);
  }
};

type VenueScheduleAvailabilityInput = {
  venueId: string;
  startsAt: Date;
  endsAt: Date;
  excludeWeddingId?: string;
  excludeApplicationId?: string;
};

const activeScheduleApplicationWhere = (now: Date): Prisma.BookingApplicationWhereInput => ({
  OR: [
    { status: "ONAYLANDI" },
    { status: "ONAY_BEKLIYOR", source: "ADMIN" },
    {
      status: "ONAY_BEKLIYOR",
      source: "PUBLIC_FORM",
      OR: [
        { paymentFlowExpiresAt: { gt: now } },
        { whatsappHandoffAt: { not: null } },
        { paymentNotificationChannel: { not: null } }
      ]
    }
  ]
});

const hasPublicVenueConflict = async (
  transaction: Prisma.TransactionClient,
  input: VenueScheduleAvailabilityInput
): Promise<boolean> => {
  const [result] = await transaction.$queryRaw<Array<{ hasConflict: boolean }>>(Prisma.sql`
    SELECT public.public_venue_has_conflict(
      ${input.venueId}::text,
      ${input.startsAt},
      ${input.endsAt},
      ${input.excludeWeddingId ?? null}::text,
      ${input.excludeApplicationId ?? null}::text
    ) AS "hasConflict"
  `);
  return result?.hasConflict ?? true;
};

const publicVenueConflictError = () =>
  new AppError(
    "Seçilen salonda bu saat aralığı doludur. Lütfen farklı bir saat seçin.",
    409,
    true,
    undefined,
    { code: "VENUE_SCHEDULE_CONFLICT" }
  );

export const assertVenueScheduleAvailable = async (
  transaction: Prisma.TransactionClient,
  input: VenueScheduleAvailabilityInput
): Promise<void> => {
  const now = new Date();
  const [conflictingWedding, conflictingApplication] = await Promise.all([
    transaction.wedding.findFirst({
      where: {
        venueId: input.venueId,
        ...(input.excludeWeddingId ? { id: { not: input.excludeWeddingId } } : {}),
        cancelledAt: null,
        deletedAt: null,
        startsAt: { lt: input.endsAt },
        endsAt: { gt: input.startsAt }
      },
      select: { id: true }
    }),
    transaction.bookingApplication.findFirst({
      where: {
        venueId: input.venueId,
        ...(input.excludeApplicationId ? { id: { not: input.excludeApplicationId } } : {}),
        deletedAt: null,
        ...activeScheduleApplicationWhere(now),
        weddingStartsAt: { lt: input.endsAt },
        weddingEndsAt: { gt: input.startsAt }
      },
      select: { id: true }
    })
  ]);

  if (conflictingWedding || conflictingApplication) {
    throw new AppError(
      "Seçilen salonda bu saat aralığında başka bir düğün veya aktif başvuru bulunuyor.",
      409,
      true,
      { code: "VENUE_SCHEDULE_CONFLICT" }
    );
  }
};

export const createBookingFingerprint = (
  input: BookingInput,
  source: BookingSource,
  startsAt: Date,
  endsAt: Date,
  bridePhone: string,
  groomPhone: string,
  serviceCodes: string[]
): string =>
  hashToken(
    JSON.stringify({
      source,
      brideFirstName: input.brideFirstName,
      brideLastName: input.brideLastName,
      bridePhone,
      groomFirstName: input.groomFirstName,
      groomLastName: input.groomLastName,
      groomPhone,
      primaryContact: input.primaryContact,
      primaryEmail: input.primaryEmail,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      venueId: input.venueId,
      packageCode: input.packageCode,
      serviceCodes,
      paymentMethod: input.paymentMethod,
      note: input.note || null,
      privacyConsent: input.privacyConsent,
      marketingConsent: input.marketingConsent
    })
  );

export const createBookingFingerprintPayload = (
  input: BookingInput,
  source: BookingSource,
  startsAt: Date,
  endsAt: Date,
  bridePhone: string,
  groomPhone: string,
  serviceCodes: string[]
): string =>
  serializeBookingFingerprintPayload({
    source,
    brideFirstName: input.brideFirstName,
    brideLastName: input.brideLastName,
    bridePhone,
    groomFirstName: input.groomFirstName,
    groomLastName: input.groomLastName,
    groomPhone,
    primaryContact: input.primaryContact,
    primaryEmail: input.primaryEmail,
    startsAt,
    endsAt,
    venueId: input.venueId ?? null,
    customVenueName: input.customVenueName?.trim() || null,
    packageCode: input.packageCode,
    serviceCodes,
    paymentMethod: input.paymentMethod,
    note: input.note || null,
    privacyConsent: input.privacyConsent,
    marketingConsent: input.marketingConsent
  });

export const createBookingApplication = async (
  input: BookingInput,
  options: CreateBookingOptions
) => {
  if (options.source === "PUBLIC_FORM" && !options.paymentFlowKey) {
    throw new AppError("Ödeme akışı anahtarı zorunludur.", 400);
  }
  if (options.source === "PUBLIC_FORM" && !options.idempotencyKey) {
    throw new AppError("Idempotency-Key zorunludur.", 400);
  }
  const { startsAt, endsAt } = createWeddingRange(
    input.weddingDate,
    input.startTime,
    input.endTime,
    input.endsNextDay
  );
  assertWeddingStartsInFuture(startsAt);

  const bridePhone = normalizePhone(input.bridePhone);
  const groomPhone = normalizePhone(input.groomPhone);
  const serviceCodes = [...new Set(input.serviceCodes)].sort();
  const idempotencyFingerprint = createBookingFingerprint(
    input,
    options.source,
    startsAt,
    endsAt,
    bridePhone,
    groomPhone,
    serviceCodes
  );
  const idempotencyFingerprintPayload = createBookingFingerprintPayload(
    input,
    options.source,
    startsAt,
    endsAt,
    bridePhone,
    groomPhone,
    serviceCodes
  );
  const idempotencyFingerprintEnvelope = bookingFingerprintCryptography.create(
    idempotencyFingerprintPayload
  );

  for (let attempt = 0; attempt < bookingTransactionRetryPolicy.maxAttempts; attempt += 1) {
    try {
      const referenceCode = randomReferenceCode();
      const applicationId = randomUUID();
      const applicationPii = buildBookingApplicationPiiData(
        applicationId,
        {
          brideFirstName: input.brideFirstName,
          brideLastName: input.brideLastName,
          bridePhone,
          groomFirstName: input.groomFirstName,
          groomLastName: input.groomLastName,
          groomPhone,
          primaryEmail: input.primaryEmail,
          note: input.note || null,
          rejectionReason: null,
          customVenueName: input.customVenueName?.trim() || null
        },
        1
      );
      return await prisma.$transaction(
        async (transaction) => {
          if (options.idempotencyKey) {
            const existing = await transaction.bookingApplication.findUnique({
              where: { idempotencyKey: options.idempotencyKey },
              select: idempotencySelect
            });
            if (existing) {
              const fingerprintMode = assertIdempotencyFingerprint(
                existing,
                idempotencyFingerprintPayload,
                idempotencyFingerprint
              );
              if (fingerprintMode === "legacy") {
                await upgradeLegacyIdempotencyFingerprint(
                  transaction,
                  existing,
                  idempotencyFingerprintEnvelope
                );
              }
              if (
                options.source === "PUBLIC_FORM" &&
                (!existing.paymentFlowTokenHash ||
                  !tokenHashesMatch(options.paymentFlowKey!, existing.paymentFlowTokenHash))
              ) {
                throw new AppError("Idempotency anahtarı farklı bir ödeme akışına ait.", 409);
              }
              const {
                idempotencyFingerprint: _fingerprint,
                idempotencyFingerprintHmac: _fingerprintHmac,
                idempotencyFingerprintKeyId: _fingerprintKeyId,
                idempotencyFingerprintVersion: _fingerprintVersion,
                paymentFlowTokenHash: _flowTokenHash,
                ...response
              } = existing;
              return response;
            }
          }

          const venuePromise = input.venueId
            ? transaction.venue.findFirst({ where: { id: input.venueId, isActive: true } })
            : Promise.resolve(null);
          const [venue, selectedPackage, selectedServices] = await Promise.all([
            venuePromise,
            transaction.package.findFirst({
              where: { code: input.packageCode, isActive: true }
            }),
            transaction.service.findMany({
              where: { code: { in: serviceCodes }, isActive: true },
              orderBy: { code: "asc" }
            })
          ]);

          if (input.venueId && !venue) {
            throw new AppError("Seçilen salon artık aktif değil.", 400);
          }
          if (!selectedPackage) throw new AppError("Seçilen paket artık aktif değil.", 400);
          if (selectedServices.length !== serviceCodes.length) {
            throw new AppError("Seçilen hizmetlerden biri artık aktif değil.", 400);
          }

          const publicConflict =
            options.source === "PUBLIC_FORM" && venue
              ? await hasPublicVenueConflict(transaction, {
                  venueId: venue.id,
                  startsAt,
                  endsAt
                })
              : false;
          const conflictingWedding =
            options.source === "PUBLIC_FORM" || !venue
              ? null
              : await transaction.wedding.findFirst({
                  where: {
                    venueId: venue.id,
                    cancelledAt: null,
                    deletedAt: null,
                    startsAt: { lt: endsAt },
                    endsAt: { gt: startsAt }
                  },
                  select: { startsAt: true, endsAt: true }
                });

          const conflictingApp =
            options.source !== "PUBLIC_FORM" && venue && !conflictingWedding
              ? await transaction.bookingApplication.findFirst({
                  where: {
                    venueId: venue.id,
                    deletedAt: null,
                    ...activeScheduleApplicationWhere(new Date()),
                    weddingStartsAt: { lt: endsAt },
                    weddingEndsAt: { gt: startsAt }
                  },
                  select: { weddingStartsAt: true, weddingEndsAt: true }
                })
              : null;

          if (publicConflict || conflictingWedding || conflictingApp) {
            if (publicConflict) {
              throw publicVenueConflictError();
            }
            const conflStart = formatIstanbulTime(
              conflictingWedding?.startsAt || conflictingApp!.weddingStartsAt
            );
            const conflEnd = formatIstanbulTime(
              conflictingWedding?.endsAt || conflictingApp!.weddingEndsAt
            );
            throw new AppError(
              `Seçilen salonda bu saat aralığında (${conflStart} - ${conflEnd}) dolu olan bir etkinlik/başvuru bulunmaktadır. Lütfen farklı bir saat seçin.`,
              400
            );
          }

          const subtotalCents =
            selectedPackage.priceCents +
            selectedServices.reduce((sum, service) => sum + service.priceCents, 0);
          const { totalPriceCents, payableNowCents } = calculatePayment(
            subtotalCents,
            input.paymentMethod
          );
          const now = new Date();
          const paymentFlowExpiresAt =
            options.source === "PUBLIC_FORM"
              ? new Date(now.valueOf() + env.PAYMENT_HANDOFF_TTL_MINUTES * 60_000)
              : null;
          const application = await transaction.bookingApplication.create({
            data: {
              id: applicationId,
              referenceCode,
              idempotencyKey: options.idempotencyKey,
              idempotencyFingerprint: null,
              ...(options.idempotencyKey ? idempotencyFingerprintEnvelope : {}),
              source: options.source,
              ...applicationPii,
              primaryContact: input.primaryContact,
              weddingStartsAt: startsAt,
              weddingEndsAt: endsAt,
              venueId: venue?.id ?? null,
              packageId: selectedPackage.id,
              packageCodeSnapshot: selectedPackage.code,
              packageNameSnapshot: selectedPackage.name,
              packagePriceCents: selectedPackage.priceCents,
              totalPriceCents,
              paymentMethod: input.paymentMethod,
              payableNowCents,
              paymentNotificationChannel: null,
              paymentFlowTokenHash: options.paymentFlowKey
                ? hashToken(options.paymentFlowKey)
                : null,
              paymentFlowExpiresAt,
              privacyConsentAt: input.privacyConsent ? now : null,
              marketingConsentAt: input.marketingConsent ? now : null,
              services: {
                create: selectedServices.map((service) => ({
                  serviceId: service.id,
                  codeSnapshot: service.code,
                  nameSnapshot: service.name,
                  priceCents: service.priceCents
                }))
              }
            },
            select: {
              id: true,
              referenceCode: true,
              status: true,
              packageCodeSnapshot: true,
              packageNameSnapshot: true,
              packagePriceCents: true,
              services: {
                select: { codeSnapshot: true, nameSnapshot: true, priceCents: true }
              },
              totalPriceCents: true,
              payableNowCents: true,
              paymentFlowExpiresAt: true,
              whatsappHandoffAt: true
            }
          });

          await createAudit(transaction, {
            actorUserId: options.actor?.id,
            action: "booking.created",
            targetType: "BookingApplication",
            targetId: application.id,
            correlationId: options.correlationId,
            metadata: {
              source: options.source,
              referenceCode,
              paymentFlowExpiresAt: paymentFlowExpiresAt?.toISOString()
            }
          });

          return application;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000
        }
      );
    } catch (error) {
      if (isRetryableBookingTransactionError(error)) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code !== "P2002" &&
          attempt + 1 < bookingTransactionRetryPolicy.maxAttempts
        ) {
          await waitForBookingTransactionRetry(attempt);
        }
        continue;
      }
      throw error;
    }
  }

  if (options.idempotencyKey) {
    const response = await prisma.$transaction(async (transaction) => {
      const existing = await transaction.bookingApplication.findUnique({
        where: { idempotencyKey: options.idempotencyKey },
        select: idempotencySelect
      });
      if (!existing) return null;
      const fingerprintMode = assertIdempotencyFingerprint(
        existing,
        idempotencyFingerprintPayload,
        idempotencyFingerprint
      );
      if (
        options.source === "PUBLIC_FORM" &&
        (!existing.paymentFlowTokenHash ||
          !tokenHashesMatch(options.paymentFlowKey!, existing.paymentFlowTokenHash))
      ) {
        throw new AppError("Idempotency anahtarı farklı bir ödeme akışına ait.", 409);
      }
      if (fingerprintMode === "legacy") {
        await upgradeLegacyIdempotencyFingerprint(
          transaction,
          existing,
          idempotencyFingerprintEnvelope
        );
      }
      const {
        idempotencyFingerprint: _fingerprint,
        idempotencyFingerprintHmac: _fingerprintHmac,
        idempotencyFingerprintKeyId: _fingerprintKeyId,
        idempotencyFingerprintVersion: _fingerprintVersion,
        paymentFlowTokenHash: _flowTokenHash,
        ...safeResponse
      } = existing;
      return safeResponse;
    });
    if (response) return response;
  }

  if (options.source === "PUBLIC_FORM" && input.venueId) {
    const publicConflict = await prisma.$transaction((transaction) =>
      hasPublicVenueConflict(transaction, {
        venueId: input.venueId!,
        startsAt,
        endsAt
      })
    );
    if (publicConflict) throw publicVenueConflictError();
  }

  throw new AppError("Başvuru referansı üretilemedi. Lütfen tekrar deneyin.", 503);
};

const paymentFlowInclude = {
  venue: { select: { id: true, name: true, isPartner: true } },
  services: { select: { codeSnapshot: true, nameSnapshot: true, priceCents: true } }
} satisfies Prisma.BookingApplicationInclude;

type PaymentFlowApplication = Prisma.BookingApplicationGetPayload<{
  include: typeof paymentFlowInclude;
}>;

const assertPaymentFlowAccess = (
  application: Pick<
    PaymentFlowApplication,
    "source" | "status" | "deletedAt" | "paymentFlowTokenHash"
  >,
  paymentFlowKey: string
): void => {
  if (
    application.source !== "PUBLIC_FORM" ||
    application.status !== "ONAY_BEKLIYOR" ||
    application.deletedAt !== null ||
    !application.paymentFlowTokenHash ||
    !tokenHashesMatch(paymentFlowKey, application.paymentFlowTokenHash)
  ) {
    throw new AppError("Ödeme akışı bulunamadı.", 404);
  }
};

const assertPaymentFlowNotExpired = (
  application: Pick<
    PaymentFlowApplication,
    "source" | "status" | "paymentFlowExpiresAt" | "paymentFlowExpiredAt"
  >,
  now: Date
): void => {
  const wasExpired = application.status === "IPTAL_EDILDI" && application.paymentFlowExpiredAt;
  const isPastDeadline =
    application.source === "PUBLIC_FORM" &&
    application.status === "ONAY_BEKLIYOR" &&
    (!application.paymentFlowExpiresAt || application.paymentFlowExpiresAt <= now);
  if (wasExpired || isPastDeadline) {
    throw new AppError("WhatsApp ödeme bildirimi süresi doldu.", 410, true, {
      code: "PAYMENT_FLOW_EXPIRED"
    });
  }
};

const assertApplicationNotAbandoned = (
  application: Pick<
    PaymentFlowApplication,
    | "source"
    | "status"
    | "paymentFlowExpiresAt"
    | "paymentFlowExpiredAt"
    | "whatsappHandoffAt"
    | "paymentNotificationChannel"
  >,
  now: Date
): void => {
  const hasHandoffOrEvidence = Boolean(
    application.whatsappHandoffAt || application.paymentNotificationChannel
  );
  const wasArchivedAsAbandoned =
    application.status === "IPTAL_EDILDI" && application.paymentFlowExpiredAt;
  const isAbandonedPastDeadline =
    application.source === "PUBLIC_FORM" &&
    application.status === "ONAY_BEKLIYOR" &&
    !hasHandoffOrEvidence &&
    (!application.paymentFlowExpiresAt || application.paymentFlowExpiresAt <= now);
  if (wasArchivedAsAbandoned || isAbandonedPastDeadline) {
    throw new AppError("WhatsApp ödeme bildirimi süresi doldu.", 410, true, {
      code: "PAYMENT_FLOW_EXPIRED"
    });
  }
};

const toPaymentFlowResponse = (application: PaymentFlowApplication) => {
  const weddingDate = getIstanbulDate(application.weddingStartsAt);
  const pii = decryptBookingApplicationPii(application.id, application);
  return {
    id: application.id,
    referenceCode: application.referenceCode,
    status: application.status,
    brideFirstName: pii.brideFirstName,
    brideLastName: pii.brideLastName,
    bridePhone: pii.bridePhone,
    groomFirstName: pii.groomFirstName,
    groomLastName: pii.groomLastName,
    groomPhone: pii.groomPhone,
    primaryContact: application.primaryContact,
    primaryEmail: pii.primaryEmail,
    weddingDate,
    startTime: formatIstanbulTime(application.weddingStartsAt),
    endTime: formatIstanbulTime(application.weddingEndsAt),
    endsNextDay: getIstanbulDate(application.weddingEndsAt) !== weddingDate,
    venueId: application.venue?.isPartner ? application.venue.id : undefined,
    customVenueName: application.venue?.isPartner
      ? undefined
      : (pii.customVenueName ?? application.venue?.name),
    venueName: application.venue?.name ?? pii.customVenueName,
    packageCode: application.packageCodeSnapshot,
    packageName: application.packageNameSnapshot,
    packagePriceCents: application.packagePriceCents,
    serviceCodes: application.services.map((service) => service.codeSnapshot),
    services: application.services,
    paymentMethod: application.paymentMethod,
    totalPriceCents: application.totalPriceCents,
    payableNowCents: application.payableNowCents,
    note: pii.note || "",
    privacyConsent: application.privacyConsentAt !== null,
    marketingConsent: application.marketingConsentAt !== null,
    paymentFlowExpiresAt: application.paymentFlowExpiresAt,
    whatsappHandoffAt: application.whatsappHandoffAt,
    paymentFlowExpiredAt: application.paymentFlowExpiredAt
  };
};

export const PAYMENT_FLOW_SWEEP_BATCH_SIZE = 100;
export const PAYMENT_FLOW_SWEEP_ADVISORY_LOCK_KEY = 1_940_667_981;

export type PaymentFlowSweepMetrics = {
  selectedCount: number;
  retainedCount: number;
  archivedAbandonedCount: number;
  preservedEvidenceCount: number;
  publicAccessClosedCount: number;
  failedCount: number;
  physicalDeletedCount: number;
};

export const shouldAlarmPaymentFlowSweep = (metrics: PaymentFlowSweepMetrics): boolean =>
  metrics.failedCount > 0 || metrics.physicalDeletedCount > 0;

type ExpiredPaymentFlowCandidate = {
  id: string;
};

const retainExpiredPaymentFlowCandidates = async (
  transaction: Prisma.TransactionClient,
  abandonedCandidates: readonly ExpiredPaymentFlowCandidate[],
  protectedCandidates: readonly ExpiredPaymentFlowCandidate[],
  now: Date,
  correlationId: string
): Promise<PaymentFlowSweepMetrics> => {
  let archivedAbandonedCount = 0;
  let publicAccessClosedCount = 0;
  for (const candidate of abandonedCandidates) {
    const archived = await transaction.bookingApplication.updateMany({
      where: {
        id: candidate.id,
        source: "PUBLIC_FORM",
        status: "ONAY_BEKLIYOR",
        deletedAt: null,
        paymentFlowExpiredAt: null,
        paymentFlowExpiresAt: { lte: now },
        whatsappHandoffAt: null,
        paymentNotificationChannel: null
      },
      data: {
        status: "IPTAL_EDILDI",
        deletedAt: now,
        paymentFlowExpiredAt: now,
        paymentFlowTokenHash: null
      }
    });
    if (archived.count !== 1) continue;

    await createAudit(transaction, {
      action: "booking.payment_flow_expired",
      targetType: "BookingApplication",
      targetId: candidate.id,
      correlationId,
      metadata: {
        expiredAt: now.toISOString(),
        reason: "no_handoff_or_payment_evidence_before_deadline",
        lifecycle: "cancelled_and_archived",
        physicalDelete: false
      }
    });
    archivedAbandonedCount += 1;
  }

  for (const candidate of protectedCandidates) {
    const closed = await transaction.bookingApplication.updateMany({
      where: {
        id: candidate.id,
        source: "PUBLIC_FORM",
        status: "ONAY_BEKLIYOR",
        deletedAt: null,
        paymentFlowExpiresAt: { lte: now },
        OR: [{ whatsappHandoffAt: { not: null } }, { paymentNotificationChannel: { not: null } }],
        paymentFlowTokenHash: { not: null }
      },
      data: { paymentFlowTokenHash: null }
    });
    if (closed.count !== 1) continue;
    await createAudit(transaction, {
      action: "booking.payment_flow_access_closed",
      targetType: "BookingApplication",
      targetId: candidate.id,
      correlationId,
      metadata: {
        closedAt: now.toISOString(),
        reason: "handoff_or_payment_evidence_retained",
        physicalDelete: false
      }
    });
    publicAccessClosedCount += 1;
  }

  const selectedIds = [...abandonedCandidates, ...protectedCandidates].map(({ id }) => id);
  const retainedCount = selectedIds.length
    ? await transaction.bookingApplication.count({ where: { id: { in: selectedIds } } })
    : 0;
  const selectedCount = selectedIds.length;
  const physicalDeletedCount = selectedCount - retainedCount;
  const failedCount = 0;
  const metrics = {
    selectedCount,
    retainedCount,
    archivedAbandonedCount,
    preservedEvidenceCount: protectedCandidates.length,
    publicAccessClosedCount,
    failedCount,
    physicalDeletedCount
  };
  if (shouldAlarmPaymentFlowSweep(metrics)) {
    throw new AppError("Ödeme akışı saklama bütünlüğü doğrulanamadı.", 500, false, {
      code: "PAYMENT_FLOW_RETENTION_INTEGRITY_ERROR"
    });
  }
  return metrics;
};

const expireStalePaymentFlow = async (
  applicationId: string,
  now: Date,
  correlationId: string
): Promise<number> =>
  prisma.$transaction(
    async (transaction) => {
      const expiredCandidates = await transaction.bookingApplication.findMany({
        where: {
          id: applicationId,
          source: "PUBLIC_FORM",
          status: "ONAY_BEKLIYOR",
          deletedAt: null,
          paymentFlowExpiredAt: null,
          paymentFlowExpiresAt: { lte: now },
          whatsappHandoffAt: null,
          paymentNotificationChannel: null
        },
        select: { id: true },
        take: 1
      });
      const metrics = await retainExpiredPaymentFlowCandidates(
        transaction,
        expiredCandidates,
        [],
        now,
        correlationId
      );
      return metrics.archivedAbandonedCount;
    },
    { maxWait: 2_000, timeout: 10_000 }
  );

export const expireStalePaymentFlows = async (
  now = new Date(),
  correlationId = `payment-expiry-${now.toISOString()}`
): Promise<PaymentFlowSweepMetrics> =>
  prisma.$transaction(
    async (transaction) => {
      const [lock] = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(
          ${PAYMENT_FLOW_SWEEP_ADVISORY_LOCK_KEY}::bigint
        ) AS "acquired"
      `;
      if (!lock?.acquired) {
        return {
          selectedCount: 0,
          retainedCount: 0,
          archivedAbandonedCount: 0,
          preservedEvidenceCount: 0,
          publicAccessClosedCount: 0,
          failedCount: 0,
          physicalDeletedCount: 0
        };
      }

      const abandonedCandidates = await transaction.bookingApplication.findMany({
        where: {
          source: "PUBLIC_FORM",
          status: "ONAY_BEKLIYOR",
          deletedAt: null,
          paymentFlowExpiredAt: null,
          paymentFlowExpiresAt: { lte: now },
          whatsappHandoffAt: null,
          paymentNotificationChannel: null
        },
        select: { id: true },
        orderBy: [{ paymentFlowExpiresAt: "asc" }, { id: "asc" }],
        take: PAYMENT_FLOW_SWEEP_BATCH_SIZE
      });
      const protectedCandidates = await transaction.bookingApplication.findMany({
        where: {
          source: "PUBLIC_FORM",
          status: "ONAY_BEKLIYOR",
          deletedAt: null,
          paymentFlowExpiresAt: { lte: now },
          paymentFlowTokenHash: { not: null },
          OR: [{ whatsappHandoffAt: { not: null } }, { paymentNotificationChannel: { not: null } }]
        },
        select: { id: true },
        orderBy: [{ paymentFlowExpiresAt: "asc" }, { id: "asc" }],
        take: PAYMENT_FLOW_SWEEP_BATCH_SIZE
      });
      return retainExpiredPaymentFlowCandidates(
        transaction,
        abandonedCandidates,
        protectedCandidates,
        now,
        correlationId
      );
    },
    { maxWait: 2_000, timeout: 30_000 }
  );

const authorizePaymentFlowTarget = async (
  applicationId: string,
  paymentFlowKey: string,
  now: Date,
  correlationId: string
): Promise<void> => {
  const application = await prisma.bookingApplication.findUnique({
    where: { id: applicationId },
    select: {
      source: true,
      status: true,
      deletedAt: true,
      paymentFlowTokenHash: true,
      paymentFlowExpiresAt: true,
      paymentFlowExpiredAt: true
    }
  });
  if (!application) throw new AppError("Ödeme akışı bulunamadı.", 404);

  assertPaymentFlowAccess(application, paymentFlowKey);
  if (application.paymentFlowExpiresAt && application.paymentFlowExpiresAt <= now) {
    await expireStalePaymentFlow(applicationId, now, correlationId);
    throw new AppError("Ödeme akışı bulunamadı.", 404);
  }
  assertPaymentFlowNotExpired(application, now);
};

export const getPaymentFlowApplication = async (
  applicationId: string,
  paymentFlowKey: string,
  correlationId: string
) => {
  const now = new Date();
  const application = await prisma.bookingApplication.findUnique({
    where: { id: applicationId },
    include: paymentFlowInclude
  });
  if (!application) throw new AppError("Ödeme akışı bulunamadı.", 404);
  assertPaymentFlowAccess(application, paymentFlowKey);
  if (application.paymentFlowExpiresAt && application.paymentFlowExpiresAt <= now) {
    await expireStalePaymentFlow(application.id, now, correlationId);
    throw new AppError("Ödeme akışı bulunamadı.", 404);
  }
  assertPaymentFlowNotExpired(application, now);
  return toPaymentFlowResponse(application);
};

export const updatePaymentFlowApplication = async (
  applicationId: string,
  input: BookingInput,
  paymentFlowKey: string,
  correlationId: string
) => {
  const now = new Date();
  await authorizePaymentFlowTarget(applicationId, paymentFlowKey, now, correlationId);
  const { startsAt, endsAt } = createWeddingRange(
    input.weddingDate,
    input.startTime,
    input.endTime,
    input.endsNextDay
  );
  assertWeddingStartsInFuture(startsAt, now);
  const bridePhone = normalizePhone(input.bridePhone);
  const groomPhone = normalizePhone(input.groomPhone);
  const serviceCodes = [...new Set(input.serviceCodes)].sort();

  return prisma.$transaction(
    async (transaction) => {
      const current = await transaction.bookingApplication.findUnique({
        where: { id: applicationId },
        include: paymentFlowInclude
      });
      if (!current) throw new AppError("Ödeme akışı bulunamadı.", 404);
      assertPaymentFlowAccess(current, paymentFlowKey);
      assertPaymentFlowNotExpired(current, now);
      if (current.status !== "ONAY_BEKLIYOR" || current.whatsappHandoffAt) {
        throw new AppError("WhatsApp aşamasına geçilen başvuru artık düzenlenemez.", 409);
      }
      const currentPii = decryptBookingApplicationPii(current.id, current);

      const venue = input.venueId
        ? await transaction.venue.findFirst({ where: { id: input.venueId, isActive: true } })
        : null;
      if (input.venueId && !venue) {
        throw new AppError("Seçilen salon artık aktif değil.", 400);
      }
      const [selectedPackage, selectedServices] = await Promise.all([
        transaction.package.findFirst({ where: { code: input.packageCode, isActive: true } }),
        transaction.service.findMany({
          where: { code: { in: serviceCodes }, isActive: true },
          orderBy: { code: "asc" }
        })
      ]);
      if (!selectedPackage) throw new AppError("Seçilen paket artık aktif değil.", 400);
      if (selectedServices.length !== serviceCodes.length) {
        throw new AppError("Seçilen hizmetlerden biri artık aktif değil.", 400);
      }
      if (venue) {
        await assertVenueScheduleAvailable(transaction, {
          venueId: venue.id,
          startsAt,
          endsAt,
          excludeApplicationId: current.id
        });
      }

      const subtotalCents =
        selectedPackage.priceCents +
        selectedServices.reduce((sum, service) => sum + service.priceCents, 0);
      const { totalPriceCents, payableNowCents } = calculatePayment(
        subtotalCents,
        input.paymentMethod
      );
      const fingerprintPayload = createBookingFingerprintPayload(
        input,
        "PUBLIC_FORM",
        startsAt,
        endsAt,
        bridePhone,
        groomPhone,
        serviceCodes
      );
      const nextPii = buildBookingApplicationPiiData(
        current.id,
        {
          brideFirstName: input.brideFirstName,
          brideLastName: input.brideLastName,
          bridePhone,
          groomFirstName: input.groomFirstName,
          groomLastName: input.groomLastName,
          groomPhone,
          primaryEmail: input.primaryEmail,
          note: input.note || null,
          rejectionReason: currentPii.rejectionReason,
          customVenueName: input.customVenueName?.trim() || null
        },
        current.piiRevision + 1
      );
      const updated = await transaction.bookingApplication.update({
        where: { id: current.id, piiRevision: current.piiRevision },
        data: {
          idempotencyFingerprint: null,
          ...bookingFingerprintCryptography.create(fingerprintPayload),
          ...nextPii,
          primaryContact: input.primaryContact,
          weddingStartsAt: startsAt,
          weddingEndsAt: endsAt,
          venueId: venue?.id ?? null,
          packageId: selectedPackage.id,
          packageCodeSnapshot: selectedPackage.code,
          packageNameSnapshot: selectedPackage.name,
          packagePriceCents: selectedPackage.priceCents,
          totalPriceCents,
          paymentMethod: input.paymentMethod,
          payableNowCents,
          privacyConsentAt: input.privacyConsent ? current.privacyConsentAt || now : null,
          marketingConsentAt: input.marketingConsent ? current.marketingConsentAt || now : null,
          services: {
            deleteMany: {},
            create: selectedServices.map((service) => ({
              serviceId: service.id,
              codeSnapshot: service.code,
              nameSnapshot: service.name,
              priceCents: service.priceCents
            }))
          }
        },
        include: paymentFlowInclude
      });
      await createAudit(transaction, {
        action: "booking.payment_flow_updated",
        targetType: "BookingApplication",
        targetId: current.id,
        correlationId,
        metadata: { referenceCode: current.referenceCode }
      });
      if (current.venueId && current.venueId !== venue?.id) {
        await deleteOrphanedCustomerVenue(transaction, current.venueId);
      }
      return toPaymentFlowResponse(updated);
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 10_000
    }
  );
};

export const markWhatsappHandoff = async (
  applicationId: string,
  paymentFlowKey: string,
  correlationId: string
) => {
  const now = new Date();
  await authorizePaymentFlowTarget(applicationId, paymentFlowKey, now, correlationId);
  return prisma.$transaction(async (transaction) => {
    const application = await transaction.bookingApplication.findUnique({
      where: { id: applicationId },
      include: paymentFlowInclude
    });
    if (!application) throw new AppError("Ödeme akışı bulunamadı.", 404);
    assertPaymentFlowAccess(application, paymentFlowKey);
    assertPaymentFlowNotExpired(application, now);
    if (application.whatsappHandoffAt) return toPaymentFlowResponse(application);
    if (
      application.status !== "ONAY_BEKLIYOR" ||
      !application.paymentFlowExpiresAt ||
      application.paymentFlowExpiresAt <= now
    ) {
      throw new AppError("WhatsApp ödeme bildirimi süresi doldu.", 410, true, {
        code: "PAYMENT_FLOW_EXPIRED"
      });
    }
    const claimed = await transaction.bookingApplication.updateMany({
      where: {
        id: application.id,
        status: "ONAY_BEKLIYOR",
        whatsappHandoffAt: null,
        paymentFlowExpiresAt: { gt: now }
      },
      data: { whatsappHandoffAt: now, paymentNotificationChannel: "WHATSAPP" }
    });
    if (claimed.count !== 1) {
      throw new AppError("Ödeme akışı başka bir işlemde güncellendi.", 409);
    }
    await createAudit(transaction, {
      action: "booking.whatsapp_handoff_started",
      targetType: "BookingApplication",
      targetId: application.id,
      correlationId,
      metadata: { referenceCode: application.referenceCode }
    });
    const updated = await transaction.bookingApplication.findUniqueOrThrow({
      where: { id: application.id },
      include: paymentFlowInclude
    });
    return toPaymentFlowResponse(updated);
  });
};

export const createUniqueCustomerUsername = async (
  _brideLastName?: string,
  _groomLastName?: string
): Promise<string> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = `m-${randomBytes(16).toString("hex")}`;
    const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!exists) return username;
  }
  throw new AppError("Benzersiz müşteri kullanıcı adı üretilemedi.", 503);
};

type ApprovalDependencies = {
  createUsername?: () => Promise<string>;
};

const isUsernameUniqueConflict = (error: unknown): boolean => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  const fields = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return fields.some((field) => field.toLowerCase().includes("username"));
};

export const retryUsernameConflict = async <Result>(
  createUsername: () => Promise<string>,
  operation: (username: string) => Promise<Result>,
  maxAttempts = 4
): Promise<Result> => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const username = await createUsername();
    try {
      return await operation(username);
    } catch (error) {
      if (isUsernameUniqueConflict(error)) continue;
      throw error;
    }
  }

  throw new AppError("Benzersiz müşteri kullanıcı adı üretilemedi.", 503);
};

export const approveBookingApplication = async (
  applicationId: string,
  actorUserId: string,
  correlationId: string,
  dependencies: ApprovalDependencies = {}
) => {
  const approvalStartedAt = new Date();
  await expireStalePaymentFlow(applicationId, approvalStartedAt, correlationId);
  const applicationIdentity = await prisma.bookingApplication.findFirst({
    where: { id: applicationId, deletedAt: null },
    select: {
      status: true,
      source: true,
      whatsappHandoffAt: true,
      paymentNotificationChannel: true,
      paymentFlowExpiresAt: true,
      paymentFlowExpiredAt: true
    }
  });
  if (!applicationIdentity) throw new AppError("Başvuru bulunamadı.", 404);
  assertApplicationNotAbandoned(applicationIdentity, approvalStartedAt);
  if (applicationIdentity.status !== "ONAY_BEKLIYOR") {
    throw new AppError("Yalnızca onay bekleyen başvurular onaylanabilir.", 409);
  }
  if (
    applicationIdentity.source === "PUBLIC_FORM" &&
    applicationIdentity.paymentFlowExpiresAt &&
    !applicationIdentity.whatsappHandoffAt &&
    !applicationIdentity.paymentNotificationChannel
  ) {
    throw new AppError("WhatsApp dekont bildirimi başlatılmamış başvuru onaylanamaz.", 409);
  }

  const passwordHash = await hashPassword(createOpaqueToken(48));
  const createUsername = dependencies.createUsername ?? createUniqueCustomerUsername;
  return retryUsernameConflict(
    () => createUsername(),
    (username) =>
      prisma.$transaction(
        async (transaction) => {
          const application = await transaction.bookingApplication.findFirst({
            where: { id: applicationId, deletedAt: null },
            include: { services: true }
          });
          if (!application) throw new AppError("Başvuru bulunamadı.", 404);
          const applicationPii = decryptBookingApplicationPii(application.id, application);
          const approvalClaimedAt = new Date();
          assertApplicationNotAbandoned(application, approvalClaimedAt);
          if (application.status !== "ONAY_BEKLIYOR") {
            throw new AppError("Yalnızca onay bekleyen başvurular onaylanabilir.", 409);
          }
          if (
            application.source === "PUBLIC_FORM" &&
            application.paymentFlowExpiresAt &&
            !application.whatsappHandoffAt &&
            !application.paymentNotificationChannel
          ) {
            throw new AppError("WhatsApp dekont bildirimi başlatılmamış başvuru onaylanamaz.", 409);
          }

          const approvedVenue = application.venueId
            ? await transaction.venue.findUnique({ where: { id: application.venueId } })
            : applicationPii.customVenueName
              ? ((await transaction.venue.findFirst({
                  where: {
                    name: { equals: applicationPii.customVenueName, mode: "insensitive" },
                    isActive: true
                  }
                })) ??
                (await transaction.venue.create({
                  data: {
                    name: applicationPii.customVenueName,
                    slug: `musteri-salonu-${randomUUID()}`,
                    isPartner: false
                  }
                })))
              : null;
          if (!approvedVenue) {
            throw new AppError("Başvurunun salon bilgisi bulunamadı.", 409);
          }

          await assertVenueScheduleAvailable(transaction, {
            venueId: approvedVenue.id,
            startsAt: application.weddingStartsAt,
            endsAt: application.weddingEndsAt,
            excludeApplicationId: application.id
          });

          const approvedAt = new Date();
          const claimed = await transaction.bookingApplication.updateMany({
            where: {
              id: application.id,
              status: "ONAY_BEKLIYOR",
              deletedAt: null,
              updatedAt: application.updatedAt,
              ...(application.source === "PUBLIC_FORM"
                ? {
                    OR: [
                      { whatsappHandoffAt: { not: null } },
                      { paymentNotificationChannel: { not: null } }
                    ]
                  }
                : {})
            },
            data: {
              status: "ONAYLANDI",
              venueId: approvedVenue.id,
              paymentFlowTokenHash: null,
              reviewedAt: approvedAt,
              reviewedById: actorUserId
            }
          });
          if (claimed.count !== 1) {
            throw new AppError("Başvuru başka bir işlemde güncellendi.", 409);
          }

          const weddingDate = getIstanbulDate(application.weddingStartsAt);
          const activeAt = atIstanbulTime(addCalendarDays(weddingDate, 1), "09:00");
          const preparationDueAt = atIstanbulTime(addCalendarDays(weddingDate, 2), "10:00");
          const dueDate = new Date(`${addCalendarDays(weddingDate, 21)}T00:00:00.000Z`);
          const recipientPhone =
            application.primaryContact === "GELIN"
              ? applicationPii.bridePhone
              : applicationPii.groomPhone;

          const user = await transaction.user.create({
            data: {
              username,
              passwordHash,
              role: "MUSTERI",
              mustChangePassword: true,
              temporaryPasswordExpiresAt: null,
              activeAt
            }
          });
          const weddingId = randomUUID();
          const wedding = await transaction.wedding.create({
            data: {
              id: weddingId,
              applicationId: application.id,
              customerUserId: user.id,
              ...buildWeddingPiiData(
                weddingId,
                {
                  brideFirstName: applicationPii.brideFirstName,
                  brideLastName: applicationPii.brideLastName,
                  bridePhone: applicationPii.bridePhone,
                  groomFirstName: applicationPii.groomFirstName,
                  groomLastName: applicationPii.groomLastName,
                  groomPhone: applicationPii.groomPhone,
                  primaryEmail: applicationPii.primaryEmail,
                  note: applicationPii.note
                },
                1
              ),
              primaryContact: application.primaryContact,
              startsAt: application.weddingStartsAt,
              endsAt: application.weddingEndsAt,
              venueId: approvedVenue.id,
              packageSummary: {
                code: application.packageCodeSnapshot,
                name: application.packageNameSnapshot,
                packagePriceCents: application.packagePriceCents,
                totalPriceCents: application.totalPriceCents,
                services: application.services.map((service) => ({
                  code: service.codeSnapshot,
                  name: service.nameSnapshot,
                  priceCents: service.priceCents
                }))
              },
              paymentTotalCents: application.totalPriceCents,
              paymentDepositCents:
                application.paymentMethod === "DEPOSIT" ? application.payableNowCents : 0,
              paymentReceivedCents: 0,
              delivery: {
                create: {
                  dueDate,
                  history: { create: { toStatus: "HAZIRLANIYOR", actorUserId } }
                }
              }
            }
          });

          const decisionTaskId = randomUUID();
          const activationTaskId = randomUUID();
          const preparationTaskId = randomUUID();
          await transaction.messageTask.createMany({
            data: [
              {
                id: decisionTaskId,
                applicationId: application.id,
                kind: "APPLICATION_APPROVED",
                dueAt: approvedAt,
                ...buildMessageTaskPiiData(decisionTaskId, { recipientPhone }, 1)
              },
              {
                id: activationTaskId,
                weddingId: wedding.id,
                kind: "ACCOUNT_ACTIVATION",
                dueAt: activeAt,
                ...buildMessageTaskPiiData(activationTaskId, { recipientPhone }, 1)
              },
              {
                id: preparationTaskId,
                weddingId: wedding.id,
                kind: "PREPARATION_UPDATE",
                dueAt: preparationDueAt,
                ...buildMessageTaskPiiData(preparationTaskId, { recipientPhone }, 1)
              }
            ]
          });
          await createAudit(transaction, {
            actorUserId,
            action: "booking.approved",
            targetType: "BookingApplication",
            targetId: application.id,
            correlationId,
            metadata: { weddingId: wedding.id }
          });

          return {
            applicationId: application.id,
            weddingId: wedding.id,
            username,
            activeAt,
            decisionTaskId,
            activationTaskId
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 10_000
        }
      )
  ).catch((error: unknown) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      throw new AppError(
        "Başvuru takvimi başka bir işlemde güncellendi. Tekrar deneyin.",
        409,
        true,
        {
          code: "VENUE_SCHEDULE_CONFLICT"
        }
      );
    }
    throw error;
  });
};

export const rejectBookingApplication = async (
  applicationId: string,
  reason: string,
  actorUserId: string,
  correlationId: string
) =>
  prisma.$transaction(async (transaction) => {
    const current = await transaction.bookingApplication.findFirst({
      where: { id: applicationId, status: "ONAY_BEKLIYOR", deletedAt: null }
    });
    if (!current) {
      throw new AppError("Başvuru bulunamadı veya artık onay beklemiyor.", 409);
    }
    const currentPii = decryptBookingApplicationPii(current.id, current);
    const nextPii = buildBookingApplicationPiiData(
      current.id,
      { ...currentPii, rejectionReason: reason },
      current.piiRevision + 1
    );
    const rejectedAt = new Date();
    const updated = await transaction.bookingApplication.updateMany({
      where: {
        id: applicationId,
        status: "ONAY_BEKLIYOR",
        deletedAt: null,
        updatedAt: current.updatedAt,
        piiRevision: current.piiRevision
      },
      data: {
        ...nextPii,
        status: "REDDEDILDI",
        paymentFlowTokenHash: null,
        reviewedAt: rejectedAt,
        reviewedById: actorUserId
      }
    });
    if (updated.count !== 1) {
      throw new AppError("Başvuru bulunamadı veya artık onay beklemiyor.", 409);
    }
    const recipientPhone =
      current.primaryContact === "GELIN" ? currentPii.bridePhone : currentPii.groomPhone;
    const rejectionTaskId = randomUUID();
    await transaction.messageTask.create({
      data: {
        id: rejectionTaskId,
        applicationId: current.id,
        kind: "APPLICATION_REJECTED",
        dueAt: rejectedAt,
        ...buildMessageTaskPiiData(rejectionTaskId, { recipientPhone }, 1)
      }
    });
    await createAudit(transaction, {
      actorUserId,
      action: "booking.rejected",
      targetType: "BookingApplication",
      targetId: applicationId,
      correlationId
    });
    return { id: applicationId, status: "REDDEDILDI" as const };
  });

export const getVenueAvailability = async (
  venueId: string,
  dateStr: string
): Promise<{ date: string; occupiedSlots: Array<{ startTime: string; endTime: string }> }> => {
  if (!isStrictGregorianDate(dateStr)) {
    throw new AppError("Geçersiz tarih formatı (YYYY-MM-DD olmalıdır).", 400);
  }

  const dayStartsAt = new Date(`${dateStr}T00:00:00+03:00`);
  const dayEndsAt = new Date(`${dateStr}T23:59:59+03:00`);

  const [weddings, applications] = await Promise.all([
    prisma.wedding.findMany({
      where: {
        venueId,
        cancelledAt: null,
        deletedAt: null,
        startsAt: { lt: dayEndsAt },
        endsAt: { gt: dayStartsAt }
      },
      select: { startsAt: true, endsAt: true },
      orderBy: { startsAt: "asc" }
    }),
    prisma.bookingApplication.findMany({
      where: {
        venueId,
        deletedAt: null,
        ...activeScheduleApplicationWhere(new Date()),
        weddingStartsAt: { lt: dayEndsAt },
        weddingEndsAt: { gt: dayStartsAt }
      },
      select: { weddingStartsAt: true, weddingEndsAt: true },
      orderBy: { weddingStartsAt: "asc" }
    })
  ]);

  const slotsMap = new Map<string, { startTime: string; endTime: string }>();

  weddings.forEach((item) => {
    const s = formatIstanbulTime(item.startsAt);
    const e = formatIstanbulTime(item.endsAt);
    slotsMap.set(`${s}-${e}`, { startTime: s, endTime: e });
  });

  applications.forEach((item) => {
    const s = formatIstanbulTime(item.weddingStartsAt);
    const e = formatIstanbulTime(item.weddingEndsAt);
    slotsMap.set(`${s}-${e}`, { startTime: s, endTime: e });
  });

  const occupiedSlots = Array.from(slotsMap.values()).sort((a, b) =>
    a.startTime.localeCompare(b.startTime)
  );

  return { date: dateStr, occupiedSlots };
};

const PUBLIC_AVAILABILITY_MAX_ADVANCE_DAYS = 366;

export const getPublicVenueAvailability = async (
  venueId: string,
  dateStr: string
): Promise<{ date: string; hasOccupancy: boolean }> => {
  const today = getIstanbulDate(new Date());
  const latestAllowedDate = addCalendarDays(today, PUBLIC_AVAILABILITY_MAX_ADVANCE_DAYS);
  if (dateStr < today || dateStr > latestAllowedDate) {
    throw new AppError(
      `Uygunluk yalnızca bugün ile ${latestAllowedDate} arasındaki tarihler için sorgulanabilir.`,
      400
    );
  }

  const dayStartsAt = new Date(`${dateStr}T00:00:00+03:00`);
  const dayEndsAt = new Date(`${dateStr}T23:59:59+03:00`);
  const [result] = await prisma.$queryRaw<Array<{ hasOccupancy: boolean }>>(Prisma.sql`
    SELECT public.public_venue_has_conflict(
      ${venueId}::text,
      ${dayStartsAt},
      ${dayEndsAt},
      NULL::text,
      NULL::text
    ) AS "hasOccupancy"
  `);
  return { date: dateStr, hasOccupancy: result?.hasOccupancy ?? true };
};

export { createAudit };
