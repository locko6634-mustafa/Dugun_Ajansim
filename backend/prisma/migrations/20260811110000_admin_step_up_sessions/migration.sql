ALTER TABLE "auth_sessions"
  ADD COLUMN "adminStepUpVerifiedAt" TIMESTAMP(3);

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_admin_step_up_check"
  CHECK (
    "adminStepUpVerifiedAt" IS NULL
    OR (
      "mfaVerifiedAt" IS NOT NULL
      AND "adminStepUpVerifiedAt" >= "mfaVerifiedAt"
      AND "adminStepUpVerifiedAt" < "expiresAt"
    )
  ) NOT VALID;

ALTER TABLE "auth_sessions"
  VALIDATE CONSTRAINT "auth_sessions_admin_step_up_check";
