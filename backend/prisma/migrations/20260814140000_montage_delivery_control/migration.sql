BEGIN;

ALTER TABLE "deliveries"
  ADD COLUMN "manualStatusOverrideAt" TIMESTAMP(3);

CREATE INDEX "deliveries_automatic_status_candidates_idx"
  ON "deliveries" ("status", "updatedAt")
  WHERE "manualStatusOverrideAt" IS NULL AND "releasedAt" IS NULL;

COMMIT;
