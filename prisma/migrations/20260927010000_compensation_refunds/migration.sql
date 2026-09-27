-- Additive compensation-refund policy, durable work queue, and webhook receipts.
CREATE TYPE "CompensationRefundMode" AS ENUM ('manual_review', 'automatic_full');
CREATE TYPE "CompensationRefundState" AS ENUM (
  'review_required',
  'auto_queued',
  'auto_processing',
  'refund_pending',
  'refunded',
  'refund_failed',
  'recovered'
);

ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'compensation_refund_queued';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'compensation_refund_started';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'compensation_refund_pending';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'compensation_refunded';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'compensation_refund_failed';
ALTER TYPE "OrderLifecycleSource" ADD VALUE 'refund_worker';

ALTER TABLE "Event"
  ADD COLUMN "compensationRefundMode" "CompensationRefundMode" NOT NULL DEFAULT 'manual_review';
ALTER TABLE "Order"
  ADD COLUMN "compensationRefundModeSnapshot" "CompensationRefundMode" NOT NULL DEFAULT 'manual_review';

CREATE TABLE "CompensationRefundJob" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "state" "CompensationRefundState" NOT NULL DEFAULT 'review_required',
  "stripePaymentIntentId" TEXT,
  "stripeRefundId" TEXT,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'aud',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processingStartedAt" TIMESTAMP(3),
  "processingToken" TEXT,
  "providerStatus" TEXT,
  "lastProviderEventAt" TIMESTAMP(3),
  "lastErrorCode" TEXT,
  "lastErrorAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CompensationRefundJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StripeRefundWebhookEvent" (
  "stripeEventId" TEXT NOT NULL,
  "refundJobId" TEXT,
  "eventType" TEXT NOT NULL,
  "eventCreatedAt" TIMESTAMP(3) NOT NULL,
  "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StripeRefundWebhookEvent_pkey" PRIMARY KEY ("stripeEventId")
);

CREATE UNIQUE INDEX "CompensationRefundJob_orderId_key" ON "CompensationRefundJob"("orderId");
CREATE UNIQUE INDEX "CompensationRefundJob_stripeRefundId_key" ON "CompensationRefundJob"("stripeRefundId");
CREATE INDEX "CompensationRefundJob_state_nextAttemptAt_createdAt_idx" ON "CompensationRefundJob"("state", "nextAttemptAt", "createdAt");
CREATE INDEX "CompensationRefundJob_state_processingStartedAt_idx" ON "CompensationRefundJob"("state", "processingStartedAt");
CREATE INDEX "CompensationRefundJob_stripePaymentIntentId_idx" ON "CompensationRefundJob"("stripePaymentIntentId");
CREATE INDEX "StripeRefundWebhookEvent_refundJobId_eventCreatedAt_idx" ON "StripeRefundWebhookEvent"("refundJobId", "eventCreatedAt");

ALTER TABLE "CompensationRefundJob"
  ADD CONSTRAINT "CompensationRefundJob_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StripeRefundWebhookEvent"
  ADD CONSTRAINT "StripeRefundWebhookEvent_refundJobId_fkey"
  FOREIGN KEY ("refundJobId") REFERENCES "CompensationRefundJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Historical compensation remains manual. Automatic mode is only snapshotted by
-- checkouts created after this migration and explicitly configured by an organiser.
INSERT INTO "CompensationRefundJob" (
  "id", "orderId", "state", "amount", "currency", "updatedAt"
)
SELECT
  'crj_' || md5("id"),
  "id",
  'review_required'::"CompensationRefundState",
  "totalAmount",
  'aud',
  CURRENT_TIMESTAMP
FROM "Order"
WHERE "requiresCompensationReview" = true
ON CONFLICT ("orderId") DO NOTHING;
