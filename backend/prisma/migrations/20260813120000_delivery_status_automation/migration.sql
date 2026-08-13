BEGIN;

CREATE OR REPLACE FUNCTION public.app_wedding_allowed(candidate_wedding_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE public.app_context_value('app.actor_role')
    WHEN 'admin' THEN TRUE
    WHEN 'operations' THEN EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = candidate_wedding_id
        AND wedding."venueId" = public.app_context_value('app.venue_id')
    )
    WHEN 'customer' THEN EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = candidate_wedding_id
        AND wedding."customerUserId" = public.app_context_value('app.actor_user_id')
    )
    WHEN 'maintenance' THEN public.app_maintenance_for(
      'maintenance.retention', 'maintenance.pii', 'maintenance.payment-sweep',
      'maintenance.delivery-status'
    )
    ELSE FALSE
  END
$function$;

DROP POLICY audit_logs_insert ON public.audit_logs;
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'operations', 'customer', 'public', 'auth')
  OR public.app_maintenance_for(
    'maintenance.retention', 'maintenance.pii', 'maintenance.payment-sweep',
    'maintenance.admin-bootstrap', 'maintenance.reset-mfa', 'maintenance.delivery-status'
  )
);

COMMIT;
