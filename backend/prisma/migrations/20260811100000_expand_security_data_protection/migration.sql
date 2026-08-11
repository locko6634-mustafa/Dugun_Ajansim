-- Veri koruması expand aşaması: eski ve yeni uygulama sürümleri backfill tamamlanana kadar
-- birlikte yazabilir. Kalıcı sıkılaştırma yalnız owner-only enable fonksiyonuyla tek yönlü açılır.

ALTER TABLE "booking_applications"
  ALTER COLUMN "venueId" DROP NOT NULL,
  ADD COLUMN "idempotencyFingerprintHmac" CHAR(64),
  ADD COLUMN "idempotencyFingerprintKeyId" TEXT,
  ADD COLUMN "idempotencyFingerprintVersion" INTEGER,
  ADD COLUMN "piiBlindIndexKeyId" TEXT,
  ADD COLUMN "piiBlindIndexVersion" INTEGER;

ALTER TABLE "weddings"
  ADD COLUMN "piiBlindIndexKeyId" TEXT,
  ADD COLUMN "piiBlindIndexVersion" INTEGER;

ALTER TABLE "message_tasks"
  ADD COLUMN "piiBlindIndexKeyId" TEXT,
  ADD COLUMN "piiBlindIndexVersion" INTEGER;

ALTER TABLE "staff"
  ALTER COLUMN "firstName" DROP NOT NULL,
  ALTER COLUMN "lastName" DROP NOT NULL,
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "piiCiphertext" TEXT,
  ADD COLUMN "piiIv" TEXT,
  ADD COLUMN "piiAuthTag" TEXT,
  ADD COLUMN "piiKeyId" TEXT,
  ADD COLUMN "piiEncryptionVersion" INTEGER,
  ADD COLUMN "piiSchemaVersion" INTEGER,
  ADD COLUMN "piiRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "phoneBlindIndex" CHAR(64),
  ADD COLUMN "piiBlindIndexKeyId" TEXT,
  ADD COLUMN "piiBlindIndexVersion" INTEGER;

ALTER TABLE "deliveries" ADD COLUMN "driveUrlKeyId" TEXT;

-- Public rol yalnız katalogdaki aktif partner salonlarını görebilir; özel salon yaşam döngüsü
-- admin onayı veya bakım bağlamıyla sınırlıdır.
DROP POLICY "venues_read" ON public."venues";
DROP POLICY "venues_admin_write" ON public."venues";
DROP POLICY "venues_public_insert" ON public."venues";
DROP POLICY "venues_public_delete" ON public."venues";
CREATE POLICY "venues_read" ON public."venues" FOR SELECT USING (
  (NOT public.app_rls_is_enforced() AND NOT public.app_context_is_role('public'))
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.seed', 'maintenance.pii')
  OR (public.app_context_is_role('operations') AND id = public.app_context_value('app.venue_id'))
  OR (public.app_context_is_role('customer') AND EXISTS (
    SELECT 1 FROM public."weddings" AS wedding
    WHERE wedding."venueId" = venues.id
      AND wedding."customerUserId" = public.app_context_value('app.actor_user_id')
  ))
  OR (public.app_context_is_role('public') AND "isActive" AND "isPartner")
);
CREATE POLICY "venues_admin_write" ON public."venues" FOR ALL USING (
  (NOT public.app_rls_is_enforced() AND NOT public.app_context_is_role('public'))
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
) WITH CHECK (
  (NOT public.app_rls_is_enforced() AND NOT public.app_context_is_role('public'))
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
);
CREATE POLICY "venues_maintenance_delete" ON public."venues" FOR DELETE USING (
  (NOT public.app_rls_is_enforced() AND NOT public.app_context_is_role('public'))
  OR public.app_maintenance_for(
    'maintenance.retention',
    'maintenance.payment-sweep',
    'maintenance.pii'
  )
);

DROP POLICY "staff_access" ON public."staff";
CREATE POLICY "staff_access" ON public."staff" FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.pii')
  OR (public.app_context_is_role('operations') AND "venueId" = public.app_context_value('app.venue_id'))
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.pii')
  OR (public.app_context_is_role('operations') AND "venueId" = public.app_context_value('app.venue_id'))
);

DROP INDEX "staff_isActive_lastName_firstName_idx";
DROP INDEX "staff_venueId_isActive_lastName_firstName_idx";
CREATE INDEX "staff_isActive_idx" ON "staff"("isActive");
CREATE INDEX "staff_venueId_isActive_idx" ON "staff"("venueId", "isActive");
CREATE INDEX "staff_phone_blind_active_idx"
  ON "staff"("piiBlindIndexKeyId", "phoneBlindIndex")
  WHERE "isActive" = true AND "phoneBlindIndex" IS NOT NULL;

CREATE TABLE "pii_enforcement_state" (
  "singleton" BOOLEAN NOT NULL DEFAULT true,
  "enforced" BOOLEAN NOT NULL DEFAULT false,
  "enforcedAt" TIMESTAMPTZ,
  CONSTRAINT "pii_enforcement_state_pkey" PRIMARY KEY ("singleton"),
  CONSTRAINT "pii_enforcement_state_singleton_check" CHECK ("singleton" = true),
  CONSTRAINT "pii_enforcement_state_timestamp_check"
    CHECK (("enforced" = false AND "enforcedAt" IS NULL) OR ("enforced" = true AND "enforcedAt" IS NOT NULL))
);

INSERT INTO "pii_enforcement_state" ("singleton", "enforced", "enforcedAt")
VALUES (true, false, NULL);

REVOKE ALL PRIVILEGES ON TABLE "pii_enforcement_state" FROM PUBLIC;

CREATE FUNCTION public.app_pii_is_enforced()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE(
    (SELECT state."enforced" FROM public."pii_enforcement_state" AS state WHERE state."singleton" = true),
    true
  )
$function$;

REVOKE ALL ON FUNCTION public.app_pii_is_enforced() FROM PUBLIC;

CREATE FUNCTION public.prevent_pii_enforcement_rollback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PII enforcement state silinemez';
  END IF;
  IF OLD."singleton" IS DISTINCT FROM NEW."singleton" THEN
    RAISE EXCEPTION 'PII enforcement singleton değiştirilemez';
  END IF;
  IF OLD."enforced" AND NOT NEW."enforced" THEN
    RAISE EXCEPTION 'PII enforcement devre dışı bırakılamaz';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.prevent_pii_enforcement_rollback() FROM PUBLIC;

CREATE TRIGGER "pii_enforcement_state_one_way"
BEFORE UPDATE OR DELETE ON "pii_enforcement_state"
FOR EACH ROW EXECUTE FUNCTION public.prevent_pii_enforcement_rollback();

CREATE FUNCTION public.redact_legacy_pii_on_enforced_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT public.app_pii_is_enforced() THEN
    RETURN NEW;
  END IF;

  CASE TG_TABLE_NAME
    WHEN 'booking_applications' THEN
      NEW."brideFirstName" := NULL;
      NEW."brideLastName" := NULL;
      NEW."bridePhone" := NULL;
      NEW."groomFirstName" := NULL;
      NEW."groomLastName" := NULL;
      NEW."groomPhone" := NULL;
      NEW."primaryEmail" := NULL;
      NEW."note" := NULL;
      NEW."rejectionReason" := NULL;
      NEW."idempotencyFingerprint" := NULL;
    WHEN 'weddings' THEN
      NEW."brideFirstName" := NULL;
      NEW."brideLastName" := NULL;
      NEW."bridePhone" := NULL;
      NEW."groomFirstName" := NULL;
      NEW."groomLastName" := NULL;
      NEW."groomPhone" := NULL;
      NEW."primaryEmail" := NULL;
      NEW."note" := NULL;
    WHEN 'message_tasks' THEN
      NEW."recipientPhone" := NULL;
    WHEN 'staff' THEN
      NEW."firstName" := NULL;
      NEW."lastName" := NULL;
      NEW."phone" := NULL;
    ELSE
      RAISE EXCEPTION 'Desteklenmeyen PII enforcement tablosu: %', TG_TABLE_NAME;
  END CASE;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.redact_legacy_pii_on_enforced_write() FROM PUBLIC;

CREATE TRIGGER "booking_applications_redact_legacy_pii"
BEFORE INSERT OR UPDATE ON "booking_applications"
FOR EACH ROW EXECUTE FUNCTION public.redact_legacy_pii_on_enforced_write();
CREATE TRIGGER "weddings_redact_legacy_pii"
BEFORE INSERT OR UPDATE ON "weddings"
FOR EACH ROW EXECUTE FUNCTION public.redact_legacy_pii_on_enforced_write();
CREATE TRIGGER "message_tasks_redact_legacy_pii"
BEFORE INSERT OR UPDATE ON "message_tasks"
FOR EACH ROW EXECUTE FUNCTION public.redact_legacy_pii_on_enforced_write();
CREATE TRIGGER "staff_redact_legacy_pii"
BEFORE INSERT OR UPDATE ON "staff"
FOR EACH ROW EXECUTE FUNCTION public.redact_legacy_pii_on_enforced_write();

ALTER TABLE "booking_applications"
  DROP CONSTRAINT "booking_applications_idempotency_fingerprint_check",
  DROP CONSTRAINT "booking_applications_pii_envelope_check",
  DROP CONSTRAINT "booking_applications_review_state_check";

ALTER TABLE "weddings" DROP CONSTRAINT "weddings_pii_envelope_check";
ALTER TABLE "message_tasks" DROP CONSTRAINT "message_tasks_pii_envelope_check";

ALTER TABLE "booking_applications"
  ADD CONSTRAINT "booking_applications_idempotency_fingerprint_check"
  CHECK (
    (
      "idempotencyKey" IS NULL
      AND "idempotencyFingerprint" IS NULL
      AND "idempotencyFingerprintHmac" IS NULL
      AND "idempotencyFingerprintKeyId" IS NULL
      AND "idempotencyFingerprintVersion" IS NULL
    )
    OR
    (
      "idempotencyKey" IS NOT NULL
      AND ("idempotencyFingerprint" IS NULL OR "idempotencyFingerprint" ~ '^[0-9a-f]{64}$')
      AND (
        (
          "idempotencyFingerprintHmac" IS NULL
          AND "idempotencyFingerprintKeyId" IS NULL
          AND "idempotencyFingerprintVersion" IS NULL
          AND "idempotencyFingerprint" IS NOT NULL
        )
        OR
        (
          "idempotencyFingerprintHmac" IS NOT NULL
          AND "idempotencyFingerprintHmac" ~ '^[0-9a-f]{64}$'
          AND "idempotencyFingerprintKeyId" IS NOT NULL
          AND "idempotencyFingerprintKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
          AND "idempotencyFingerprintVersion" IS NOT DISTINCT FROM 2
        )
      )
    )
  ) NOT VALID,
  ADD CONSTRAINT "booking_applications_pii_envelope_check"
  CHECK (
    (
      (
        "piiCiphertext" IS NULL AND "piiIv" IS NULL AND "piiAuthTag" IS NULL
        AND "piiKeyId" IS NULL AND "piiEncryptionVersion" IS NULL AND "piiSchemaVersion" IS NULL
        AND "primaryEmailBlindIndex" IS NULL AND "bridePhoneBlindIndex" IS NULL
        AND "groomPhoneBlindIndex" IS NULL AND "piiBlindIndexKeyId" IS NULL
        AND "piiBlindIndexVersion" IS NULL AND "piiRevision" = 0
        AND "brideFirstName" IS NOT NULL AND "brideLastName" IS NOT NULL
        AND "bridePhone" IS NOT NULL AND "groomFirstName" IS NOT NULL
        AND "groomLastName" IS NOT NULL AND "groomPhone" IS NOT NULL
        AND "primaryEmail" IS NOT NULL
      )
      OR
      (
        "piiCiphertext" IS NOT NULL AND "piiIv" IS NOT NULL AND "piiAuthTag" IS NOT NULL
        AND "piiKeyId" IS NOT NULL
        AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        AND "piiEncryptionVersion" IS NOT DISTINCT FROM 3
        AND "piiSchemaVersion" IS NOT NULL AND "piiSchemaVersion" IN (1, 2)
        AND "piiRevision" >= 1
        AND "primaryEmailBlindIndex" IS NOT NULL
        AND "primaryEmailBlindIndex" ~ '^[0-9a-f]{64}$'
        AND "bridePhoneBlindIndex" IS NOT NULL
        AND "bridePhoneBlindIndex" ~ '^[0-9a-f]{64}$'
        AND "groomPhoneBlindIndex" IS NOT NULL
        AND "groomPhoneBlindIndex" ~ '^[0-9a-f]{64}$'
        AND (
          ("piiBlindIndexKeyId" IS NULL AND "piiBlindIndexVersion" IS NULL)
          OR (
            "piiBlindIndexKeyId" IS NOT NULL
            AND "piiBlindIndexKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
          )
        )
      )
    )
    AND (
      NOT public.app_pii_is_enforced()
      OR (
        "brideFirstName" IS NULL AND "brideLastName" IS NULL AND "bridePhone" IS NULL
        AND "groomFirstName" IS NULL AND "groomLastName" IS NULL AND "groomPhone" IS NULL
        AND "primaryEmail" IS NULL AND "note" IS NULL AND "rejectionReason" IS NULL
        AND "piiCiphertext" IS NOT NULL AND "piiIv" IS NOT NULL AND "piiAuthTag" IS NOT NULL
        AND "piiKeyId" IS NOT NULL AND "piiEncryptionVersion" IS NOT DISTINCT FROM 3
        AND "piiSchemaVersion" IS NOT DISTINCT FROM 2
        AND "piiBlindIndexKeyId" IS NOT NULL
        AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
        AND "idempotencyFingerprint" IS NULL
        AND (
          ("idempotencyKey" IS NULL AND "idempotencyFingerprintHmac" IS NULL
            AND "idempotencyFingerprintKeyId" IS NULL AND "idempotencyFingerprintVersion" IS NULL)
          OR
          ("idempotencyKey" IS NOT NULL AND "idempotencyFingerprintHmac" IS NOT NULL
            AND "idempotencyFingerprintKeyId" IS NOT NULL
            AND "idempotencyFingerprintVersion" IS NOT DISTINCT FROM 2)
        )
        AND ("status" <> 'ONAYLANDI' OR "venueId" IS NOT NULL)
      )
    )
  ) NOT VALID;

ALTER TABLE "booking_applications"
  ADD CONSTRAINT "booking_applications_review_state_check"
  CHECK (
    (
      "status" = 'ONAY_BEKLIYOR'
      AND "reviewedAt" IS NULL
      AND "reviewedById" IS NULL
      AND "rejectionReason" IS NULL
      AND "paymentFlowExpiredAt" IS NULL
    )
    OR
    (
      "status" = 'ONAYLANDI'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND "rejectionReason" IS NULL
      AND "paymentFlowExpiredAt" IS NULL
    )
    OR
    (
      "status" = 'REDDEDILDI'
      AND "reviewedAt" IS NOT NULL
      AND "reviewedById" IS NOT NULL
      AND (
        "rejectionReason" IS NOT NULL
        OR (
          "rejectionReason" IS NULL
          AND "piiCiphertext" IS NOT NULL
          AND "piiEncryptionVersion" IS NOT DISTINCT FROM 3
          AND "piiSchemaVersion" IS NOT NULL
          AND "piiSchemaVersion" IN (1, 2)
        )
      )
      AND "paymentFlowExpiredAt" IS NULL
    )
    OR
    (
      "status" = 'IPTAL_EDILDI'
      AND (
        ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
        OR (
          "paymentFlowExpiredAt" IS NOT NULL
          AND "reviewedAt" IS NULL
          AND "reviewedById" IS NULL
          AND "rejectionReason" IS NULL
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "weddings"
  ADD CONSTRAINT "weddings_pii_envelope_check"
  CHECK (
    (
      (
        "piiCiphertext" IS NULL AND "piiIv" IS NULL AND "piiAuthTag" IS NULL
        AND "piiKeyId" IS NULL AND "piiEncryptionVersion" IS NULL AND "piiSchemaVersion" IS NULL
        AND "primaryEmailBlindIndex" IS NULL AND "bridePhoneBlindIndex" IS NULL
        AND "groomPhoneBlindIndex" IS NULL AND "piiBlindIndexKeyId" IS NULL
        AND "piiBlindIndexVersion" IS NULL AND "piiRevision" = 0
        AND "brideFirstName" IS NOT NULL AND "brideLastName" IS NOT NULL
        AND "bridePhone" IS NOT NULL AND "groomFirstName" IS NOT NULL
        AND "groomLastName" IS NOT NULL AND "groomPhone" IS NOT NULL
        AND "primaryEmail" IS NOT NULL
      )
      OR
      (
        "piiCiphertext" IS NOT NULL AND "piiIv" IS NOT NULL AND "piiAuthTag" IS NOT NULL
        AND "piiKeyId" IS NOT NULL
        AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        AND "piiEncryptionVersion" IS NOT DISTINCT FROM 3
        AND "piiSchemaVersion" IS NOT DISTINCT FROM 1
        AND "piiRevision" >= 1
        AND "primaryEmailBlindIndex" IS NOT NULL
        AND "primaryEmailBlindIndex" ~ '^[0-9a-f]{64}$'
        AND "bridePhoneBlindIndex" IS NOT NULL
        AND "bridePhoneBlindIndex" ~ '^[0-9a-f]{64}$'
        AND "groomPhoneBlindIndex" IS NOT NULL
        AND "groomPhoneBlindIndex" ~ '^[0-9a-f]{64}$'
        AND (
          ("piiBlindIndexKeyId" IS NULL AND "piiBlindIndexVersion" IS NULL)
          OR (
            "piiBlindIndexKeyId" IS NOT NULL
            AND "piiBlindIndexKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
          )
        )
      )
    )
    AND (
      NOT public.app_pii_is_enforced()
      OR (
        "brideFirstName" IS NULL AND "brideLastName" IS NULL AND "bridePhone" IS NULL
        AND "groomFirstName" IS NULL AND "groomLastName" IS NULL AND "groomPhone" IS NULL
        AND "primaryEmail" IS NULL AND "note" IS NULL
        AND "piiCiphertext" IS NOT NULL AND "piiBlindIndexKeyId" IS NOT NULL
        AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
      )
    )
  ) NOT VALID;

ALTER TABLE "message_tasks"
  ADD CONSTRAINT "message_tasks_pii_envelope_check"
  CHECK (
    (
      (
        "piiCiphertext" IS NULL AND "piiIv" IS NULL AND "piiAuthTag" IS NULL
        AND "piiKeyId" IS NULL AND "piiEncryptionVersion" IS NULL AND "piiSchemaVersion" IS NULL
        AND "recipientPhoneBlindIndex" IS NULL AND "piiBlindIndexKeyId" IS NULL
        AND "piiBlindIndexVersion" IS NULL AND "piiRevision" = 0
        AND "recipientPhone" IS NOT NULL
      )
      OR
      (
        "piiCiphertext" IS NOT NULL AND "piiIv" IS NOT NULL AND "piiAuthTag" IS NOT NULL
        AND "piiKeyId" IS NOT NULL
        AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        AND "piiEncryptionVersion" IS NOT DISTINCT FROM 3
        AND "piiSchemaVersion" IS NOT DISTINCT FROM 1
        AND "piiRevision" >= 1
        AND "recipientPhoneBlindIndex" IS NOT NULL
        AND "recipientPhoneBlindIndex" ~ '^[0-9a-f]{64}$'
        AND (
          ("piiBlindIndexKeyId" IS NULL AND "piiBlindIndexVersion" IS NULL)
          OR (
            "piiBlindIndexKeyId" IS NOT NULL
            AND "piiBlindIndexKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
          )
        )
      )
    )
    AND (
      NOT public.app_pii_is_enforced()
      OR (
        "recipientPhone" IS NULL AND "piiCiphertext" IS NOT NULL
        AND "piiBlindIndexKeyId" IS NOT NULL
        AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
      )
    )
  ) NOT VALID;

ALTER TABLE "staff"
  ADD CONSTRAINT "staff_pii_envelope_check"
  CHECK (
    (
      (
        "piiCiphertext" IS NULL AND "piiIv" IS NULL AND "piiAuthTag" IS NULL
        AND "piiKeyId" IS NULL AND "piiEncryptionVersion" IS NULL AND "piiSchemaVersion" IS NULL
        AND "phoneBlindIndex" IS NULL AND "piiBlindIndexKeyId" IS NULL
        AND "piiBlindIndexVersion" IS NULL AND "piiRevision" = 0
        AND "firstName" IS NOT NULL AND "lastName" IS NOT NULL AND "phone" IS NOT NULL
      )
      OR
      (
        "piiCiphertext" IS NOT NULL AND "piiIv" IS NOT NULL AND "piiAuthTag" IS NOT NULL
        AND "piiKeyId" IS NOT NULL
        AND "piiKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
        AND "piiEncryptionVersion" IS NOT DISTINCT FROM 3
        AND "piiSchemaVersion" IS NOT DISTINCT FROM 1
        AND "piiRevision" >= 1
        AND "phoneBlindIndex" IS NOT NULL
        AND "phoneBlindIndex" ~ '^[0-9a-f]{64}$'
        AND (
          ("piiBlindIndexKeyId" IS NULL AND "piiBlindIndexVersion" IS NULL)
          OR (
            "piiBlindIndexKeyId" IS NOT NULL
            AND "piiBlindIndexKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
            AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
          )
        )
      )
    )
    AND (
      NOT public.app_pii_is_enforced()
      OR (
        "firstName" IS NULL AND "lastName" IS NULL AND "phone" IS NULL
        AND "piiCiphertext" IS NOT NULL AND "piiBlindIndexKeyId" IS NOT NULL
        AND "piiBlindIndexVersion" IS NOT DISTINCT FROM 1
      )
    )
  ) NOT VALID;

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_drive_url_key_check"
  CHECK (
    (
      (
        "driveUrlCiphertext" IS NULL AND "driveUrlIv" IS NULL AND "driveUrlAuthTag" IS NULL
        AND "driveUrlKeyId" IS NULL
      )
      OR
      (
        "driveUrlCiphertext" IS NOT NULL AND "driveUrlIv" IS NOT NULL AND "driveUrlAuthTag" IS NOT NULL
        AND (
          "driveUrlKeyId" IS NULL
          OR (
            "driveUrlKeyId" IS NOT NULL
            AND "driveUrlKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
          )
        )
      )
    )
    AND (
      NOT public.app_pii_is_enforced()
      OR (
        "encryptionVersion" IS NOT DISTINCT FROM 2
        AND (
          "driveUrlCiphertext" IS NULL
          OR (
            "driveUrlCiphertext" IS NOT NULL
            AND "driveUrlKeyId" IS NOT NULL
            AND "driveUrlKeyId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
          )
        )
      )
    )
  ) NOT VALID;

ALTER TABLE "booking_applications"
  VALIDATE CONSTRAINT "booking_applications_idempotency_fingerprint_check";
ALTER TABLE "booking_applications"
  VALIDATE CONSTRAINT "booking_applications_pii_envelope_check";
ALTER TABLE "booking_applications"
  VALIDATE CONSTRAINT "booking_applications_review_state_check";
ALTER TABLE "weddings" VALIDATE CONSTRAINT "weddings_pii_envelope_check";
ALTER TABLE "message_tasks" VALIDATE CONSTRAINT "message_tasks_pii_envelope_check";
ALTER TABLE "staff" VALIDATE CONSTRAINT "staff_pii_envelope_check";
ALTER TABLE "deliveries" VALIDATE CONSTRAINT "deliveries_drive_url_key_check";

CREATE FUNCTION public.enable_data_encryption_enforcement()
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF public.app_pii_is_enforced() THEN
    RETURN true;
  END IF;

  LOCK TABLE public."pii_enforcement_state", public."booking_applications", public."weddings",
    public."message_tasks", public."staff", public."deliveries", public."venues",
    public."users" IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (
    SELECT 1 FROM public."booking_applications"
    WHERE "brideFirstName" IS NOT NULL OR "brideLastName" IS NOT NULL OR "bridePhone" IS NOT NULL
      OR "groomFirstName" IS NOT NULL OR "groomLastName" IS NOT NULL OR "groomPhone" IS NOT NULL
      OR "primaryEmail" IS NOT NULL OR "note" IS NOT NULL OR "rejectionReason" IS NOT NULL
      OR "piiCiphertext" IS NULL OR "piiIv" IS NULL OR "piiAuthTag" IS NULL OR "piiKeyId" IS NULL
      OR "piiKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiEncryptionVersion" IS DISTINCT FROM 3 OR "piiSchemaVersion" IS DISTINCT FROM 2
      OR "piiBlindIndexKeyId" IS NULL
      OR "piiBlindIndexKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiBlindIndexVersion" IS DISTINCT FROM 1
      OR "primaryEmailBlindIndex" IS NULL OR "primaryEmailBlindIndex" !~ '^[0-9a-f]{64}$'
      OR "bridePhoneBlindIndex" IS NULL OR "bridePhoneBlindIndex" !~ '^[0-9a-f]{64}$'
      OR "groomPhoneBlindIndex" IS NULL OR "groomPhoneBlindIndex" !~ '^[0-9a-f]{64}$'
      OR "idempotencyFingerprint" IS NOT NULL
      OR ("status" = 'ONAYLANDI' AND "venueId" IS NULL)
      OR (
        "status" <> 'ONAYLANDI'
        AND "venueId" IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public."venues" AS venue
          WHERE venue."id" = "booking_applications"."venueId" AND venue."isPartner" = false
        )
      )
      OR (
        "idempotencyKey" IS NULL AND (
          "idempotencyFingerprintHmac" IS NOT NULL OR "idempotencyFingerprintKeyId" IS NOT NULL
          OR "idempotencyFingerprintVersion" IS NOT NULL
        )
      )
      OR (
        "idempotencyKey" IS NOT NULL AND (
          "idempotencyFingerprintHmac" IS NULL
          OR "idempotencyFingerprintHmac" !~ '^[0-9a-f]{64}$'
          OR "idempotencyFingerprintKeyId" IS NULL
          OR "idempotencyFingerprintKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
          OR "idempotencyFingerprintVersion" IS DISTINCT FROM 2
        )
      )
  ) THEN
    RAISE EXCEPTION 'BookingApplication veri koruması backfill/redaction doğrulaması tamamlanmadı';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public."venues" AS venue
    WHERE venue."isPartner" = false
      AND NOT EXISTS (
        SELECT 1 FROM public."booking_applications" AS application
        WHERE application."venueId" = venue."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."weddings" AS wedding WHERE wedding."venueId" = venue."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."staff" AS staff_member WHERE staff_member."venueId" = venue."id"
      )
      AND NOT EXISTS (
        SELECT 1 FROM public."users" AS manager WHERE manager."venueId" = venue."id"
      )
  ) THEN
    RAISE EXCEPTION 'Yetim özel salon temizliği tamamlanmadı';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."weddings"
    WHERE "brideFirstName" IS NOT NULL OR "brideLastName" IS NOT NULL OR "bridePhone" IS NOT NULL
      OR "groomFirstName" IS NOT NULL OR "groomLastName" IS NOT NULL OR "groomPhone" IS NOT NULL
      OR "primaryEmail" IS NOT NULL OR "note" IS NOT NULL
      OR "piiCiphertext" IS NULL OR "piiIv" IS NULL OR "piiAuthTag" IS NULL OR "piiKeyId" IS NULL
      OR "piiKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiEncryptionVersion" IS DISTINCT FROM 3 OR "piiSchemaVersion" IS DISTINCT FROM 1
      OR "piiBlindIndexKeyId" IS NULL
      OR "piiBlindIndexKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiBlindIndexVersion" IS DISTINCT FROM 1
      OR "primaryEmailBlindIndex" IS NULL OR "primaryEmailBlindIndex" !~ '^[0-9a-f]{64}$'
      OR "bridePhoneBlindIndex" IS NULL OR "bridePhoneBlindIndex" !~ '^[0-9a-f]{64}$'
      OR "groomPhoneBlindIndex" IS NULL OR "groomPhoneBlindIndex" !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'Wedding veri koruması backfill/redaction doğrulaması tamamlanmadı';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."message_tasks"
    WHERE "recipientPhone" IS NOT NULL OR "piiCiphertext" IS NULL OR "piiIv" IS NULL
      OR "piiAuthTag" IS NULL OR "piiKeyId" IS NULL OR "piiEncryptionVersion" IS DISTINCT FROM 3
      OR "piiKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiSchemaVersion" IS DISTINCT FROM 1 OR "piiBlindIndexKeyId" IS NULL
      OR "piiBlindIndexKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiBlindIndexVersion" IS DISTINCT FROM 1 OR "recipientPhoneBlindIndex" IS NULL
      OR "recipientPhoneBlindIndex" !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'MessageTask veri koruması backfill/redaction doğrulaması tamamlanmadı';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."staff"
    WHERE "firstName" IS NOT NULL OR "lastName" IS NOT NULL OR "phone" IS NOT NULL
      OR "piiCiphertext" IS NULL OR "piiIv" IS NULL OR "piiAuthTag" IS NULL OR "piiKeyId" IS NULL
      OR "piiKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiEncryptionVersion" IS DISTINCT FROM 3 OR "piiSchemaVersion" IS DISTINCT FROM 1
      OR "piiBlindIndexKeyId" IS NULL
      OR "piiBlindIndexKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
      OR "piiBlindIndexVersion" IS DISTINCT FROM 1
      OR "phoneBlindIndex" IS NULL OR "phoneBlindIndex" !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'Staff veri koruması backfill/redaction doğrulaması tamamlanmadı';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public."deliveries"
    WHERE "encryptionVersion" IS DISTINCT FROM 2
      OR ("driveUrlCiphertext" IS NULL AND ("driveUrlIv" IS NOT NULL OR "driveUrlAuthTag" IS NOT NULL OR "driveUrlKeyId" IS NOT NULL))
      OR ("driveUrlCiphertext" IS NOT NULL AND ("driveUrlIv" IS NULL OR "driveUrlAuthTag" IS NULL
        OR "driveUrlKeyId" IS NULL
        OR "driveUrlKeyId" !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'))
  ) THEN
    RAISE EXCEPTION 'Delivery encryption key rotasyonu doğrulaması tamamlanmadı';
  END IF;

  UPDATE public."pii_enforcement_state"
  SET "enforced" = true, "enforcedAt" = clock_timestamp()
  WHERE "singleton" = true AND "enforced" = false;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PII enforcement state güvenli biçimde etkinleştirilemedi';
  END IF;
  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public.enable_data_encryption_enforcement() FROM PUBLIC;
