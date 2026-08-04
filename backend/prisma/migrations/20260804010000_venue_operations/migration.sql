ALTER TABLE "staff" ADD COLUMN "venueId" TEXT;

UPDATE "staff" AS s
SET "venueId" = COALESCE(
  (
    SELECT w."venueId"
    FROM "wedding_assignments" wa
    JOIN "weddings" w ON w."id" = wa."weddingId"
    WHERE wa."staffId" = s."id"
    GROUP BY w."venueId"
    ORDER BY COUNT(*) DESC, w."venueId"
    LIMIT 1
  ),
  (SELECT v."id" FROM "venues" v ORDER BY v."isActive" DESC, v."name" LIMIT 1)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "staff" WHERE "venueId" IS NULL) THEN
    RAISE EXCEPTION 'Personel salon eşlemesi için en az bir salon bulunmalıdır.';
  END IF;
END $$;

ALTER TABLE "staff" ALTER COLUMN "venueId" SET NOT NULL;
ALTER TABLE "staff"
  ADD CONSTRAINT "staff_venueId_fkey"
  FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "staff_venueId_isActive_lastName_firstName_idx"
  ON "staff"("venueId", "isActive", "lastName", "firstName");
