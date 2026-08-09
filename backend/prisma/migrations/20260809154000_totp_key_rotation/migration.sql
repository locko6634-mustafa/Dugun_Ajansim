ALTER TABLE "users" ADD COLUMN "totpKeyId" TEXT;

ALTER TABLE "users" ADD CONSTRAINT "users_totp_key_state_check" CHECK (
  ("totpSecretCiphertext" IS NULL AND "totpSecretIv" IS NULL AND "totpSecretAuthTag" IS NULL AND "totpKeyId" IS NULL)
  OR
  ("totpSecretCiphertext" IS NOT NULL AND "totpSecretIv" IS NOT NULL AND "totpSecretAuthTag" IS NOT NULL)
);
