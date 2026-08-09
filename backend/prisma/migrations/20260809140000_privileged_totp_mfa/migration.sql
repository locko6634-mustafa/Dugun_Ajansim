-- Ayrıcalıklı kullanıcılar için bağlam bağlı şifreli TOTP ve oturum MFA kanıtı.
ALTER TABLE "users"
  ADD COLUMN "totpSecretCiphertext" TEXT,
  ADD COLUMN "totpSecretIv" TEXT,
  ADD COLUMN "totpSecretAuthTag" TEXT,
  ADD COLUMN "totpEnrollmentExpiresAt" TIMESTAMP(3),
  ADD COLUMN "totpEnabledAt" TIMESTAMP(3),
  ADD COLUMN "totpLastUsedStep" BIGINT;

ALTER TABLE "auth_sessions"
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

ALTER TABLE "users"
  ADD CONSTRAINT "users_totp_state_check"
  CHECK (
    (
      "totpSecretCiphertext" IS NULL
      AND "totpSecretIv" IS NULL
      AND "totpSecretAuthTag" IS NULL
      AND "totpEnrollmentExpiresAt" IS NULL
      AND "totpEnabledAt" IS NULL
      AND "totpLastUsedStep" IS NULL
    )
    OR
    (
      "totpSecretCiphertext" IS NOT NULL
      AND "totpSecretIv" IS NOT NULL
      AND "totpSecretAuthTag" IS NOT NULL
      AND (
        (
          "totpEnrollmentExpiresAt" IS NOT NULL
          AND "totpEnabledAt" IS NULL
          AND "totpLastUsedStep" IS NULL
        )
        OR
        (
          "totpEnrollmentExpiresAt" IS NULL
          AND "totpEnabledAt" IS NOT NULL
          AND "totpLastUsedStep" IS NOT NULL
        )
      )
    )
  );

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_mfa_verified_expiry_check"
  CHECK ("mfaVerifiedAt" IS NULL OR "mfaVerifiedAt" < "expiresAt");
