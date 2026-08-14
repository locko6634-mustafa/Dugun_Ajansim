import { Prisma, type DeliveryStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { addCalendarDays, getIstanbulDate } from "../utils/domain.js";
import { writeAuditLog } from "../utils/audit.js";

type AutomaticDeliveryStatus = Extract<DeliveryStatus, "HAZIRLANIYOR" | "MONTAJ" | "KONTROL">;

export const deliveryAutomationPolicy = Object.freeze({
  montageDaysAfterWedding: 5,
  controlDaysAfterWedding: 8,
  driveLinkReminderDaysBeforeDue: 2
});

export const getAutomaticDeliveryStatus = (
  weddingStartsAt: Date,
  now = new Date()
): AutomaticDeliveryStatus => {
  const weddingDate = getIstanbulDate(weddingStartsAt);
  const today = getIstanbulDate(now);
  if (today >= addCalendarDays(weddingDate, deliveryAutomationPolicy.controlDaysAfterWedding)) {
    return "KONTROL";
  }
  if (today >= addCalendarDays(weddingDate, deliveryAutomationPolicy.montageDaysAfterWedding)) {
    return "MONTAJ";
  }
  return "HAZIRLANIYOR";
};

const utcCalendarDay = (date: string): number =>
  new Date(`${date}T12:00:00.000Z`).valueOf() / 86_400_000;

export const getDriveLinkReminderDays = (dueDate: Date, now = new Date()): number | null => {
  const daysUntilDue =
    utcCalendarDay(dueDate.toISOString().slice(0, 10)) - utcCalendarDay(getIstanbulDate(now));
  return daysUntilDue >= 0 &&
    daysUntilDue <= deliveryAutomationPolicy.driveLinkReminderDaysBeforeDue
    ? daysUntilDue
    : null;
};

export const getAdminDeliveryTransitions = (status: DeliveryStatus): readonly DeliveryStatus[] =>
  status === "KONTROL" ? ["TESLIME_HAZIR"] : [];

export type DeliveryAutomationMetrics = {
  candidateCount: number;
  updatedCount: number;
  skippedCount: number;
};

export const synchronizeAutomaticDeliveryStatuses = async (
  now = new Date()
): Promise<DeliveryAutomationMetrics> => {
  const candidates = await prisma.delivery.findMany({
    where: {
      status: { in: ["HAZIRLANIYOR", "MONTAJ"] },
      manualStatusOverrideAt: null,
      releasedAt: null,
      wedding: { cancelledAt: null, deletedAt: null }
    },
    select: {
      id: true,
      status: true,
      updatedAt: true,
      wedding: { select: { startsAt: true } }
    }
  });

  let updatedCount = 0;
  let skippedCount = 0;
  for (const delivery of candidates) {
    const nextStatus = getAutomaticDeliveryStatus(delivery.wedding.startsAt, now);
    if (nextStatus === delivery.status) continue;

    const updated = await prisma.$transaction(async (transaction) => {
      const claimed = await transaction.delivery.updateMany({
        where: {
          id: delivery.id,
          status: delivery.status,
          manualStatusOverrideAt: null,
          updatedAt: delivery.updatedAt,
          releasedAt: null,
          wedding: { cancelledAt: null, deletedAt: null }
        },
        data: { status: nextStatus }
      });
      if (claimed.count !== 1) return false;

      await transaction.deliveryStatusHistory.create({
        data: {
          deliveryId: delivery.id,
          fromStatus: delivery.status,
          toStatus: nextStatus,
          reason: "Düğün tarihine göre otomatik durum güncellemesi."
        }
      });
      await writeAuditLog(transaction, {
        data: {
          action: "delivery.status_automated",
          targetType: "Delivery",
          targetId: delivery.id,
          correlationId: `delivery-automation-${randomUUID()}`,
          metadata: {
            fromStatus: delivery.status,
            toStatus: nextStatus,
            weddingDate: getIstanbulDate(delivery.wedding.startsAt),
            evaluatedDate: getIstanbulDate(now)
          } satisfies Prisma.InputJsonValue
        }
      });
      return true;
    });

    if (updated) updatedCount += 1;
    else skippedCount += 1;
  }

  return { candidateCount: candidates.length, updatedCount, skippedCount };
};
