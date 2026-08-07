DROP INDEX IF EXISTS "booking_applications_paymentNotificationRequestedAt_idx";

ALTER TABLE "booking_applications"
RENAME COLUMN "paymentNotificationRequestedAt" TO "whatsappHandoffAt";

ALTER TABLE "booking_applications"
ADD COLUMN "paymentFlowTokenHash" TEXT,
ADD COLUMN "paymentFlowExpiresAt" TIMESTAMP(3),
ADD COLUMN "paymentFlowExpiredAt" TIMESTAMP(3);

ALTER TABLE "booking_applications"
DROP CONSTRAINT "booking_applications_review_state_check",
ADD CONSTRAINT "booking_applications_review_state_check"
CHECK (
  (
    "status" = 'ONAY_BEKLIYOR'
    AND "reviewedAt" IS NULL
    AND "reviewedById" IS NULL
    AND "rejectionReason" IS NULL
    AND "paymentFlowExpiredAt" IS NULL
  )
  OR
  (
    "status" = 'ONAYLANDI'
    AND "reviewedAt" IS NOT NULL
    AND "reviewedById" IS NOT NULL
    AND "rejectionReason" IS NULL
    AND "paymentFlowExpiredAt" IS NULL
  )
  OR
  (
    "status" = 'REDDEDILDI'
    AND "reviewedAt" IS NOT NULL
    AND "reviewedById" IS NOT NULL
    AND "rejectionReason" IS NOT NULL
    AND "paymentFlowExpiredAt" IS NULL
  )
  OR
  (
    "status" = 'IPTAL_EDILDI'
    AND (
      ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
      OR
      (
        "paymentFlowExpiredAt" IS NOT NULL
        AND "reviewedAt" IS NULL
        AND "reviewedById" IS NULL
        AND "rejectionReason" IS NULL
      )
    )
  )
);

-- Eski alan oluşturma anında dolduruluyordu ve gerçek bir WhatsApp geçişini kanıtlamıyordu.
UPDATE "booking_applications"
SET "whatsappHandoffAt" = NULL,
    "paymentNotificationChannel" = NULL;

CREATE INDEX "booking_applications_status_whatsappHandoffAt_paymentFlowExpiresAt_idx"
ON "booking_applications"("status", "whatsappHandoffAt", "paymentFlowExpiresAt");
