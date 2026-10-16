-- T14b: recovery replays the exact Stripe Session request with the attempt's
-- idempotency key, and records its own lifecycle source. Additive; attempts
-- created before this migration have no stored request and are not replayed.
ALTER TYPE "OrderLifecycleSource" ADD VALUE 'checkout_recovery';

ALTER TABLE "CheckoutAttempt" ADD COLUMN "providerRequest" JSONB;
