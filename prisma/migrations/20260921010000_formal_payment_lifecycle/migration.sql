-- Additive P3.19 payment lifecycle journal and email-worker fencing.
CREATE TYPE "OrderLifecycleEventType" AS ENUM (
  'legacy_baseline',
  'order_created',
  'stripe_session_attached',
  'order_failed',
  'order_expired',
  'compensation_required',
  'payment_fulfilled',
  'compensation_recovered',
  'manual_refund_marked',
  'email_enqueued',
  'email_retry_scheduled',
  'email_provider_accepted',
  'email_delivery_exhausted'
);

CREATE TYPE "OrderLifecycleSource" AS ENUM (
  'checkout',
  'stripe_webhook',
  'development_fallback',
  'stale_cleanup',
  'staff_action',
  'email_worker',
  'legacy'
);

ALTER TABLE "EmailOutbox" ADD COLUMN "processingToken" TEXT;

CREATE TABLE "OrderLifecycleEvent" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" "OrderLifecycleEventType" NOT NULL,
  "source" "OrderLifecycleSource" NOT NULL,
  "actorUserId" TEXT,
  "stripeEventId" TEXT,
  "stripeSessionId" TEXT,
  "emailOutboxId" TEXT,
  "reason" TEXT,
  "fromOrderStatus" "OrderStatus",
  "toOrderStatus" "OrderStatus",
  "fromReservationStatus" "ReservationStatus",
  "toReservationStatus" "ReservationStatus",
  "facts" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderLifecycleEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderLifecycleEvent_orderId_sequence_key"
  ON "OrderLifecycleEvent"("orderId", "sequence");
CREATE INDEX "OrderLifecycleEvent_orderId_createdAt_idx"
  ON "OrderLifecycleEvent"("orderId", "createdAt");
CREATE INDEX "OrderLifecycleEvent_stripeEventId_idx"
  ON "OrderLifecycleEvent"("stripeEventId");
CREATE INDEX "OrderLifecycleEvent_emailOutboxId_idx"
  ON "OrderLifecycleEvent"("emailOutboxId");
CREATE INDEX "OrderLifecycleEvent_actorUserId_createdAt_idx"
  ON "OrderLifecycleEvent"("actorUserId", "createdAt");

ALTER TABLE "OrderLifecycleEvent"
  ADD CONSTRAINT "OrderLifecycleEvent_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderLifecycleEvent"
  ADD CONSTRAINT "OrderLifecycleEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
