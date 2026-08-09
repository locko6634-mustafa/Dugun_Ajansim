CREATE TABLE "rate_limit_buckets" (
  "keyHash" TEXT NOT NULL,
  "hits" INTEGER NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("keyHash"),
  CONSTRAINT "rate_limit_buckets_hits_check" CHECK ("hits" >= 0)
);

CREATE INDEX "rate_limit_buckets_expiresAt_idx"
  ON "rate_limit_buckets"("expiresAt");
