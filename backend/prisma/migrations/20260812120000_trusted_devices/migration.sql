CREATE TABLE "trusted_devices" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "userAgentHash" TEXT NOT NULL,
  "trusted" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastMfaAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "trusted_devices_name_check" CHECK (char_length("name") BETWEEN 1 AND 120),
  CONSTRAINT "trusted_devices_expiry_check" CHECK ("expiresAt" > "lastMfaAt"),
  CONSTRAINT "trusted_devices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "trusted_devices_tokenHash_key" ON "trusted_devices"("tokenHash");
CREATE INDEX "trusted_devices_userId_expiresAt_idx" ON "trusted_devices"("userId", "expiresAt");
CREATE INDEX "trusted_devices_expiresAt_revokedAt_idx" ON "trusted_devices"("expiresAt", "revokedAt");

ALTER TABLE public.trusted_devices ENABLE ROW LEVEL SECURITY;
CREATE POLICY trusted_devices_access ON public.trusted_devices FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR "userId" = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.reset-mfa')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR "userId" = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.reset-mfa')
);
