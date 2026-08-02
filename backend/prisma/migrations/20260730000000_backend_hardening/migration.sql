-- Veri bütünlüğü ve şifreleme bağlamı alanları
ALTER TABLE "users"
  ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);

ALTER TABLE "booking_applications"
  ADD COLUMN "idempotencyFingerprint" TEXT;

ALTER TABLE "deliveries"
  ADD COLUMN "encryptionVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "message_tasks"
  ADD COLUMN "encryptionVersion" INTEGER NOT NULL DEFAULT 1;

UPDATE "users"
SET "temporaryPasswordExpiresAt" =
  GREATEST(COALESCE("activeAt", CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
  + INTERVAL '72 hours'
WHERE "mustChangePassword" = true
  AND "temporaryPasswordExpiresAt" IS NULL;

UPDATE "booking_applications"
SET "idempotencyFingerprint" = repeat('0', 64)
WHERE "idempotencyKey" IS NOT NULL
  AND "idempotencyFingerprint" IS NULL;

ALTER TABLE "deliveries"
  ALTER COLUMN "encryptionVersion" SET DEFAULT 2;

ALTER TABLE "message_tasks"
  ALTER COLUMN "encryptionVersion" SET DEFAULT 2;

-- Para, zaman ve durum invariantları
ALTER TABLE "users"
  ALTER COLUMN "mustChangePassword" DROP DEFAULT;

ALTER TABLE "users"
  ADD CONSTRAINT "users_temporary_password_expiry_check"
  CHECK (
    (
      "mustChangePassword" = true
      AND "temporaryPasswordExpiresAt" IS NOT NULL
    )
    OR
    (
      "mustChangePassword" = false
      AND "temporaryPasswordExpiresAt" IS NULL
    )
  );

ALTER TABLE "packages"
  ADD CONSTRAINT "packages_priceCents_check"
  CHECK ("priceCents" BETWEEN 0 AND 100000000);

ALTER TABLE "services"
  ADD CONSTRAINT "services_priceCents_check"
  CHECK ("priceCents" BETWEEN 0 AND 100000000);

ALTER TABLE "booking_application_services"
  ADD CONSTRAINT "booking_application_services_priceCents_check"
  CHECK ("priceCents" BETWEEN 0 AND 100000000);

ALTER TABLE "booking_applications"
  ADD CONSTRAINT "booking_applications_prices_check"
  CHECK (
    "packagePriceCents" BETWEEN 0 AND 100000000
    AND "totalPriceCents" >= 0
    AND "payableNowCents" BETWEEN 0 AND "totalPriceCents"
    AND (
      (
        "paymentMethod" = 'CASH'
        AND "payableNowCents" = "totalPriceCents"
      )
      OR
      (
        "paymentMethod" = 'DEPOSIT'
        AND "payableNowCents" = LEAST(500000, "totalPriceCents")
      )
    )
  ),
  ADD CONSTRAINT "booking_applications_wedding_range_check"
  CHECK (
    "weddingEndsAt" > "weddingStartsAt"
    AND "weddingEndsAt" <= "weddingStartsAt" + INTERVAL '36 hours'
  ),
  ADD CONSTRAINT "booking_applications_public_consent_check"
  CHECK ("source" <> 'PUBLIC_FORM' OR "privacyConsentAt" IS NOT NULL),
  ADD CONSTRAINT "booking_applications_review_state_check"
  CHECK (
    (
      "status" = 'ONAY_BEKLIYOR'
      AND "reviewedAt" IS NULL
      AND "reviewedById" IS NULL
      AND "rejectionReason" IS NULL
    )
    OR
    (
      "status" = 'ONAYLANDI'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "rejectionReason" IS NULL
    )
    OR
    (
      "status" = 'REDDEDILDI'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "rejectionReason" IS NOT NULL
    )
    OR
    (
      "status" = 'IPTAL_EDILDI'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "booking_applications_idempotency_fingerprint_check"
  CHECK (
    (
      "idempotencyKey" IS NULL
      AND "idempotencyFingerprint" IS NULL
    )
    OR
    (
      "idempotencyKey" IS NOT NULL
      AND "idempotencyFingerprint" ~ '^[0-9a-f]{64}$'
    )
  );

ALTER TABLE "weddings"
  ADD CONSTRAINT "weddings_range_check"
  CHECK (
    "endsAt" > "startsAt"
    AND "endsAt" <= "startsAt" + INTERVAL '36 hours'
  );

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_expiry_check"
  CHECK ("expiresAt" > "createdAt");

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_encryption_version_check"
  CHECK ("encryptionVersion" IN (1, 2)),
  ADD CONSTRAINT "deliveries_drive_url_parts_check"
  CHECK (
    (
      "driveUrlCiphertext" IS NULL
      AND "driveUrlIv" IS NULL
      AND "driveUrlAuthTag" IS NULL
    )
    OR
    (
      "driveUrlCiphertext" IS NOT NULL
      AND "driveUrlIv" IS NOT NULL
      AND "driveUrlAuthTag" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "deliveries_release_state_check"
  CHECK (
    (
      "status" = 'TESLIM_EDILDI'
      AND "releasedAt" IS NOT NULL
      AND "driveUrlCiphertext" IS NOT NULL
      AND "driveUrlIv" IS NOT NULL
      AND "driveUrlAuthTag" IS NOT NULL
    )
    OR
    (
      "status" <> 'TESLIM_EDILDI'
      AND "releasedAt" IS NULL
    )
  );

ALTER TABLE "delivery_status_history"
  ADD CONSTRAINT "delivery_status_history_transition_check"
  CHECK ("fromStatus" IS NULL OR "fromStatus" <> "toStatus");

ALTER TABLE "message_tasks"
  ADD CONSTRAINT "message_tasks_encryption_version_check"
  CHECK ("encryptionVersion" IN (1, 2)),
  ADD CONSTRAINT "message_tasks_secret_parts_check"
  CHECK (
    (
      "secretCiphertext" IS NULL
      AND "secretIv" IS NULL
      AND "secretAuthTag" IS NULL
    )
    OR
    (
      "secretCiphertext" IS NOT NULL
      AND "secretIv" IS NOT NULL
      AND "secretAuthTag" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "message_tasks_sent_state_check"
  CHECK (
    (
      "status" = 'SENT'
      AND "sentAt" IS NOT NULL
      AND "secretCiphertext" IS NULL
      AND "secretIv" IS NULL
      AND "secretAuthTag" IS NULL
    )
    OR
    ("status" <> 'SENT' AND "sentAt" IS NULL)
  ),
  ADD CONSTRAINT "message_tasks_pending_secret_check"
  CHECK (
    "status" <> 'PENDING'
    OR "kind" NOT IN ('ACCOUNT_ACTIVATION', 'PASSWORD_RESET')
    OR (
      "secretCiphertext" IS NOT NULL
      AND "secretIv" IS NOT NULL
      AND "secretAuthTag" IS NOT NULL
    )
  );

-- Foreign key tarafındaki eksik leading indeksler
CREATE INDEX "booking_applications_packageId_idx"
  ON "booking_applications"("packageId");
CREATE INDEX "booking_applications_reviewedById_idx"
  ON "booking_applications"("reviewedById");
CREATE INDEX "booking_application_services_serviceId_idx"
  ON "booking_application_services"("serviceId");
CREATE INDEX "delivery_status_history_actorUserId_idx"
  ON "delivery_status_history"("actorUserId");
CREATE INDEX "message_tasks_sentById_idx"
  ON "message_tasks"("sentById");
CREATE INDEX "auth_sessions_revokedAt_idx"
  ON "auth_sessions"("revokedAt");

ALTER TABLE "booking_applications"
  DROP CONSTRAINT "booking_applications_reviewedById_fkey",
  ADD CONSTRAINT "booking_applications_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
