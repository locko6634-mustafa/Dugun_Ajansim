BEGIN;

CREATE POLICY staff_venue_assignments_operations_insert
ON public.staff_venue_assignments
FOR INSERT
WITH CHECK (
  public.app_context_is_role('operations')
  AND public.app_operations_venue_allowed("venueId")
);

COMMIT;
