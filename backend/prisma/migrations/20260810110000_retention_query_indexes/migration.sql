CREATE INDEX "auth_sessions_retention_expires_created_idx"
  ON "auth_sessions"("expiresAt", "createdAt");

CREATE INDEX "auth_sessions_retention_revoked_created_idx"
  ON "auth_sessions"("revokedAt", "createdAt")
  WHERE "revokedAt" IS NOT NULL;

CREATE INDEX "password_setup_tokens_retention_expires_created_idx"
  ON "password_setup_tokens"("expiresAt", "createdAt");

CREATE INDEX "password_setup_tokens_retention_used_created_idx"
  ON "password_setup_tokens"("usedAt", "createdAt")
  WHERE "usedAt" IS NOT NULL;

CREATE INDEX "password_setup_tokens_retention_revoked_created_idx"
  ON "password_setup_tokens"("revokedAt", "createdAt")
  WHERE "revokedAt" IS NOT NULL;

CREATE INDEX "booking_applications_retention_public_updated_idx"
  ON "booking_applications"("updatedAt", "id")
  WHERE "source" = 'PUBLIC_FORM'
    AND ("status" = 'REDDEDILDI' OR "paymentFlowExpiredAt" IS NOT NULL);

CREATE INDEX "booking_applications_retention_archived_idx"
  ON "booking_applications"("deletedAt", "id")
  WHERE "deletedAt" IS NOT NULL;

CREATE INDEX "weddings_retention_archived_idx"
  ON "weddings"("deletedAt", "id")
  INCLUDE ("applicationId", "customerUserId")
  WHERE "deletedAt" IS NOT NULL;
