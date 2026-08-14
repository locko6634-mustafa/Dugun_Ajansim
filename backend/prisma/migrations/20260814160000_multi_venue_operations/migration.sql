BEGIN;

CREATE TABLE "venue_manager_assignments" (
  "userId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "venue_manager_assignments_pkey" PRIMARY KEY ("userId", "venueId"),
  CONSTRAINT "venue_manager_assignments_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "venue_manager_assignments_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "venue_manager_assignments_venueId_userId_idx"
  ON "venue_manager_assignments"("venueId", "userId");

CREATE TABLE "staff_venue_assignments" (
  "staffId" TEXT NOT NULL,
  "venueId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_venue_assignments_pkey" PRIMARY KEY ("staffId", "venueId"),
  CONSTRAINT "staff_venue_assignments_staffId_fkey"
    FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "staff_venue_assignments_venueId_fkey"
    FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "staff_venue_assignments_venueId_staffId_idx"
  ON "staff_venue_assignments"("venueId", "staffId");

UPDATE "venues"
SET
  "slug" = 'cess-wedding-park',
  "name" = 'Cess Wedding Park',
  "displayName" = 'Cess Wedding Park',
  "displayOrder" = 3,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'cess-wedding';

UPDATE "venues"
SET
  "slug" = 'yesil-nesil-garden-hayal-bahce',
  "name" = 'Yeşil Nesil Garden Hayal Bahçe',
  "displayName" = 'Yeşil Nesil Garden Hayal Bahçe',
  "displayOrder" = 5,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'yesil-nesil-garden';

UPDATE "venues"
SET "displayOrder" = CASE "slug"
  WHEN 'bella-garden' THEN 9
  WHEN 'talia-garden' THEN 10
  ELSE "displayOrder"
END,
"updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" IN ('bella-garden', 'talia-garden');

INSERT INTO "venues" (
  "id", "slug", "name", "displayName", "imagePath", "displayOrder",
  "isFeatured", "isActive", "isPartner", "createdAt", "updatedAt"
)
SELECT
  'ce550000-0000-4000-8000-000000000001',
  'cess-wedding-park',
  'Cess Wedding Park',
  'Cess Wedding Park',
  'assets/images/venues/cess.webp',
  3,
  TRUE,
  TRUE,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "venues" WHERE "slug" = 'cess-wedding-park');

INSERT INTO "venues" (
  "id", "slug", "name", "displayName", "imagePath", "displayOrder",
  "isFeatured", "isActive", "isPartner", "createdAt", "updatedAt"
)
VALUES
  ('ce550000-0000-4000-8000-000000000002', 'cess-wedding-orman', 'Cess Wedding Orman', 'Cess Wedding Orman', 'assets/images/venues/cess.webp', 4, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('7e510000-0000-4000-8000-000000000001', 'yesil-nesil-garden-hayal-bahce', 'Yeşil Nesil Garden Hayal Bahçe', 'Yeşil Nesil Garden Hayal Bahçe', 'assets/images/venues/yesil-nesil.webp', 5, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('7e510000-0000-4000-8000-000000000002', 'yesil-nesil-garden-masal-bahce', 'Yeşil Nesil Garden Masal Bahçe', 'Yeşil Nesil Garden Masal Bahçe', 'assets/images/venues/yesil-nesil.webp', 6, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('7e510000-0000-4000-8000-000000000003', 'yesil-nesil-garden-kale-bahce', 'Yeşil Nesil Garden Kale Bahçe', 'Yeşil Nesil Garden Kale Bahçe', 'assets/images/venues/yesil-nesil.webp', 7, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('7e510000-0000-4000-8000-000000000004', 'yesil-nesil-garden-ruya-bahce', 'Yeşil Nesil Garden Rüya Bahçe', 'Yeşil Nesil Garden Rüya Bahçe', 'assets/images/venues/yesil-nesil.webp', 8, TRUE, TRUE, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "venue_manager_assignments" ("userId", "venueId")
SELECT "id", "venueId"
FROM "users"
WHERE "role" = 'SALON_YETKILISI' AND "venueId" IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO "venue_manager_assignments" ("userId", "venueId")
SELECT manager."id", sibling."id"
FROM "users" AS manager
JOIN "venues" AS primary_venue ON primary_venue."id" = manager."venueId"
JOIN "venues" AS sibling ON (
  primary_venue."slug" = 'cess-wedding-park'
  AND sibling."slug" IN ('cess-wedding-park', 'cess-wedding-orman')
) OR (
  primary_venue."slug" = 'yesil-nesil-garden-hayal-bahce'
  AND sibling."slug" IN (
    'yesil-nesil-garden-hayal-bahce',
    'yesil-nesil-garden-masal-bahce',
    'yesil-nesil-garden-kale-bahce',
    'yesil-nesil-garden-ruya-bahce'
  )
)
WHERE manager."role" = 'SALON_YETKILISI'
ON CONFLICT DO NOTHING;

INSERT INTO "staff_venue_assignments" ("staffId", "venueId")
SELECT "id", "venueId" FROM "staff"
ON CONFLICT DO NOTHING;

INSERT INTO "staff_venue_assignments" ("staffId", "venueId")
SELECT staff."id", sibling."id"
FROM "staff" AS staff
JOIN "venues" AS primary_venue ON primary_venue."id" = staff."venueId"
JOIN "venues" AS sibling ON (
  primary_venue."slug" = 'cess-wedding-park'
  AND sibling."slug" IN ('cess-wedding-park', 'cess-wedding-orman')
) OR (
  primary_venue."slug" = 'yesil-nesil-garden-hayal-bahce'
  AND sibling."slug" IN (
    'yesil-nesil-garden-hayal-bahce',
    'yesil-nesil-garden-masal-bahce',
    'yesil-nesil-garden-kale-bahce',
    'yesil-nesil-garden-ruya-bahce'
  )
)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION "enforce_wedding_assignment_venue_match"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "weddings" AS wedding
    JOIN "staff" AS employee ON employee."id" = NEW."staffId"
    WHERE wedding."id" = NEW."weddingId"
      AND (
        employee."venueId" = wedding."venueId"
        OR EXISTS (
          SELECT 1
          FROM "staff_venue_assignments" AS staff_venue
          WHERE staff_venue."staffId" = employee."id"
            AND staff_venue."venueId" = wedding."venueId"
        )
      )
  ) THEN
    RAISE EXCEPTION 'Wedding assignment venue mismatch'
      USING ERRCODE = '23514',
            CONSTRAINT = 'wedding_assignments_venue_match_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_operations_venue_allowed(candidate_venue_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT public.app_context_is_role('operations') AND (
    EXISTS (
      SELECT 1
      FROM public.venue_manager_assignments AS assignment
      WHERE assignment."userId" = public.app_context_value('app.actor_user_id')
        AND assignment."venueId" = candidate_venue_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.users AS manager
      WHERE manager.id = public.app_context_value('app.actor_user_id')
        AND manager."venueId" = candidate_venue_id
    )
  )
$function$;

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
        AND public.app_operations_venue_allowed(wedding."venueId")
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

CREATE OR REPLACE FUNCTION public.app_application_allowed(candidate_application_id TEXT)
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
        AND application."venueId" IS NOT NULL
        AND public.app_operations_venue_allowed(application."venueId")
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

ALTER TABLE public.venue_manager_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_venue_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY venue_manager_assignments_read ON public.venue_manager_assignments FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'auth')
  OR "userId" = public.app_context_value('app.actor_user_id')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.seed')
);

CREATE POLICY venue_manager_assignments_admin_write ON public.venue_manager_assignments FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.seed')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.seed')
);

CREATE POLICY staff_venue_assignments_read ON public.staff_venue_assignments FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_operations_venue_allowed("venueId")
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.pii')
);

CREATE POLICY staff_venue_assignments_admin_write ON public.staff_venue_assignments FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.pii', 'maintenance.seed')
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR public.app_maintenance_for('maintenance.pii', 'maintenance.seed')
);

DROP POLICY venues_read ON public.venues;
CREATE POLICY venues_read ON public.venues FOR SELECT USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin', 'montage')
  OR public.app_maintenance_for('maintenance.retention', 'maintenance.seed')
  OR public.app_operations_venue_allowed(id)
  OR (public.app_context_is_role('customer') AND EXISTS (
    SELECT 1 FROM public.weddings AS wedding
    WHERE wedding."venueId" = venues.id
      AND wedding."customerUserId" = public.app_context_value('app.actor_user_id')
  ))
  OR (public.app_context_is_role('public') AND "isActive" AND "isPartner")
);

DROP POLICY staff_access ON public.staff;
CREATE POLICY staff_access ON public.staff FOR ALL USING (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR (public.app_context_is_role('operations') AND EXISTS (
    SELECT 1 FROM public.staff_venue_assignments AS assignment
    WHERE assignment."staffId" = staff.id
      AND public.app_operations_venue_allowed(assignment."venueId")
  ))
  OR (public.app_context_is_role('operations') AND public.app_operations_venue_allowed("venueId"))
) WITH CHECK (
  NOT public.app_rls_is_enforced()
  OR public.app_context_is_role('admin')
  OR (public.app_context_is_role('operations') AND EXISTS (
    SELECT 1 FROM public.staff_venue_assignments AS assignment
    WHERE assignment."staffId" = staff.id
      AND public.app_operations_venue_allowed(assignment."venueId")
  ))
  OR (public.app_context_is_role('operations') AND public.app_operations_venue_allowed("venueId"))
);

GRANT EXECUTE ON FUNCTION public.app_operations_venue_allowed(TEXT) TO PUBLIC;

COMMIT;
