ALTER TABLE "booking_applications" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;
ALTER TABLE "weddings" ADD COLUMN "deletedAt" TIMESTAMP(3), ADD COLUMN "deletedById" TEXT;
CREATE INDEX "booking_applications_deletedAt_idx" ON "booking_applications"("deletedAt");
CREATE INDEX "weddings_deletedAt_idx" ON "weddings"("deletedAt");
ALTER TABLE "booking_applications" ADD CONSTRAINT "booking_applications_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
