-- Prisma şemasıyla SQL nullability sözleşmesini eşitle.
UPDATE "packages"
SET "features" = ARRAY[]::TEXT[]
WHERE "features" IS NULL;

UPDATE "services"
SET
  "features" = COALESCE("features", ARRAY[]::TEXT[]),
  "gallery" = COALESCE("gallery", ARRAY[]::TEXT[])
WHERE "features" IS NULL OR "gallery" IS NULL;

ALTER TABLE "packages"
  ALTER COLUMN "features" SET NOT NULL;

ALTER TABLE "services"
  ALTER COLUMN "features" SET NOT NULL,
  ALTER COLUMN "gallery" SET NOT NULL;

-- Eski hatalı kayıtları değiştirmeden yalnız yeni ve güncellenen atamaları koru.
CREATE OR REPLACE FUNCTION "enforce_wedding_assignment_venue_match"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "weddings" AS wedding
    JOIN "staff" AS employee
      ON employee."id" = NEW."staffId"
    WHERE wedding."id" = NEW."weddingId"
      AND wedding."venueId" = employee."venueId"
  ) THEN
    RAISE EXCEPTION 'Wedding assignment venue mismatch'
      USING ERRCODE = '23514',
            CONSTRAINT = 'wedding_assignments_venue_match_check';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "wedding_assignments_venue_match_trigger"
BEFORE INSERT OR UPDATE OF "weddingId", "staffId"
ON "wedding_assignments"
FOR EACH ROW
EXECUTE FUNCTION "enforce_wedding_assignment_venue_match"();
