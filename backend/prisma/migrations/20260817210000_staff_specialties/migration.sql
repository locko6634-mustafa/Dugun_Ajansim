ALTER TYPE "StaffSpecialty" RENAME TO "StaffSpecialty_old";

CREATE TYPE "StaffSpecialty" AS ENUM (
  'ACTUAL_CAMERA',
  'PHOTOGRAPHY',
  'DRONE',
  'VIDEO',
  'PRINTING',
  'SALES',
  'JIMMY_JIB',
  'EDITING',
  'ALBUM'
);

ALTER TABLE "staff"
  ALTER COLUMN "specialties" TYPE "StaffSpecialty"[]
  USING (
    REPLACE("specialties"::TEXT, 'ASSISTANT', 'ACTUAL_CAMERA')::"StaffSpecialty"[]
  );

ALTER TABLE "wedding_assignments"
  ALTER COLUMN "specialty" TYPE "StaffSpecialty"
  USING (
    CASE "specialty"::TEXT
      WHEN 'ASSISTANT' THEN 'ACTUAL_CAMERA'
      ELSE "specialty"::TEXT
    END
  )::"StaffSpecialty";

DROP TYPE "StaffSpecialty_old";
