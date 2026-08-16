ALTER TABLE "booking_applications"
DROP CONSTRAINT "booking_applications_review_state_check",
ADD CONSTRAINT "booking_applications_review_state_check"
CHECK (
  (
    "status" = 'ONAY_BEKLIYOR'
    AND "reviewedAt" IS NULL
    AND "reviewedById" IS NULL
    AND "rejectionReason" IS NULL
  )
  OR
  (
    "status" = 'ONAYLANDI'
    AND "reviewedAt" IS NOT NULL
    AND "reviewedById" IS NOT NULL
    AND "rejectionReason" IS NULL
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
  )
  OR
  (
    "status" = 'IPTAL_EDILDI'
    AND (
      ("reviewedAt" IS NOT NULL AND "reviewedById" IS NOT NULL)
      OR
      (
        "paymentFlowExpiredAt" IS NOT NULL
        AND "reviewedAt" IS NULL
        AND "reviewedById" IS NULL
        AND "rejectionReason" IS NULL
      )
    )
  )
) NOT VALID;

ALTER TABLE "booking_applications"
VALIDATE CONSTRAINT "booking_applications_review_state_check";

CREATE OR REPLACE FUNCTION public.public_venue_has_conflict(
  candidate_venue_id TEXT,
  candidate_starts_at TIMESTAMPTZ,
  candidate_ends_at TIMESTAMPTZ,
  excluded_wedding_id TEXT DEFAULT NULL,
  excluded_application_id TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.weddings AS wedding
    WHERE wedding."venueId" = candidate_venue_id
      AND wedding.id IS DISTINCT FROM excluded_wedding_id
      AND wedding."cancelledAt" IS NULL
      AND wedding."deletedAt" IS NULL
      AND wedding."startsAt" < candidate_ends_at
      AND wedding."endsAt" > candidate_starts_at
  ) OR EXISTS (
    SELECT 1
    FROM public.booking_applications AS application
    WHERE application."venueId" = candidate_venue_id
      AND application.id IS DISTINCT FROM excluded_application_id
      AND application."deletedAt" IS NULL
      AND (
        application.status = 'ONAYLANDI'
        OR (application.status = 'ONAY_BEKLIYOR' AND application.source = 'ADMIN')
      )
      AND application."weddingStartsAt" < candidate_ends_at
      AND application."weddingEndsAt" > candidate_starts_at
  )
$function$;
