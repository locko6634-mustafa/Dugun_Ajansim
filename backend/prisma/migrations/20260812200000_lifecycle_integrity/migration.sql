BEGIN;

ALTER TABLE "weddings"
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "cancelledById" TEXT,
  ADD COLUMN "cancelledByRole" "UserRole",
  ADD COLUMN "reinstatedAt" TIMESTAMP(3),
  ADD COLUMN "reinstatedById" TEXT,
  ADD COLUMN "reinstatementReason" TEXT;

ALTER TABLE "delivery_status_history"
  ADD COLUMN "reason" TEXT;

ALTER TABLE "weddings"
  ADD CONSTRAINT "weddings_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "weddings_reinstatedById_fkey"
  FOREIGN KEY ("reinstatedById") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "weddings_cancellation_state_check"
  CHECK (
    (
      "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
      AND "cancelledById" IS NULL
      AND "cancelledByRole" IS NULL
    )
    OR
    (
      "cancelledAt" IS NOT NULL
      AND "cancelledAt" >= "createdAt"
      AND "cancellationReason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("cancellationReason")) BETWEEN 3 AND 500
      AND "cancelledById" IS NOT NULL
      AND "cancelledByRole" IS NOT NULL
      AND "cancelledByRole" IN ('ADMIN', 'SALON_YETKILISI')
      AND "reinstatedAt" IS NULL
      AND "reinstatedById" IS NULL
      AND "reinstatementReason" IS NULL
    )
  ) NOT VALID,
  ADD CONSTRAINT "weddings_reinstatement_state_check"
  CHECK (
    (
      "reinstatedAt" IS NULL
      AND "reinstatedById" IS NULL
      AND "reinstatementReason" IS NULL
    )
    OR
    (
      "reinstatedAt" IS NOT NULL
      AND "reinstatedAt" >= "createdAt"
      AND "reinstatedById" IS NOT NULL
      AND "reinstatementReason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("reinstatementReason")) BETWEEN 3 AND 500
      AND "cancelledAt" IS NULL
      AND "cancellationReason" IS NULL
      AND "cancelledById" IS NULL
      AND "cancelledByRole" IS NULL
    )
  ) NOT VALID;

ALTER TABLE "delivery_status_history"
  ADD CONSTRAINT "delivery_status_history_reason_check"
  CHECK (
    "reason" IS NULL
    OR (
      "reason" IS NOT NULL
      AND CHAR_LENGTH(BTRIM("reason")) BETWEEN 3 AND 500
    )
  ) NOT VALID;

ALTER TABLE "weddings"
  VALIDATE CONSTRAINT "weddings_cancellation_state_check",
  VALIDATE CONSTRAINT "weddings_reinstatement_state_check";

ALTER TABLE "delivery_status_history"
  VALIDATE CONSTRAINT "delivery_status_history_reason_check";

CREATE INDEX "booking_applications_createdAt_id_idx"
  ON "booking_applications"("createdAt" DESC, "id" DESC);
CREATE INDEX "weddings_startsAt_id_idx"
  ON "weddings"("startsAt" DESC, "id" DESC);
CREATE INDEX "message_tasks_dueAt_id_idx"
  ON "message_tasks"("dueAt" ASC, "id" ASC);
CREATE INDEX "weddings_cancelledAt_idx" ON "weddings"("cancelledAt");
CREATE INDEX "weddings_cancelledById_idx" ON "weddings"("cancelledById");
CREATE INDEX "weddings_reinstatedAt_idx" ON "weddings"("reinstatedAt");
CREATE INDEX "weddings_reinstatedById_idx" ON "weddings"("reinstatedById");

CREATE UNIQUE INDEX "staff_phone_blind_active_key"
  ON "staff"("piiBlindIndexKeyId", "phoneBlindIndex", "venueId")
  WHERE "isActive" = true AND "phoneBlindIndex" IS NOT NULL;

DROP INDEX "staff_phone_blind_active_idx";

COMMIT;
