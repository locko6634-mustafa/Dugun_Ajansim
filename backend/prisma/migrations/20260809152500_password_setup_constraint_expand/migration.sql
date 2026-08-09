ALTER TABLE "users"
  DROP CONSTRAINT "users_temporary_password_expiry_check";

ALTER TABLE "users"
  ADD CONSTRAINT "users_temporary_password_expiry_check"
  CHECK (
    "mustChangePassword" = TRUE
    OR ("mustChangePassword" = FALSE AND "temporaryPasswordExpiresAt" IS NULL)
  );
