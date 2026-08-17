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
        OR (
          application.status = 'ONAY_BEKLIYOR'
          AND application.source = 'PUBLIC_FORM'
          AND application."paymentFlowExpiredAt" IS NULL
          AND application."paymentFlowExpiresAt" > CURRENT_TIMESTAMP
        )
      )
      AND application."weddingStartsAt" < candidate_ends_at
      AND application."weddingEndsAt" > candidate_starts_at
  )
$function$;
