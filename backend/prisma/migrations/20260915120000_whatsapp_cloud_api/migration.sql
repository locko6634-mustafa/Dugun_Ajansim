ALTER TABLE "message_tasks"
  ADD COLUMN "providerMessageId" TEXT,
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "providerStatusAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "message_tasks_providerMessageId_key"
  ON "message_tasks"("providerMessageId");
CREATE INDEX "message_tasks_providerStatusAt_idx" ON "message_tasks"("providerStatusAt");
