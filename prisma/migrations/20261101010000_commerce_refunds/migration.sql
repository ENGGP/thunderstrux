-- T23c: whole-order refunds of commerce orders, on the T18a refund request,
-- fence, worker and webhook. A request refunds a ticket order or a commerce
-- order, never both. Additive.
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'refund_requested';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'refund_pending';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'refunded';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'refund_failed';

-- The commerce order's financial fence, as on ticket orders; only a Stripe payment has one.
ALTER TABLE "CommerceOrder" ADD COLUMN "refundStatus" "OrderRefundStatus",
  ADD CONSTRAINT "CommerceOrder_refund_chk" CHECK ("refundStatus" IS NULL OR "paymentKind" = 'stripe');

ALTER TABLE "RefundRequest" ALTER COLUMN "orderId" DROP NOT NULL,
  ADD COLUMN "commerceOrderId" TEXT,
  ADD CONSTRAINT "RefundRequest_purchase_chk" CHECK (num_nonnulls("orderId", "commerceOrderId") = 1);
CREATE INDEX "RefundRequest_commerceOrderId_createdAt_idx" ON "RefundRequest"("commerceOrderId", "createdAt");
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
