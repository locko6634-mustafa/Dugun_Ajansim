UPDATE "auth_sessions" AS session
SET "mfaVerifiedAt" = NULL,
    "adminStepUpVerifiedAt" = NULL
FROM "users" AS account
WHERE session."userId" = account."id"
  AND account."role" <> 'ADMIN';

DELETE FROM "trusted_devices" AS device
USING "users" AS account
WHERE device."userId" = account."id"
  AND account."role" <> 'ADMIN';

UPDATE "users"
SET "totpSecretCiphertext" = NULL,
    "totpSecretIv" = NULL,
    "totpSecretAuthTag" = NULL,
    "totpKeyId" = NULL,
    "totpEnrollmentExpiresAt" = NULL,
    "totpEnabledAt" = NULL,
    "totpLastUsedStep" = NULL
WHERE "role" <> 'ADMIN';
