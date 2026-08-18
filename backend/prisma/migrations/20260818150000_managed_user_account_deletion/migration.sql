ALTER TABLE "users"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "users_deletedAt_idx" ON "users"("deletedAt");
