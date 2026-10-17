-- T18b: Stripe disputes and refunds made outside Thunderstrux. Additive.
CREATE TYPE "OrderDisputeStatus" AS ENUM ('open', 'won', 'lost');

ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'dispute_opened';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'dispute_closed';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'dispute_resolved';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'external_refund_recorded';
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'external_refund_reviewed';

ALTER TABLE "Order" ADD COLUMN "disputeStatus" "OrderDisputeStatus",
  ADD COLUMN "externalRefundedAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "externalRefundReviewedAt" TIMESTAMP(3),
  ADD CONSTRAINT "Order_externalRefundedAmount_chk" CHECK ("externalRefundedAmount" >= 0);

CREATE TABLE "PurchaseDispute" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "reason" TEXT,
    "providerStatus" TEXT NOT NULL,
    "evidenceDueBy" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolvedByUserId" TEXT,
    "resolutionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseDispute_pkey" PRIMARY KEY ("id"),
    -- A restored dispute names who restored the tickets and why.
    CONSTRAINT "PurchaseDispute_resolution_chk" CHECK ("resolvedAt" IS NULL OR char_length("resolutionReason") BETWEEN 8 AND 500)
);

CREATE UNIQUE INDEX "PurchaseDispute_stripeDisputeId_key" ON "PurchaseDispute"("stripeDisputeId");
CREATE INDEX "PurchaseDispute_orderId_createdAt_idx" ON "PurchaseDispute"("orderId", "createdAt");

ALTER TABLE "PurchaseDispute" ADD CONSTRAINT "PurchaseDispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDispute" ADD CONSTRAINT "PurchaseDispute_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseDispute" ADD CONSTRAINT "PurchaseDispute_resolvedByUserId_fkey" FOREIGN KEY ("resolvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
