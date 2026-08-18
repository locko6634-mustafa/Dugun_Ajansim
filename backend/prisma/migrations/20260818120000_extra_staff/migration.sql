ALTER TABLE "staff"
ADD COLUMN "isExtra" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "venueId" DROP NOT NULL;

ALTER TABLE "staff"
ADD CONSTRAINT "staff_extra_venue_check"
CHECK (
  ("isExtra" = true AND "venueId" IS NULL) OR
  ("isExtra" = false AND "venueId" IS NOT NULL)
);

CREATE INDEX "staff_isExtra_isActive_idx" ON "staff"("isExtra", "isActive");

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
        employee."isExtra" = true
        OR employee."venueId" = wedding."venueId"
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
