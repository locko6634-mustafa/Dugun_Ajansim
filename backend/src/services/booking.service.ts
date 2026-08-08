import { Prisma, type BookingSource, type User } from "@prisma/client";
import { prisma } from "../config/prisma.js";
import { env } from "../config/env.config.js";
import type { z } from "zod";
import type { bookingBodySchema } from "../schemas/api.schemas.js";
import { AppError } from "../utils/appError.js";
import { encryptValue, hashPassword, hashToken, tokenHashesMatch } from "../utils/crypto.js";
import {
  addCalendarDays,
  atIstanbulTime,
  createTemporaryPasswordExpiry,
  createWeddingRange,
  formatIstanbulTime,
  getIstanbulDate,
  isStrictGregorianDate,
  messageSecretEncryptionAad,
  normalizePhone,
  normalizeUsername,
  randomFourDigitCode,
  randomReferenceCode,
  randomTemporaryPassword
} from "../utils/domain.js";

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
  transaction.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      correlationId: input.correlationId,
      metadata: input.metadata
    }
  });

const deleteOrphanedCustomerVenue = (
  transaction: Prisma.TransactionClient,
  venueId: string
) =>
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
  totalPriceCents: true,
  payableNowCents: true,
  paymentNotificationChannel: true,
  paymentFlowExpiresAt: true,
  whatsappHandoffAt: true,
  paymentFlowExpiredAt: true,
  paymentFlowTokenHash: true,
  idempotencyFingerprint: true
} satisfies Prisma.BookingApplicationSelect;

const assertIdempotencyFingerprint = (
  existing: {
    idempotencyFingerprint: string | null;
  },
  fingerprint: string
): void => {
  if (existing.idempotencyFingerprint !== fingerprint) {
    throw new AppError("Idempotency anahtarı farklı bir başvuru için kullanılmış.", 409);
  }
};

type VenueScheduleAvailabilityInput = {
  venueId: string;
  startsAt: Date;
  endsAt: Date;
  excludeWeddingId?: string;
  excludeApplicationId?: string;
};

const activeScheduleApplicationWhere = (
  now: Date
): Prisma.BookingApplicationWhereInput => ({
  OR: [
    { status: "ONAYLANDI" },
    { status: "ONAY_BEKLIYOR", source: "ADMIN" },
    {
      status: "ONAY_BEKLIYOR",
      source: "PUBLIC_FORM",
      paymentFlowExpiresAt: { gt: now }
    }
  ]
});

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

export const createBookingApplication = async (
  input: BookingInput,
  options: CreateBookingOptions
) => {
  if (options.source === "PUBLIC_FORM" && !options.paymentFlowKey) {
    throw new AppError("Ödeme akışı anahtarı zorunludur.", 400);
  }
  const { startsAt, endsAt } = createWeddingRange(
    input.weddingDate,
    input.startTime,
    input.endTime,
    input.endsNextDay
  );
  if (options.source === "PUBLIC_FORM" && input.weddingDate < getIstanbulDate(new Date())) {
    throw new AppError("Geçmiş tarihli düğün başvurusu oluşturulamaz.", 400);
  }

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

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const referenceCode = randomReferenceCode();
      return await prisma.$transaction(
        async (transaction) => {
          if (options.idempotencyKey) {
            const existing = await transaction.bookingApplication.findUnique({
              where: { idempotencyKey: options.idempotencyKey },
              select: idempotencySelect
            });
            if (existing) {
              assertIdempotencyFingerprint(existing, idempotencyFingerprint);
              if (
                options.source === "PUBLIC_FORM" &&
                (!existing.paymentFlowTokenHash ||
                  !tokenHashesMatch(options.paymentFlowKey!, existing.paymentFlowTokenHash))
              ) {
                throw new AppError("Idempotency anahtarı farklı bir ödeme akışına ait.", 409);
              }
              const {
                idempotencyFingerprint: _fingerprint,
                paymentFlowTokenHash: _flowTokenHash,
                ...response
              } = existing;
              return response;
            }
          }

          const customVenueName = input.customVenueName?.trim();
          const venuePromise = input.venueId
            ? transaction.venue.findFirst({ where: { id: input.venueId, isActive: true } })
            : transaction.venue
                .findFirst({
                  where: {
                    name: { equals: customVenueName, mode: "insensitive" },
                    isActive: true
                  }
                })
                .then(
                  (existing) =>
                    existing ||
                    transaction.venue.create({
                      data: {
                        name: customVenueName!,
                        slug: `musteri-salonu-${randomReferenceCode().toLowerCase()}`,
                        isPartner: false
                      }
                    })
                );
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

          if (!venue) throw new AppError("Seçilen salon artık aktif değil.", 400);
          if (!selectedPackage) throw new AppError("Seçilen paket artık aktif değil.", 400);
          if (selectedServices.length !== serviceCodes.length) {
            throw new AppError("Seçilen hizmetlerden biri artık aktif değil.", 400);
          }

          const conflictingWedding = await transaction.wedding.findFirst({
            where: {
              venueId: venue.id,
              cancelledAt: null,
              deletedAt: null,
              startsAt: { lt: endsAt },
              endsAt: { gt: startsAt }
            },
            select: { startsAt: true, endsAt: true }
          });

          const conflictingApp = !conflictingWedding
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

          if (conflictingWedding || conflictingApp) {
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
              referenceCode,
              idempotencyKey: options.idempotencyKey,
              idempotencyFingerprint: options.idempotencyKey ? idempotencyFingerprint : undefined,
              source: options.source,
              brideFirstName: input.brideFirstName,
              brideLastName: input.brideLastName,
              bridePhone,
              groomFirstName: input.groomFirstName,
              groomLastName: input.groomLastName,
              groomPhone,
              primaryContact: input.primaryContact,
              primaryEmail: input.primaryEmail,
              weddingStartsAt: startsAt,
              weddingEndsAt: endsAt,
              venueId: venue.id,
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
              note: input.note || null,
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2002" || error.code === "P2034")
      ) {
        continue;
      }
      throw error;
    }
  }

  if (options.idempotencyKey) {
    const existing = await prisma.bookingApplication.findUnique({
      where: { idempotencyKey: options.idempotencyKey },
      select: idempotencySelect
    });
    if (existing) {
      assertIdempotencyFingerprint(existing, idempotencyFingerprint);
      if (
        options.source === "PUBLIC_FORM" &&
        (!existing.paymentFlowTokenHash ||
          !tokenHashesMatch(options.paymentFlowKey!, existing.paymentFlowTokenHash))
      ) {
        throw new AppError("Idempotency anahtarı farklı bir ödeme akışına ait.", 409);
      }
      const {
        idempotencyFingerprint: _fingerprint,
        paymentFlowTokenHash: _flowTokenHash,
        ...response
      } = existing;
      return response;
    }
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

const toPaymentFlowResponse = (application: PaymentFlowApplication) => {
  const weddingDate = getIstanbulDate(application.weddingStartsAt);
  return {
    id: application.id,
    referenceCode: application.referenceCode,
    status: application.status,
    brideFirstName: application.brideFirstName,
    brideLastName: application.brideLastName,
    bridePhone: application.bridePhone,
    groomFirstName: application.groomFirstName,
    groomLastName: application.groomLastName,
    groomPhone: application.groomPhone,
    primaryContact: application.primaryContact,
    primaryEmail: application.primaryEmail,
    weddingDate,
    startTime: formatIstanbulTime(application.weddingStartsAt),
    endTime: formatIstanbulTime(application.weddingEndsAt),
    endsNextDay: getIstanbulDate(application.weddingEndsAt) !== weddingDate,
    venueId: application.venue.isPartner ? application.venue.id : undefined,
    customVenueName: application.venue.isPartner ? undefined : application.venue.name,
    venueName: application.venue.name,
    packageCode: application.packageCodeSnapshot,
    packageName: application.packageNameSnapshot,
    packagePriceCents: application.packagePriceCents,
    serviceCodes: application.services.map((service) => service.codeSnapshot),
    services: application.services,
    paymentMethod: application.paymentMethod,
    totalPriceCents: application.totalPriceCents,
    payableNowCents: application.payableNowCents,
    note: application.note || "",
    privacyConsent: application.privacyConsentAt !== null,
    marketingConsent: application.marketingConsentAt !== null,
    paymentFlowExpiresAt: application.paymentFlowExpiresAt,
    whatsappHandoffAt: application.whatsappHandoffAt,
    paymentFlowExpiredAt: application.paymentFlowExpiredAt
  };
};

export const expireStalePaymentFlows = async (
  now = new Date(),
  _correlationId = `payment-expiry-${now.toISOString()}`
): Promise<number> =>
  prisma.$transaction(async (transaction) => {
    const expiredCandidates = await transaction.bookingApplication.findMany({
      where: {
        source: "PUBLIC_FORM",
        status: "ONAY_BEKLIYOR",
        deletedAt: null,
        paymentFlowExpiredAt: null,
        paymentFlowExpiresAt: { lte: now }
      },
      select: { id: true, venueId: true },
      orderBy: [{ paymentFlowExpiresAt: "asc" }, { id: "asc" }],
      take: 100
    });

    let expiredCount = 0;
    for (const candidate of expiredCandidates) {
      const claimed = await transaction.bookingApplication.updateMany({
        where: {
          id: candidate.id,
          source: "PUBLIC_FORM",
          status: "ONAY_BEKLIYOR",
          deletedAt: null,
          paymentFlowExpiredAt: null,
          paymentFlowExpiresAt: { lte: now }
        },
        data: { status: "IPTAL_EDILDI", paymentFlowExpiredAt: now }
      });
      if (claimed.count !== 1) continue;
      await transaction.auditLog.deleteMany({
        where: { targetType: "BookingApplication", targetId: candidate.id }
      });
      await transaction.bookingApplication.delete({ where: { id: candidate.id } });
      await deleteOrphanedCustomerVenue(transaction, candidate.venueId);
      expiredCount += 1;
    }
    return expiredCount;
  });

export const getPaymentFlowApplication = async (
  applicationId: string,
  paymentFlowKey: string,
  correlationId: string
) => {
  await expireStalePaymentFlows(new Date(), correlationId);
  const application = await prisma.bookingApplication.findUnique({
    where: { id: applicationId },
    include: paymentFlowInclude
  });
  if (!application) throw new AppError("Ödeme akışı bulunamadı.", 404);
  assertPaymentFlowAccess(application, paymentFlowKey);
  assertPaymentFlowNotExpired(application, new Date());
  return toPaymentFlowResponse(application);
};

export const updatePaymentFlowApplication = async (
  applicationId: string,
  input: BookingInput,
  paymentFlowKey: string,
  correlationId: string
) => {
  const now = new Date();
  await expireStalePaymentFlows(now, correlationId);
  const { startsAt, endsAt } = createWeddingRange(
    input.weddingDate,
    input.startTime,
    input.endTime,
    input.endsNextDay
  );
  if (input.weddingDate < getIstanbulDate(now)) {
    throw new AppError("Geçmiş tarihli düğün başvurusu oluşturulamaz.", 400);
  }
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

      const customVenueName = input.customVenueName?.trim();
      const venue = input.venueId
        ? await transaction.venue.findFirst({ where: { id: input.venueId, isActive: true } })
        : (await transaction.venue.findFirst({
            where: { name: { equals: customVenueName, mode: "insensitive" }, isActive: true }
          })) ||
          (await transaction.venue.create({
            data: {
              name: customVenueName!,
              slug: `musteri-salonu-${randomReferenceCode().toLowerCase()}`,
              isPartner: false
            }
          }));
      if (!venue) throw new AppError("Seçilen salon artık aktif değil.", 400);
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
      await assertVenueScheduleAvailable(transaction, {
        venueId: venue.id,
        startsAt,
        endsAt,
        excludeApplicationId: current.id
      });

      const subtotalCents =
        selectedPackage.priceCents +
        selectedServices.reduce((sum, service) => sum + service.priceCents, 0);
      const { totalPriceCents, payableNowCents } = calculatePayment(
        subtotalCents,
        input.paymentMethod
      );
      const fingerprint = createBookingFingerprint(
        input,
        "PUBLIC_FORM",
        startsAt,
        endsAt,
        bridePhone,
        groomPhone,
        serviceCodes
      );
      const updated = await transaction.bookingApplication.update({
        where: { id: current.id },
        data: {
          idempotencyFingerprint: fingerprint,
          brideFirstName: input.brideFirstName,
          brideLastName: input.brideLastName,
          bridePhone,
          groomFirstName: input.groomFirstName,
          groomLastName: input.groomLastName,
          groomPhone,
          primaryContact: input.primaryContact,
          primaryEmail: input.primaryEmail,
          weddingStartsAt: startsAt,
          weddingEndsAt: endsAt,
          venueId: venue.id,
          packageId: selectedPackage.id,
          packageCodeSnapshot: selectedPackage.code,
          packageNameSnapshot: selectedPackage.name,
          packagePriceCents: selectedPackage.priceCents,
          totalPriceCents,
          paymentMethod: input.paymentMethod,
          payableNowCents,
          note: input.note || null,
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
      if (current.venueId !== venue.id) {
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
  await expireStalePaymentFlows(now, correlationId);
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
  brideLastName: string,
  groomLastName: string
): Promise<string> => {
  const normalizedParts = [normalizeUsername(brideLastName), normalizeUsername(groomLastName)]
    .filter(Boolean)
    .join("-");
  const prefix = (normalizedParts || "musteri").slice(0, 59).replace(/-+$/g, "") || "musteri";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const username = `${prefix}-${randomFourDigitCode()}`;
    const exists = await prisma.user.findUnique({ where: { username }, select: { id: true } });
    if (!exists) return username;
  }
  throw new AppError("Benzersiz müşteri kullanıcı adı üretilemedi.", 503);
};

type ApprovalDependencies = {
  createUsername?: (brideLastName: string, groomLastName: string) => Promise<string>;
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
  await expireStalePaymentFlows(approvalStartedAt, correlationId);
  const applicationIdentity = await prisma.bookingApplication.findFirst({
    where: { id: applicationId, deletedAt: null },
    select: {
      brideLastName: true,
      groomLastName: true,
      status: true,
      source: true,
      whatsappHandoffAt: true,
      paymentFlowExpiresAt: true,
      paymentFlowExpiredAt: true
    }
  });
  if (!applicationIdentity) throw new AppError("Başvuru bulunamadı.", 404);
  assertPaymentFlowNotExpired(applicationIdentity, approvalStartedAt);
  if (applicationIdentity.status !== "ONAY_BEKLIYOR") {
    throw new AppError("Yalnızca onay bekleyen başvurular onaylanabilir.", 409);
  }
  if (
    applicationIdentity.source === "PUBLIC_FORM" &&
    applicationIdentity.paymentFlowExpiresAt &&
    !applicationIdentity.whatsappHandoffAt
  ) {
    throw new AppError("WhatsApp dekont bildirimi başlatılmamış başvuru onaylanamaz.", 409);
  }

  const temporaryPassword = randomTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  const createUsername = dependencies.createUsername ?? createUniqueCustomerUsername;
  return retryUsernameConflict(
    () => createUsername(applicationIdentity.brideLastName, applicationIdentity.groomLastName),
    (username) =>
      prisma.$transaction(
        async (transaction) => {
          const application = await transaction.bookingApplication.findFirst({
            where: { id: applicationId, deletedAt: null },
            include: { services: true }
          });
          if (!application) throw new AppError("Başvuru bulunamadı.", 404);
          const approvalClaimedAt = new Date();
          assertPaymentFlowNotExpired(application, approvalClaimedAt);
          if (application.status !== "ONAY_BEKLIYOR") {
            throw new AppError("Yalnızca onay bekleyen başvurular onaylanabilir.", 409);
          }
          if (
            application.source === "PUBLIC_FORM" &&
            application.paymentFlowExpiresAt &&
            !application.whatsappHandoffAt
          ) {
            throw new AppError("WhatsApp dekont bildirimi başlatılmamış başvuru onaylanamaz.", 409);
          }

          await assertVenueScheduleAvailable(transaction, {
            venueId: application.venueId,
            startsAt: application.weddingStartsAt,
            endsAt: application.weddingEndsAt,
            excludeApplicationId: application.id
          });

          const claimed = await transaction.bookingApplication.updateMany({
            where: {
              id: application.id,
              status: "ONAY_BEKLIYOR",
              deletedAt: null,
              updatedAt: application.updatedAt,
              ...(application.source === "PUBLIC_FORM"
                ? {
                    whatsappHandoffAt: { not: null },
                    paymentFlowExpiresAt: { gt: approvalClaimedAt }
                  }
                : {})
            },
            data: {
              status: "ONAYLANDI",
              paymentFlowTokenHash: null,
              reviewedAt: new Date(),
              reviewedById: actorUserId
            }
          });
          if (claimed.count !== 1) {
            throw new AppError("Başvuru başka bir işlemde güncellendi.", 409);
          }

          const weddingDate = getIstanbulDate(application.weddingStartsAt);
          const activeAt = atIstanbulTime(addCalendarDays(weddingDate, 1), "09:00");
          const now = new Date();
          const temporaryPasswordExpiresAt = createTemporaryPasswordExpiry(
            env.TEMPORARY_PASSWORD_TTL_HOURS,
            activeAt > now ? activeAt : now
          );
          const preparationDueAt = atIstanbulTime(addCalendarDays(weddingDate, 2), "10:00");
          const dueDate = new Date(`${addCalendarDays(weddingDate, 21)}T00:00:00.000Z`);
          const recipientPhone =
            application.primaryContact === "GELIN"
              ? application.bridePhone
              : application.groomPhone;

          const user = await transaction.user.create({
            data: {
              username,
              passwordHash,
              role: "MUSTERI",
              mustChangePassword: true,
              temporaryPasswordExpiresAt,
              activeAt
            }
          });
          const wedding = await transaction.wedding.create({
            data: {
              applicationId: application.id,
              customerUserId: user.id,
              brideFirstName: application.brideFirstName,
              brideLastName: application.brideLastName,
              bridePhone: application.bridePhone,
              groomFirstName: application.groomFirstName,
              groomLastName: application.groomLastName,
              groomPhone: application.groomPhone,
              primaryContact: application.primaryContact,
              primaryEmail: application.primaryEmail,
              startsAt: application.weddingStartsAt,
              endsAt: application.weddingEndsAt,
              venueId: application.venueId,
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
              note: application.note,
              delivery: {
                create: {
                  dueDate,
                  history: { create: { toStatus: "HAZIRLANIYOR", actorUserId } }
                }
              }
            }
          });

          const encryptedPassword = encryptValue(
            temporaryPassword,
            messageSecretEncryptionAad(wedding.id, "ACCOUNT_ACTIVATION")
          );
          await transaction.messageTask.createMany({
            data: [
              {
                weddingId: wedding.id,
                kind: "ACCOUNT_ACTIVATION",
                dueAt: activeAt,
                recipientPhone,
                secretCiphertext: encryptedPassword.ciphertext,
                secretIv: encryptedPassword.iv,
                secretAuthTag: encryptedPassword.authTag,
                encryptionVersion: 2
              },
              {
                weddingId: wedding.id,
                kind: "PREPARATION_UPDATE",
                dueAt: preparationDueAt,
                recipientPhone
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

          return { applicationId: application.id, weddingId: wedding.id, username, activeAt };
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
    const updated = await transaction.bookingApplication.updateMany({
      where: { id: applicationId, status: "ONAY_BEKLIYOR", deletedAt: null },
      data: {
        status: "REDDEDILDI",
        paymentFlowTokenHash: null,
        rejectionReason: reason,
        reviewedAt: new Date(),
        reviewedById: actorUserId
      }
    });
    if (updated.count !== 1) {
      throw new AppError("Başvuru bulunamadı veya artık onay beklemiyor.", 409);
    }
    await createAudit(transaction, {
      actorUserId,
      action: "booking.rejected",
      targetType: "BookingApplication",
      targetId: applicationId,
      correlationId,
      metadata: { reason }
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

export { createAudit };
