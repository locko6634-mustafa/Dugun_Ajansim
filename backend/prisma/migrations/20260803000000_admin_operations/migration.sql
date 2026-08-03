CREATE TYPE "StaffSpecialty" AS ENUM (
  'PHOTOGRAPHY',
  'VIDEO',
  'DRONE',
  'JIMMY_JIB',
  'ASSISTANT',
  'EDITING',
  'ALBUM'
);

CREATE TABLE "staff" (
  "id" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "specialties" "StaffSpecialty"[] NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wedding_assignments" (
  "id" TEXT NOT NULL,
  "weddingId" TEXT NOT NULL,
  "staffId" TEXT NOT NULL,
  "specialty" "StaffSpecialty" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wedding_assignments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_isActive_lastName_firstName_idx" ON "staff"("isActive", "lastName", "firstName");
CREATE INDEX "wedding_assignments_staffId_idx" ON "wedding_assignments"("staffId");
CREATE INDEX "wedding_assignments_weddingId_specialty_idx" ON "wedding_assignments"("weddingId", "specialty");
CREATE UNIQUE INDEX "wedding_assignments_weddingId_staffId_key" ON "wedding_assignments"("weddingId", "staffId");

ALTER TABLE "wedding_assignments"
  ADD CONSTRAINT "wedding_assignments_weddingId_fkey"
  FOREIGN KEY ("weddingId") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_assignments"
  ADD CONSTRAINT "wedding_assignments_staffId_fkey"
  FOREIGN KEY ("staffId") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
