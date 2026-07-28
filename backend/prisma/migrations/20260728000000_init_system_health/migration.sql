-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "system_health" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_health_pkey" PRIMARY KEY ("id")
);
