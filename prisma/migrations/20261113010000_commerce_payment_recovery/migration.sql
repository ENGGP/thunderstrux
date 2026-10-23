-- PAY-003: disputes and refunds made outside Thunderstrux on membership and
-- merchandise orders, as T18b records them on ticket orders. A dispute belongs
-- to a ticket order or a commerce order, never both. Additive.
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'dispute_opened';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'dispute_closed';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'external_refund_recorded';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'external_refund_reviewed';

ALTER TABLE "CommerceOrder" ADD COLUMN "disputeStatus" "OrderDisputeStatus",
  ADD COLUMN "externalRefundedAmount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "externalRefundReviewedAt" TIMESTAMP(3),
  ADD CONSTRAINT "CommerceOrder_externalRefundedAmount_chk" CHECK ("externalRefundedAmount" >= 0);

ALTER TABLE "PurchaseDispute" ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "commerceOrderId" TEXT,
  ADD CONSTRAINT "PurchaseDispute_purchase_chk" CHECK (num_nonnulls("orderId", "commerceOrderId") = 1);
CREATE INDEX "PurchaseDispute_commerceOrderId_createdAt_idx" ON "PurchaseDispute"("commerceOrderId", "createdAt");
ALTER TABLE "PurchaseDispute" ADD CONSTRAINT "PurchaseDispute_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
