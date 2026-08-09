-- Core müşteri PII için kesintisiz nullable expand şeması.
ALTER TABLE "booking_applications"
  ALTER COLUMN "brideFirstName" DROP NOT NULL,
  ALTER COLUMN "brideLastName" DROP NOT NULL,
  ALTER COLUMN "bridePhone" DROP NOT NULL,
  ALTER COLUMN "groomFirstName" DROP NOT NULL,
  ALTER COLUMN "groomLastName" DROP NOT NULL,
  ALTER COLUMN "groomPhone" DROP NOT NULL,
  ALTER COLUMN "primaryEmail" DROP NOT NULL,
  ADD COLUMN "piiCiphertext" TEXT,
  ADD COLUMN "piiIv" TEXT,
  ADD COLUMN "piiAuthTag" TEXT,
  ADD COLUMN "piiKeyId" TEXT,
  ADD COLUMN "piiEncryptionVersion" INTEGER,
  ADD COLUMN "piiSchemaVersion" INTEGER,
  ADD COLUMN "piiRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "primaryEmailBlindIndex" CHAR(64),
  ADD COLUMN "bridePhoneBlindIndex" CHAR(64),
  ADD COLUMN "groomPhoneBlindIndex" CHAR(64);

ALTER TABLE "weddings"
  ALTER COLUMN "brideFirstName" DROP NOT NULL,
  ALTER COLUMN "brideLastName" DROP NOT NULL,
  ALTER COLUMN "bridePhone" DROP NOT NULL,
  ALTER COLUMN "groomFirstName" DROP NOT NULL,
  ALTER COLUMN "groomLastName" DROP NOT NULL,
  ALTER COLUMN "groomPhone" DROP NOT NULL,
  ALTER COLUMN "primaryEmail" DROP NOT NULL,
  ADD COLUMN "piiCiphertext" TEXT,
  ADD COLUMN "piiIv" TEXT,
  ADD COLUMN "piiAuthTag" TEXT,
  ADD COLUMN "piiKeyId" TEXT,
  ADD COLUMN "piiEncryptionVersion" INTEGER,
  ADD COLUMN "piiSchemaVersion" INTEGER,
  ADD COLUMN "piiRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "primaryEmailBlindIndex" CHAR(64),
  ADD COLUMN "bridePhoneBlindIndex" CHAR(64),
  ADD COLUMN "groomPhoneBlindIndex" CHAR(64);

ALTER TABLE "message_tasks"
  ALTER COLUMN "recipientPhone" DROP NOT NULL,
  ADD COLUMN "piiCiphertext" TEXT,
  ADD COLUMN "piiIv" TEXT,
  ADD COLUMN "piiAuthTag" TEXT,
  ADD COLUMN "piiKeyId" TEXT,
  ADD COLUMN "piiEncryptionVersion" INTEGER,
  ADD COLUMN "piiSchemaVersion" INTEGER,
  ADD COLUMN "piiRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "recipientPhoneBlindIndex" CHAR(64);

ALTER TABLE "booking_applications"
  ADD CONSTRAINT "booking_applications_pii_envelope_check"
  CHECK (
    (
      "piiCiphertext" IS NULL
      AND "piiIv" IS NULL
      AND "piiAuthTag" IS NULL
      AND "piiKeyId" IS NULL
      AND "piiEncryptionVersion" IS NULL
      AND "piiSchemaVersion" IS NULL
      AND "primaryEmailBlindIndex" IS NULL
      AND "bridePhoneBlindIndex" IS NULL
      AND "groomPhoneBlindIndex" IS NULL
      AND "piiRevision" = 0
    )
    OR
    (
      "piiCiphertext" IS NOT NULL
      AND "piiIv" IS NOT NULL
      AND "piiAuthTag" IS NOT NULL
      AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      AND "piiEncryptionVersion" = 3
      AND "piiSchemaVersion" = 1
      AND "primaryEmailBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "bridePhoneBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "groomPhoneBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "piiRevision" >= 1
    )
  ) NOT VALID;

ALTER TABLE "weddings"
  ADD CONSTRAINT "weddings_pii_envelope_check"
  CHECK (
    (
      "piiCiphertext" IS NULL
      AND "piiIv" IS NULL
      AND "piiAuthTag" IS NULL
      AND "piiKeyId" IS NULL
      AND "piiEncryptionVersion" IS NULL
      AND "piiSchemaVersion" IS NULL
      AND "primaryEmailBlindIndex" IS NULL
      AND "bridePhoneBlindIndex" IS NULL
      AND "groomPhoneBlindIndex" IS NULL
      AND "piiRevision" = 0
    )
    OR
    (
      "piiCiphertext" IS NOT NULL
      AND "piiIv" IS NOT NULL
      AND "piiAuthTag" IS NOT NULL
      AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      AND "piiEncryptionVersion" = 3
      AND "piiSchemaVersion" = 1
      AND "primaryEmailBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "bridePhoneBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "groomPhoneBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "piiRevision" >= 1
    )
  ) NOT VALID;

ALTER TABLE "message_tasks"
  ADD CONSTRAINT "message_tasks_pii_envelope_check"
  CHECK (
    (
      "piiCiphertext" IS NULL
      AND "piiIv" IS NULL
      AND "piiAuthTag" IS NULL
      AND "piiKeyId" IS NULL
      AND "piiEncryptionVersion" IS NULL
      AND "piiSchemaVersion" IS NULL
      AND "recipientPhoneBlindIndex" IS NULL
      AND "piiRevision" = 0
    )
    OR
    (
      "piiCiphertext" IS NOT NULL
      AND "piiIv" IS NOT NULL
      AND "piiAuthTag" IS NOT NULL
      AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      AND "piiEncryptionVersion" = 3
      AND "piiSchemaVersion" = 1
      AND "recipientPhoneBlindIndex" ~ '^[0-9a-f]{64}$'
      AND "piiRevision" >= 1
    )
  ) NOT VALID;

-- Exact blind-index sorguları yalnız aktif kayıtları kapsar.
CREATE INDEX "booking_applications_email_blind_active_idx"
  ON "booking_applications"("primaryEmailBlindIndex")
  WHERE "deletedAt" IS NULL AND "primaryEmailBlindIndex" IS NOT NULL;
CREATE INDEX "booking_applications_bride_phone_blind_active_idx"
  ON "booking_applications"("bridePhoneBlindIndex")
  WHERE "deletedAt" IS NULL AND "bridePhoneBlindIndex" IS NOT NULL;
CREATE INDEX "booking_applications_groom_phone_blind_active_idx"
  ON "booking_applications"("groomPhoneBlindIndex")
  WHERE "deletedAt" IS NULL AND "groomPhoneBlindIndex" IS NOT NULL;
CREATE INDEX "weddings_email_blind_active_idx"
  ON "weddings"("primaryEmailBlindIndex")
  WHERE "deletedAt" IS NULL AND "primaryEmailBlindIndex" IS NOT NULL;
CREATE INDEX "weddings_bride_phone_blind_active_idx"
  ON "weddings"("bridePhoneBlindIndex")
  WHERE "deletedAt" IS NULL AND "bridePhoneBlindIndex" IS NOT NULL;
CREATE INDEX "weddings_groom_phone_blind_active_idx"
  ON "weddings"("groomPhoneBlindIndex")
  WHERE "deletedAt" IS NULL AND "groomPhoneBlindIndex" IS NOT NULL;
CREATE INDEX "message_tasks_recipient_phone_blind_idx"
  ON "message_tasks"("recipientPhoneBlindIndex")
  WHERE "recipientPhoneBlindIndex" IS NOT NULL;

-- Global stale payment-flow sweep sorgusuyla birebir örtüşen bounded index.
CREATE INDEX "booking_applications_expiry_sweep_idx"
  ON "booking_applications"("paymentFlowExpiresAt", "id")
  WHERE "source" = 'PUBLIC_FORM'
    AND "status" = 'ONAY_BEKLIYOR'
    AND "deletedAt" IS NULL
    AND "paymentFlowExpiredAt" IS NULL;
