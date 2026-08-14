import { randomUUID } from "node:crypto";
import { prisma } from "../config/prisma.js";
import { createAudit } from "./booking.service.js";
import { AppError } from "../utils/appError.js";
import { decryptDeliveryDriveUrl } from "../utils/delivery-crypto.js";
import {
  verifyGoogleDriveLinkAccess,
  type DeliveryLinkAccessResult
} from "../utils/delivery-link-access.js";
import { buildMessageTaskPiiData, decryptWeddingPii } from "../utils/pii-crypto.js";

const deliveryAccessTtlMs = 30 * 24 * 60 * 60 * 1_000;

export type DeliveryLinkAccessVerifier = (value: string) => Promise<DeliveryLinkAccessResult>;

type ReleaseDeliveryInput = {
  deliveryId: string;
  actorUserId: string;
  correlationId: string;
  sharingConfirmed: true;
  verifyLink?: DeliveryLinkAccessVerifier;
};

export const releaseDelivery = async ({
  deliveryId,
  actorUserId,
  correlationId,
  sharingConfirmed,
  verifyLink = verifyGoogleDriveLinkAccess
}: ReleaseDeliveryInput) => {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: { wedding: true }
  });
  if (!delivery) throw new AppError("Teslimat kaydı bulunamadı.", 404);
  if (delivery.wedding.cancelledAt || delivery.wedding.deletedAt) {
    throw new AppError("İptal edilmiş veya arşivdeki düğünün teslimatı yayınlanamaz.", 409);
  }
  if (delivery.status !== "TESLIME_HAZIR") {
    throw new AppError("Teslimat önce “Teslime Hazır” durumuna alınmalıdır.", 409);
  }
  if (!delivery.driveUrlCiphertext || !delivery.driveUrlIv || !delivery.driveUrlAuthTag) {
    throw new AppError("Teslim etmeden önce Google Drive bağlantısı kaydedilmelidir.", 409);
  }
  const driveUrl = decryptDeliveryDriveUrl(delivery);
  if (!driveUrl) throw new AppError("Teslimat bağlantısı çözülemedi.", 409);
  const linkAccess = await verifyLink(driveUrl);

  const now = new Date();
  const accessExpiresAt = new Date(now.valueOf() + deliveryAccessTtlMs);
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "weddings"
      WHERE "id" = ${delivery.weddingId}
      FOR UPDATE
    `;
    const currentWedding = await transaction.wedding.findUniqueOrThrow({
      where: { id: delivery.weddingId }
    });
    if (currentWedding.cancelledAt || currentWedding.deletedAt) {
      throw new AppError("İptal edilmiş veya arşivdeki düğünün teslimatı yayınlanamaz.", 409);
    }
    const currentWeddingPii = decryptWeddingPii(currentWedding.id, currentWedding);
    const recipientPhone =
      currentWedding.primaryContact === "GELIN"
        ? currentWeddingPii.bridePhone
        : currentWeddingPii.groomPhone;
    const claimed = await transaction.delivery.updateMany({
      where: {
        id: delivery.id,
        status: "TESLIME_HAZIR",
        releasedAt: null,
        updatedAt: delivery.updatedAt
      },
      data: {
        status: "TESLIM_EDILDI",
        releasedAt: now,
        accessExpiresAt,
        revokedAt: null,
        revokedById: null,
        revocationReason: null
      }
    });
    if (claimed.count !== 1) {
      throw new AppError("Teslimat başka bir işlemde güncellendi.", 409);
    }
    const history = await transaction.deliveryStatusHistory.createMany({
      data: {
        deliveryId: delivery.id,
        fromStatus: delivery.status,
        toStatus: "TESLIM_EDILDI",
        actorUserId
      }
    });
    if (history.count !== 1) throw new Error("Teslimat geçmişi oluşturulamadı.");
    const existingDeliveryTask = await transaction.messageTask.findUnique({
      where: {
        weddingId_kind: {
          weddingId: delivery.weddingId,
          kind: "DELIVERY_READY"
        }
      }
    });
    if (existingDeliveryTask) {
      await transaction.messageTask.update({
        where: {
          id: existingDeliveryTask.id,
          piiRevision: existingDeliveryTask.piiRevision
        },
        data: {
          ...buildMessageTaskPiiData(
            existingDeliveryTask.id,
            { recipientPhone },
            existingDeliveryTask.piiRevision + 1
          ),
          status: "PLANNED",
          preparedAt: null,
          readyAt: null,
          failedAt: null,
          failureReason: null,
          nextAttemptAt: null,
          attemptCount: 0,
          lastAttemptAt: null,
          preparedTokenId: null,
          preparedMessageCiphertext: null,
          preparedMessageIv: null,
          preparedMessageAuthTag: null,
          earlyOverrideAt: null,
          earlyOverrideReason: null,
          earlyOverrideById: null,
          cancelledAt: null,
          cancelledReason: null,
          cancelledById: null,
          dueAt: now,
          sentAt: null,
          sentById: null
        }
      });
    } else {
      const deliveryTaskId = randomUUID();
      await transaction.messageTask.create({
        data: {
          id: deliveryTaskId,
          weddingId: delivery.weddingId,
          kind: "DELIVERY_READY",
          dueAt: now,
          ...buildMessageTaskPiiData(deliveryTaskId, { recipientPhone }, 1)
        }
      });
    }
    await createAudit(transaction, {
      actorUserId,
      action: "delivery.released",
      targetType: "Delivery",
      targetId: delivery.id,
      correlationId,
      metadata: {
        sharingConfirmed,
        sharingConfirmation: "verified_by_operator",
        accessExpiresAt,
        linkSmokeStatus: linkAccess.status,
        redirectHost: linkAccess.redirectHost
      }
    });
    return transaction.delivery.findUniqueOrThrow({
      where: { id: delivery.id },
      select: {
        id: true,
        status: true,
        dueDate: true,
        releasedAt: true,
        accessExpiresAt: true,
        revokedAt: true,
        updatedAt: true
      }
    });
  });
};
