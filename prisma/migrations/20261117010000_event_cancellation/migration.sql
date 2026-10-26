-- A society cancels a published event with sales (EVT-004): sales close, paid
-- orders are refunded through the refund worker and free ones cancelled. The
-- event keeps its rows for order history; cancelledAt is the separate fact
-- pages show first. A buyer releasing their own free registration (EVT-005)
-- records its lifecycle entry as buyer_action. Additive.
ALTER TABLE "Event" ADD COLUMN "cancelledAt" TIMESTAMP(3), ADD COLUMN "cancellationReason" TEXT;
ALTER TYPE "OrderLifecycleSource" ADD VALUE 'buyer_action';
