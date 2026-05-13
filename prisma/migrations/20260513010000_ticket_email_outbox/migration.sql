CREATE TYPE "EmailOutboxMode" AS ENUM ('automatic', 'manual');

CREATE TYPE "EmailOutboxStatus" AS ENUM ('pending', 'processing', 'sent', 'failed');

CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "mode" "EmailOutboxMode" NOT NULL,
    "status" "EmailOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingStartedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "deliveredToProviderAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_automatic_order_unique"
ON "EmailOutbox" ("orderId")
WHERE "mode" = 'automatic';

CREATE INDEX "EmailOutbox_status_nextAttemptAt_createdAt_idx"
ON "EmailOutbox"("status", "nextAttemptAt", "createdAt");

CREATE INDEX "EmailOutbox_status_processingStartedAt_idx"
ON "EmailOutbox"("status", "processingStartedAt");

CREATE INDEX "EmailOutbox_orderId_idx"
ON "EmailOutbox"("orderId");

ALTER TABLE "EmailOutbox"
ADD CONSTRAINT "EmailOutbox_orderId_fkey"
FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
