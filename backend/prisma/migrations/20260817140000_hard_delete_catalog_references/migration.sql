BEGIN;

ALTER TABLE "booking_applications"
  DROP CONSTRAINT "booking_applications_packageId_fkey",
  ALTER COLUMN "packageId" DROP NOT NULL,
  ADD CONSTRAINT "booking_applications_packageId_fkey"
    FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "booking_application_services"
  DROP CONSTRAINT "booking_application_services_serviceId_fkey",
  ALTER COLUMN "serviceId" DROP NOT NULL,
  ADD CONSTRAINT "booking_application_services_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
