ALTER TABLE "booking_applications"
ADD COLUMN "paymentNotificationChannel" TEXT,
ADD COLUMN "paymentNotificationRequestedAt" TIMESTAMP(3);

CREATE INDEX "booking_applications_paymentNotificationRequestedAt_idx"
ON "booking_applications"("paymentNotificationRequestedAt");
