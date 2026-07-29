-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'SALON_YETKILISI', 'MUSTERI');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "BookingStatus" AS ENUM ('ONAY_BEKLIYOR', 'ONAYLANDI', 'REDDEDILDI', 'IPTAL_EDILDI');
CREATE TYPE "BookingSource" AS ENUM ('PUBLIC_FORM', 'ADMIN');
CREATE TYPE "PrimaryContact" AS ENUM ('GELIN', 'DAMAT');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'DEPOSIT');
CREATE TYPE "DeliveryStatus" AS ENUM ('HAZIRLANIYOR', 'MONTAJ', 'KONTROL', 'TESLIME_HAZIR', 'TESLIM_EDILDI');
CREATE TYPE "MessageKind" AS ENUM ('ACCOUNT_ACTIVATION', 'PREPARATION_UPDATE', 'DELIVERY_READY', 'PASSWORD_RESET');
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'CANCELLED');
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE');

CREATE TABLE "venues" (
  "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "name" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "venues_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "users" (
  "id" TEXT NOT NULL, "username" TEXT NOT NULL, "passwordHash" TEXT NOT NULL,
  "role" "UserRole" NOT NULL, "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT true, "activeAt" TIMESTAMP(3),
  "passwordChangedAt" TIMESTAMP(3), "lastLoginAt" TIMESTAMP(3), "venueId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "auth_sessions" (
  "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "csrfTokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "packages" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL, "description" TEXT,
  "imagePath" TEXT, "priceCents" INTEGER NOT NULL, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "services" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "category" TEXT NOT NULL, "name" TEXT NOT NULL,
  "eyebrow" TEXT, "description" TEXT, "imagePath" TEXT, "priceCents" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "booking_applications" (
  "id" TEXT NOT NULL, "referenceCode" TEXT NOT NULL, "idempotencyKey" TEXT,
  "source" "BookingSource" NOT NULL, "status" "BookingStatus" NOT NULL DEFAULT 'ONAY_BEKLIYOR',
  "brideFirstName" TEXT NOT NULL, "brideLastName" TEXT NOT NULL, "bridePhone" TEXT NOT NULL,
  "groomFirstName" TEXT NOT NULL, "groomLastName" TEXT NOT NULL, "groomPhone" TEXT NOT NULL,
  "primaryContact" "PrimaryContact" NOT NULL, "primaryEmail" TEXT NOT NULL,
  "weddingStartsAt" TIMESTAMP(3) NOT NULL, "weddingEndsAt" TIMESTAMP(3) NOT NULL,
  "venueId" TEXT NOT NULL, "packageId" TEXT NOT NULL, "packageCodeSnapshot" TEXT NOT NULL,
  "packageNameSnapshot" TEXT NOT NULL, "packagePriceCents" INTEGER NOT NULL,
  "totalPriceCents" INTEGER NOT NULL, "paymentMethod" "PaymentMethod" NOT NULL,
  "payableNowCents" INTEGER NOT NULL, "note" TEXT, "privacyConsentAt" TIMESTAMP(3),
  "marketingConsentAt" TIMESTAMP(3), "reviewedAt" TIMESTAMP(3), "reviewedById" TEXT,
  "rejectionReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "booking_applications_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "booking_application_services" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "serviceId" TEXT NOT NULL,
  "codeSnapshot" TEXT NOT NULL, "nameSnapshot" TEXT NOT NULL, "priceCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_application_services_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "weddings" (
  "id" TEXT NOT NULL, "applicationId" TEXT NOT NULL, "customerUserId" TEXT NOT NULL,
  "brideFirstName" TEXT NOT NULL, "brideLastName" TEXT NOT NULL, "bridePhone" TEXT NOT NULL,
  "groomFirstName" TEXT NOT NULL, "groomLastName" TEXT NOT NULL, "groomPhone" TEXT NOT NULL,
  "primaryContact" "PrimaryContact" NOT NULL, "primaryEmail" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL, "endsAt" TIMESTAMP(3) NOT NULL, "venueId" TEXT NOT NULL,
  "packageSummary" JSONB NOT NULL, "note" TEXT, "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "weddings_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "deliveries" (
  "id" TEXT NOT NULL, "weddingId" TEXT NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'HAZIRLANIYOR', "dueDate" DATE NOT NULL,
  "driveUrlCiphertext" TEXT, "driveUrlIv" TEXT, "driveUrlAuthTag" TEXT, "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "delivery_status_history" (
  "id" TEXT NOT NULL, "deliveryId" TEXT NOT NULL, "fromStatus" "DeliveryStatus",
  "toStatus" "DeliveryStatus" NOT NULL, "actorUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_status_history_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "message_tasks" (
  "id" TEXT NOT NULL, "weddingId" TEXT NOT NULL, "kind" "MessageKind" NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'PENDING', "dueAt" TIMESTAMP(3) NOT NULL,
  "recipientPhone" TEXT NOT NULL, "secretCiphertext" TEXT, "secretIv" TEXT, "secretAuthTag" TEXT,
  "sentAt" TIMESTAMP(3), "sentById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "message_tasks_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL, "actorUserId" TEXT, "action" TEXT NOT NULL, "targetType" TEXT NOT NULL,
  "targetId" TEXT, "outcome" "AuditOutcome" NOT NULL DEFAULT 'SUCCESS', "correlationId" TEXT NOT NULL,
  "metadata" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "venues_slug_key" ON "venues"("slug");
CREATE UNIQUE INDEX "venues_name_key" ON "venues"("name");
CREATE INDEX "venues_isActive_name_idx" ON "venues"("isActive", "name");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE INDEX "users_role_status_idx" ON "users"("role", "status");
CREATE INDEX "users_venueId_idx" ON "users"("venueId");
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");
CREATE INDEX "auth_sessions_userId_expiresAt_idx" ON "auth_sessions"("userId", "expiresAt");
CREATE INDEX "auth_sessions_expiresAt_revokedAt_idx" ON "auth_sessions"("expiresAt", "revokedAt");
CREATE UNIQUE INDEX "packages_code_key" ON "packages"("code");
CREATE INDEX "packages_isActive_name_idx" ON "packages"("isActive", "name");
CREATE UNIQUE INDEX "services_code_key" ON "services"("code");
CREATE INDEX "services_isActive_category_name_idx" ON "services"("isActive", "category", "name");
CREATE UNIQUE INDEX "booking_applications_referenceCode_key" ON "booking_applications"("referenceCode");
CREATE UNIQUE INDEX "booking_applications_idempotencyKey_key" ON "booking_applications"("idempotencyKey");
CREATE INDEX "booking_applications_status_createdAt_idx" ON "booking_applications"("status", "createdAt");
CREATE INDEX "booking_applications_venueId_weddingStartsAt_idx" ON "booking_applications"("venueId", "weddingStartsAt");
CREATE INDEX "booking_applications_primaryEmail_idx" ON "booking_applications"("primaryEmail");
CREATE UNIQUE INDEX "booking_application_services_applicationId_serviceId_key" ON "booking_application_services"("applicationId", "serviceId");
CREATE UNIQUE INDEX "weddings_applicationId_key" ON "weddings"("applicationId");
CREATE UNIQUE INDEX "weddings_customerUserId_key" ON "weddings"("customerUserId");
CREATE INDEX "weddings_venueId_startsAt_idx" ON "weddings"("venueId", "startsAt");
CREATE INDEX "weddings_startsAt_endsAt_idx" ON "weddings"("startsAt", "endsAt");
CREATE UNIQUE INDEX "deliveries_weddingId_key" ON "deliveries"("weddingId");
CREATE INDEX "deliveries_status_dueDate_idx" ON "deliveries"("status", "dueDate");
CREATE INDEX "delivery_status_history_deliveryId_createdAt_idx" ON "delivery_status_history"("deliveryId", "createdAt");
CREATE UNIQUE INDEX "message_tasks_weddingId_kind_key" ON "message_tasks"("weddingId", "kind");
CREATE INDEX "message_tasks_status_dueAt_idx" ON "message_tasks"("status", "dueAt");
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");
CREATE INDEX "audit_logs_actorUserId_createdAt_idx" ON "audit_logs"("actorUserId", "createdAt");
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

ALTER TABLE "users" ADD CONSTRAINT "users_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_applications" ADD CONSTRAINT "booking_applications_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_applications" ADD CONSTRAINT "booking_applications_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "packages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_applications" ADD CONSTRAINT "booking_applications_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "booking_application_services" ADD CONSTRAINT "booking_application_services_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "booking_applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking_application_services" ADD CONSTRAINT "booking_application_services_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "booking_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_weddingId_fkey" FOREIGN KEY ("weddingId") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "delivery_status_history" ADD CONSTRAINT "delivery_status_history_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_weddingId_fkey" FOREIGN KEY ("weddingId") REFERENCES "weddings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_tasks" ADD CONSTRAINT "message_tasks_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
