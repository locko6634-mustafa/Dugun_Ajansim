CREATE TABLE "password_reset_challenges" (
  "id" TEXT NOT NULL,
  "codeHash" CHAR(64) NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attemptsRemaining" INTEGER NOT NULL DEFAULT 5,
  "verifiedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "password_reset_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_challenges_code_hash_check"
    CHECK ("codeHash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "password_reset_challenges_attempts_check"
    CHECK ("attemptsRemaining" BETWEEN 0 AND 5),
  CONSTRAINT "password_reset_challenges_expiry_check"
    CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "password_reset_challenges_state_check"
    CHECK ("verifiedAt" IS NULL OR "revokedAt" IS NULL)
);

CREATE INDEX "password_reset_challenges_userId_expiresAt_idx"
  ON "password_reset_challenges"("userId", "expiresAt");

CREATE INDEX "password_reset_challenges_expiresAt_verifiedAt_revokedAt_idx"
  ON "password_reset_challenges"("expiresAt", "verifiedAt", "revokedAt");

CREATE INDEX "password_reset_challenges_retention_expires_created_idx"
  ON "password_reset_challenges"("expiresAt", "createdAt");

CREATE INDEX "password_reset_challenges_retention_verified_created_idx"
  ON "password_reset_challenges"("verifiedAt", "createdAt")
  WHERE "verifiedAt" IS NOT NULL;

CREATE INDEX "password_reset_challenges_retention_revoked_created_idx"
  ON "password_reset_challenges"("revokedAt", "createdAt")
  WHERE "revokedAt" IS NOT NULL;

ALTER TABLE "password_reset_challenges"
  ADD CONSTRAINT "password_reset_challenges_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public.password_reset_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY password_reset_challenges_access
ON public.password_reset_challenges
FOR ALL
USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR public.app_maintenance_for('maintenance.retention')
)
WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR public.app_maintenance_for('maintenance.retention')
);
