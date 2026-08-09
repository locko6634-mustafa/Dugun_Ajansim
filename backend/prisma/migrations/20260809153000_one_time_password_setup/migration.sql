CREATE TYPE "PasswordSetupPurpose" AS ENUM ('ACCOUNT_ACTIVATION', 'PASSWORD_RESET');

CREATE TABLE "password_setup_tokens" (
  "id" TEXT NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "userId" TEXT NOT NULL,
  "purpose" "PasswordSetupPurpose" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_setup_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_setup_tokens_state_check" CHECK ("usedAt" IS NULL OR "revokedAt" IS NULL)
);

CREATE UNIQUE INDEX "password_setup_tokens_tokenHash_key"
  ON "password_setup_tokens"("tokenHash");
CREATE INDEX "password_setup_tokens_userId_expiresAt_idx"
  ON "password_setup_tokens"("userId", "expiresAt");
CREATE INDEX "password_setup_tokens_expiresAt_usedAt_revokedAt_idx"
  ON "password_setup_tokens"("expiresAt", "usedAt", "revokedAt");
CREATE INDEX "password_setup_tokens_createdById_idx"
  ON "password_setup_tokens"("createdById");

ALTER TABLE "password_setup_tokens"
  ADD CONSTRAINT "password_setup_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "password_setup_tokens"
  ADD CONSTRAINT "password_setup_tokens_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Önceden üretilmiş müşteri geçici parolalarını ve geri çözülebilir mesaj sırlarını geçersizleştir.
UPDATE "users"
SET "temporaryPasswordExpiresAt" = NULL
WHERE "role" = 'MUSTERI' AND "mustChangePassword" = TRUE;

UPDATE "message_tasks"
SET "secretCiphertext" = NULL,
    "secretIv" = NULL,
    "secretAuthTag" = NULL
WHERE "kind" IN ('ACCOUNT_ACTIVATION', 'PASSWORD_RESET');
