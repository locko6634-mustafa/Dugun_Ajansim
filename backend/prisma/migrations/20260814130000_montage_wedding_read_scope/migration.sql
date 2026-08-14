CREATE POLICY wedding_assignments_montage_read ON public.wedding_assignments FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND EXISTS (
      SELECT 1
      FROM public.weddings AS wedding
      WHERE wedding.id = wedding_assignments."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY staff_montage_assigned_read ON public.staff FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND EXISTS (
      SELECT 1
      FROM public.wedding_assignments AS assignment
      JOIN public.weddings AS wedding ON wedding.id = assignment."weddingId"
      WHERE assignment."staffId" = staff.id
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);
