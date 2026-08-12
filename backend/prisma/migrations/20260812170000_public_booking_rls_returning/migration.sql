CREATE POLICY booking_applications_public_read ON public.booking_applications
FOR SELECT
USING (
  public.app_context_is_role('public')
  AND source = 'PUBLIC_FORM'
  AND (
    id = public.app_context_value('app.application_id')
    OR "idempotencyKey"::TEXT = public.app_context_value('app.resource_id')
  )
);
