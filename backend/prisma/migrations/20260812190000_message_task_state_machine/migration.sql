ALTER TABLE "message_tasks"
  DROP CONSTRAINT IF EXISTS "message_tasks_sent_state_check";

ALTER TABLE "message_tasks"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TYPE "MessageStatus" RENAME TO "MessageStatus_old";
CREATE TYPE "MessageStatus" AS ENUM (
  'PLANNED',
  'PREPARED',
  'READY_TO_SEND',
  'SENT',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP');
ALTER TABLE "message_tasks"
  ALTER COLUMN "status" TYPE "MessageStatus"
  USING (
    CASE "status"::TEXT
      WHEN 'PENDING' THEN 'PLANNED'
      ELSE "status"::TEXT
    END
  )::"MessageStatus";
DROP TYPE "MessageStatus_old";
ALTER TABLE "message_tasks"
  ALTER COLUMN "status" SET DEFAULT 'PLANNED';

ALTER TYPE "MessageKind" RENAME TO "MessageKind_old";
CREATE TYPE "MessageKind" AS ENUM (
  'APPLICATION_APPROVED',
  'APPLICATION_REJECTED',
  'ACCOUNT_ACTIVATION',
  'PREPARATION_UPDATE',
  'DELIVERY_READY',
  'PASSWORD_RESET'
);
ALTER TABLE "message_tasks"
  ALTER COLUMN "kind" TYPE "MessageKind"
  USING "kind"::TEXT::"MessageKind";
DROP TYPE "MessageKind_old";

ALTER TABLE "message_tasks"
  ALTER COLUMN "weddingId" DROP NOT NULL,
  ADD COLUMN "applicationId" TEXT,
  ADD COLUMN "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP',
  ADD COLUMN "preparedAt" TIMESTAMP(3),
  ADD COLUMN "preparedMessageCiphertext" TEXT,
  ADD COLUMN "preparedMessageIv" TEXT,
  ADD COLUMN "preparedMessageAuthTag" TEXT,
  ADD COLUMN "readyAt" TIMESTAMP(3),
  ADD COLUMN "failedAt" TIMESTAMP(3),
  ADD COLUMN "failureReason" TEXT,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "earlyOverrideAt" TIMESTAMP(3),
  ADD COLUMN "earlyOverrideReason" TEXT,
  ADD COLUMN "earlyOverrideById" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledReason" TEXT,
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "preparedTokenId" TEXT;

UPDATE "message_tasks"
SET "preparedAt" = COALESCE("sentAt", "updatedAt"),
    "readyAt" = COALESCE("sentAt", "updatedAt"),
    "attemptCount" = 1,
    "lastAttemptAt" = "sentAt"
WHERE "status" = 'SENT';

UPDATE "message_tasks"
SET "cancelledAt" = COALESCE("updatedAt", "createdAt"),
    "cancelledReason" = 'legacy_cancelled'
WHERE "status" = 'CANCELLED';

CREATE UNIQUE INDEX "message_tasks_applicationId_kind_key"
  ON "message_tasks"("applicationId", "kind");
CREATE INDEX "message_tasks_applicationId_idx"
  ON "message_tasks"("applicationId");
CREATE UNIQUE INDEX "message_tasks_preparedTokenId_key"
  ON "message_tasks"("preparedTokenId");
CREATE INDEX "message_tasks_earlyOverrideById_idx"
  ON "message_tasks"("earlyOverrideById");
CREATE INDEX "message_tasks_cancelledById_idx"
  ON "message_tasks"("cancelledById");

ALTER TABLE "message_tasks"
  ADD CONSTRAINT "message_tasks_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "booking_applications"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "message_tasks_preparedTokenId_fkey"
  FOREIGN KEY ("preparedTokenId") REFERENCES "password_setup_tokens"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "message_tasks_earlyOverrideById_fkey"
  FOREIGN KEY ("earlyOverrideById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "message_tasks_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "message_tasks_parent_check"
  CHECK (
    (
      "weddingId" IS NOT NULL
      AND "applicationId" IS NULL
      AND "kind" NOT IN ('APPLICATION_APPROVED', 'APPLICATION_REJECTED')
    )
    OR
    (
      "weddingId" IS NULL
      AND "applicationId" IS NOT NULL
      AND "kind" IN ('APPLICATION_APPROVED', 'APPLICATION_REJECTED')
    )
  ),
  ADD CONSTRAINT "message_tasks_attempt_count_check"
  CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "message_tasks_prepared_message_check"
  CHECK (
    (
      "preparedMessageCiphertext" IS NULL
      AND "preparedMessageIv" IS NULL
      AND "preparedMessageAuthTag" IS NULL
    )
    OR (
      "preparedMessageCiphertext" IS NOT NULL
      AND "preparedMessageIv" IS NOT NULL
      AND "preparedMessageAuthTag" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "message_tasks_override_check"
  CHECK (
    ("earlyOverrideAt" IS NULL AND "earlyOverrideReason" IS NULL AND "earlyOverrideById" IS NULL)
    OR (
      "earlyOverrideAt" IS NOT NULL
      AND "earlyOverrideReason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("earlyOverrideReason")) BETWEEN 3 AND 500
      AND "earlyOverrideById" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "message_tasks_cancel_check"
  CHECK (
    (
      "status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL
      AND "cancelledReason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("cancelledReason")) BETWEEN 3 AND 500
    )
    OR (
      "status" <> 'CANCELLED' AND "cancelledAt" IS NULL
      AND "cancelledReason" IS NULL AND "cancelledById" IS NULL
    )
  ),
  ADD CONSTRAINT "message_tasks_failure_reason_check"
  CHECK (
    (
      "status" = 'FAILED'
      AND "failureReason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("failureReason")) BETWEEN 3 AND 500
    )
    OR ("status" <> 'FAILED' AND "failureReason" IS NULL)
  ),
  ADD CONSTRAINT "message_tasks_state_check"
  CHECK (
    (
      "status" = 'PLANNED'
      AND "preparedAt" IS NULL AND "readyAt" IS NULL
      AND "failedAt" IS NULL AND "sentAt" IS NULL AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'PREPARED'
      AND "preparedAt" IS NOT NULL AND "readyAt" IS NULL
      AND "failedAt" IS NULL AND "sentAt" IS NULL AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'READY_TO_SEND'
      AND "preparedAt" IS NOT NULL AND "readyAt" IS NOT NULL
      AND "failedAt" IS NULL AND "sentAt" IS NULL AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'SENT'
      AND "preparedAt" IS NOT NULL AND "readyAt" IS NOT NULL
      AND "failedAt" IS NULL AND "sentAt" IS NOT NULL AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'FAILED'
      AND "failedAt" IS NOT NULL AND "sentAt" IS NULL AND "cancelledAt" IS NULL
    )
    OR
    (
      "status" = 'CANCELLED'
      AND "failedAt" IS NULL AND "sentAt" IS NULL AND "cancelledAt" IS NOT NULL
    )
  );

DROP POLICY "message_tasks_access" ON public.message_tasks;
CREATE POLICY message_tasks_access ON public.message_tasks FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_wedding_allowed("weddingId")
  OR public.app_application_allowed("applicationId")
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_wedding_allowed("weddingId")
  OR public.app_application_allowed("applicationId")
);

ALTER TABLE "deliveries"
  ADD COLUMN "accessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedById" TEXT,
  ADD COLUMN "revocationReason" TEXT,
  ADD CONSTRAINT "deliveries_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "deliveries_revocation_check"
  CHECK (
    ("revokedAt" IS NULL AND "revokedById" IS NULL AND "revocationReason" IS NULL)
    OR (
      "revokedAt" IS NOT NULL
      AND "revocationReason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("revocationReason")) BETWEEN 3 AND 500
    )
  ),
  ADD CONSTRAINT "deliveries_access_expiry_check"
  CHECK (
    "accessExpiresAt" IS NULL
    OR ("releasedAt" IS NOT NULL AND "accessExpiresAt" > "releasedAt")
  );

CREATE INDEX "deliveries_revokedById_idx" ON "deliveries"("revokedById");
