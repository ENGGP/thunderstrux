-- Reconciliation sweep (PAY-024): the stale-order worker asks Stripe about
-- pending checkouts, so a payment whose webhook was lost is still confirmed and
-- a paid order is never expired. stripeCheckedAt paces those checks per order;
-- reconciliation_sweep records the lifecycle entries the sweep writes. Additive.
ALTER TABLE "Order" ADD COLUMN "stripeCheckedAt" TIMESTAMP(3);
ALTER TABLE "CommerceOrder" ADD COLUMN "stripeCheckedAt" TIMESTAMP(3);
ALTER TYPE "OrderLifecycleSource" ADD VALUE 'reconciliation_sweep';
