CREATE TABLE public.rls_enforcement_state (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO public.rls_enforcement_state (singleton, enabled)
VALUES (TRUE, FALSE)
ON CONFLICT (singleton) DO NOTHING;

REVOKE ALL ON TABLE public.rls_enforcement_state FROM PUBLIC;
DO $block$
DECLARE
  granted_role TEXT;
BEGIN
  FOR granted_role IN
    SELECT DISTINCT privilege.grantee
    FROM information_schema.role_table_grants AS privilege
    WHERE privilege.table_schema = 'public'
      AND privilege.table_name = 'rls_enforcement_state'
      AND privilege.grantee <> CURRENT_USER
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.rls_enforcement_state FROM %I', granted_role);
  END LOOP;
END
$block$;

CREATE FUNCTION public.app_context_value(setting_name TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $function$
  SELECT NULLIF(current_setting(setting_name, TRUE), '')
$function$;

CREATE FUNCTION public.app_context_is_role(VARIADIC expected_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $function$
  SELECT COALESCE(public.app_context_value('app.actor_role') = ANY(expected_roles), FALSE)
$function$;

CREATE FUNCTION public.app_maintenance_for(VARIADIC expected_purposes TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $function$
  SELECT public.app_context_is_role('maintenance')
    AND COALESCE(public.app_context_value('app.purpose') = ANY(expected_purposes), FALSE)
$function$;

CREATE FUNCTION public.app_rls_is_enforced()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT COALESCE((SELECT state.enabled FROM public.rls_enforcement_state AS state WHERE state.singleton), TRUE)
$function$;

CREATE FUNCTION public.set_rls_enforcement(next_enabled BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  UPDATE public.rls_enforcement_state
  SET enabled = next_enabled, updated_at = CURRENT_TIMESTAMP
  WHERE singleton;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RLS enforcement state is missing';
  END IF;
END
$function$;

CREATE FUNCTION public.app_wedding_allowed(candidate_wedding_id TEXT)
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
      'maintenance.retention', 'maintenance.pii', 'maintenance.payment-sweep'
    )
    ELSE FALSE
  END
$function$;

CREATE FUNCTION public.app_application_allowed(candidate_application_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE public.app_context_value('app.actor_role')
    WHEN 'admin' THEN TRUE
    WHEN 'operations' THEN EXISTS (
      SELECT 1 FROM public.booking_applications AS application
      WHERE application.id = candidate_application_id
        AND application."venueId" = public.app_context_value('app.venue_id')
    )
    WHEN 'customer' THEN EXISTS (
      SELECT 1
      FROM public.weddings AS wedding
      WHERE wedding."applicationId" = candidate_application_id
        AND wedding."customerUserId" = public.app_context_value('app.actor_user_id')
    )
    WHEN 'public' THEN EXISTS (
      SELECT 1 FROM public.booking_applications AS application
      WHERE application.id = candidate_application_id
        AND application.source = 'PUBLIC_FORM'
        AND (
          application.id = public.app_context_value('app.application_id')
          OR application."idempotencyKey"::TEXT = public.app_context_value('app.resource_id')
        )
    )
    WHEN 'maintenance' THEN public.app_maintenance_for(
      'maintenance.retention', 'maintenance.pii', 'maintenance.payment-sweep'
    )
    ELSE FALSE
  END
$function$;

CREATE FUNCTION public.app_delivery_allowed(candidate_delivery_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.deliveries AS delivery
    WHERE delivery.id = candidate_delivery_id
      AND public.app_wedding_allowed(delivery."weddingId")
  )
$function$;

CREATE FUNCTION public.public_venue_has_conflict(
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
          AND application."paymentFlowExpiresAt" > CURRENT_TIMESTAMP
        )
      )
      AND application."weddingStartsAt" < candidate_ends_at
      AND application."weddingEndsAt" > candidate_starts_at
  )
$function$;

REVOKE ALL ON FUNCTION public.set_rls_enforcement(BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_context_value(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_context_is_role(VARIADIC TEXT[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_maintenance_for(VARIADIC TEXT[]) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_rls_is_enforced() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_wedding_allowed(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_application_allowed(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_delivery_allowed(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_venue_has_conflict(TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT) TO PUBLIC;

ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.password_setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_application_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weddings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wedding_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY venues_read ON public.venues FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.seed')
  OR (public.app_context_is_role('operations') AND id = public.app_context_value('app.venue_id'))
  OR (public.app_context_is_role('customer') AND EXISTS (
    SELECT 1 FROM public.weddings AS wedding
    WHERE wedding."venueId" = venues.id
      AND wedding."customerUserId" = public.app_context_value('app.actor_user_id')
  ))
  OR (public.app_context_is_role('public') AND "isActive")
);
CREATE POLICY venues_admin_write ON public.venues FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
);
CREATE POLICY venues_public_insert ON public.venues FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR (public.app_context_is_role('public') AND "isActive" AND NOT "isPartner")
);
CREATE POLICY venues_public_delete ON public.venues FOR DELETE USING (
  NOT public.app_rls_is_enforced()
  OR (public.app_context_is_role('public') AND NOT "isPartner")
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.payment-sweep')
);

CREATE POLICY users_read ON public.users FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR id = public.app_context_value('app.actor_user_id')
  OR (public.app_context_is_role('operations') AND "venueId" = public.app_context_value('app.venue_id'))
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.pii', 'maintenance.admin-bootstrap', 'maintenance.reset-mfa')
);
CREATE POLICY users_update ON public.users FOR UPDATE USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR id = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.pii', 'maintenance.reset-mfa')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR id = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.pii', 'maintenance.reset-mfa')
);
CREATE POLICY users_admin_insert ON public.users FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.admin-bootstrap')
);
CREATE POLICY users_maintenance_delete ON public.users FOR DELETE USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.retention')
);

CREATE POLICY auth_sessions_access ON public.auth_sessions FOR ALL USING (
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
CREATE POLICY password_setup_tokens_access ON public.password_setup_tokens FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR "userId" = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.retention')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR "userId" = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.retention')
);

CREATE POLICY packages_read ON public.packages FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'operations')
  OR (public.app_context_is_role('public', 'customer') AND "isActive")
  OR public.app_maintenance_for('maintenance.seed')
);
CREATE POLICY packages_admin_write ON public.packages FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
);
CREATE POLICY services_read ON public.services FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'operations')
  OR (public.app_context_is_role('public', 'customer') AND "isActive")
  OR public.app_maintenance_for('maintenance.seed')
);
CREATE POLICY services_admin_write ON public.services FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
);

CREATE POLICY booking_applications_access ON public.booking_applications FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_application_allowed(id)
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_application_allowed(id)
  OR (
    public.app_context_is_role('public')
    AND source = 'PUBLIC_FORM'
    AND "idempotencyKey"::TEXT = public.app_context_value('app.resource_id')
  )
);
CREATE POLICY booking_application_services_access ON public.booking_application_services FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_application_allowed("applicationId")
) WITH CHECK (
  NOT public.app_rls_is_enforced() OR public.app_application_allowed("applicationId")
);
CREATE POLICY weddings_access ON public.weddings FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_wedding_allowed(id)
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_wedding_allowed(id)
  OR public.app_context_is_role('admin')
);
CREATE POLICY staff_access ON public.staff FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR (public.app_context_is_role('operations') AND "venueId" = public.app_context_value('app.venue_id'))
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR (public.app_context_is_role('operations') AND "venueId" = public.app_context_value('app.venue_id'))
);
CREATE POLICY wedding_assignments_access ON public.wedding_assignments FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_wedding_allowed("weddingId")
) WITH CHECK (NOT public.app_rls_is_enforced() OR public.app_wedding_allowed("weddingId"));
CREATE POLICY deliveries_access ON public.deliveries FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_wedding_allowed("weddingId")
) WITH CHECK (NOT public.app_rls_is_enforced() OR public.app_wedding_allowed("weddingId"));
CREATE POLICY delivery_history_access ON public.delivery_status_history FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_delivery_allowed("deliveryId")
) WITH CHECK (NOT public.app_rls_is_enforced() OR public.app_delivery_allowed("deliveryId"));
CREATE POLICY message_tasks_access ON public.message_tasks FOR ALL USING (
  NOT public.app_rls_is_enforced() OR public.app_wedding_allowed("weddingId")
) WITH CHECK (NOT public.app_rls_is_enforced() OR public.app_wedding_allowed("weddingId"));

CREATE POLICY audit_logs_read ON public.audit_logs FOR SELECT USING (
  NOT public.app_rls_is_enforced() OR public.app_context_is_role('admin')
);
CREATE POLICY audit_logs_insert ON public.audit_logs FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'operations', 'customer', 'public', 'auth')
  OR public.app_maintenance_for(
    'maintenance.retention', 'maintenance.pii', 'maintenance.payment-sweep',
    'maintenance.admin-bootstrap', 'maintenance.reset-mfa'
  )
);
