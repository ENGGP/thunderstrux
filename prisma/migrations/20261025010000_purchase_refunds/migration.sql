-- T18a: staff-initiated whole-order refunds with a financial fence shared
-- with compensation refunds. Additive.
CREATE TYPE "OrderRefundStatus" AS ENUM ('processing', 'refunded');
CREATE TYPE "RefundRequestStatus" AS ENUM ('pending', 'uncertain', 'succeeded', 'failed');

ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'refund_requested';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'refund_pending';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'refunded';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'refund_failed';

ALTER TABLE "Order" ADD COLUMN "refundStatus" "OrderRefundStatus",
  ADD COLUMN "stripePaymentIntentId" TEXT;

CREATE TABLE "RefundRequest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT,
    "operationKey" TEXT NOT NULL,
    "status" "RefundRequestStatus" NOT NULL DEFAULT 'pending',
    "stripePaymentIntentId" TEXT,
    "stripeRefundId" TEXT,
    "destinationAccountId" TEXT,
    "providerStatus" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingToken" TEXT,
    "processingStartedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastProviderEventAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id"),
    -- Whole-order refunds only: a positive amount, and a reason for the record.
    CONSTRAINT "RefundRequest_amount_chk" CHECK ("amount" > 0),
    CONSTRAINT "RefundRequest_reason_chk" CHECK (char_length("reason") BETWEEN 8 AND 500)
);

CREATE UNIQUE INDEX "RefundRequest_operationKey_key" ON "RefundRequest"("operationKey");
CREATE UNIQUE INDEX "RefundRequest_stripeRefundId_key" ON "RefundRequest"("stripeRefundId");
CREATE INDEX "RefundRequest_orderId_createdAt_idx" ON "RefundRequest"("orderId", "createdAt");
CREATE INDEX "RefundRequest_status_nextAttemptAt_idx" ON "RefundRequest"("status", "nextAttemptAt");

ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The refund webhook journal also covers ordinary refunds.
ALTER TABLE "StripeRefundWebhookEvent" ADD COLUMN "refundRequestId" TEXT;
CREATE INDEX "StripeRefundWebhookEvent_refundRequestId_eventCreatedAt_idx" ON "StripeRefundWebhookEvent"("refundRequestId", "eventCreatedAt");
ALTER TABLE "StripeRefundWebhookEvent" ADD CONSTRAINT "StripeRefundWebhookEvent_refundRequestId_fkey" FOREIGN KEY ("refundRequestId") REFERENCES "RefundRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
