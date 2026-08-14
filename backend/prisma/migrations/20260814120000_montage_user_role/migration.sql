ALTER TYPE "UserRole" ADD VALUE 'MONTAJCI';

CREATE POLICY venues_montage_read ON public.venues FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('montage')
);

CREATE POLICY weddings_montage_read ON public.weddings FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND "cancelledAt" IS NULL
    AND "deletedAt" IS NULL
  )
);

CREATE POLICY deliveries_montage_read ON public.deliveries FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = deliveries."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY deliveries_montage_update ON public.deliveries FOR UPDATE USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = deliveries."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = deliveries."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY delivery_history_montage_insert ON public.delivery_status_history FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND EXISTS (
      SELECT 1
      FROM public.deliveries AS delivery
      JOIN public.weddings AS wedding ON wedding.id = delivery."weddingId"
      WHERE delivery.id = delivery_status_history."deliveryId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY message_tasks_montage_read ON public.message_tasks FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND kind = 'DELIVERY_READY'
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = message_tasks."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY message_tasks_montage_insert ON public.message_tasks FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND kind = 'DELIVERY_READY'
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = message_tasks."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY message_tasks_montage_update ON public.message_tasks FOR UPDATE USING (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND kind = 'DELIVERY_READY'
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = message_tasks."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR (
    public.app_context_is_role('montage')
    AND kind = 'DELIVERY_READY'
    AND EXISTS (
      SELECT 1 FROM public.weddings AS wedding
      WHERE wedding.id = message_tasks."weddingId"
        AND wedding."cancelledAt" IS NULL
        AND wedding."deletedAt" IS NULL
    )
  )
);

CREATE POLICY audit_logs_montage_insert ON public.audit_logs FOR INSERT WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('montage')
);
