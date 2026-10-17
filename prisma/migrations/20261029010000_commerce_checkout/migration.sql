-- T21: commerce checkout. Additive apart from the fee policy type fix.
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'stripe_session_attached';

-- The fee policy version is a name such as platform_fee_10_percent_v1, as on
-- ticket orders; T20 declared it as an integer. No commerce order exists yet.
ALTER TABLE "CommerceOrder" ALTER COLUMN "feePolicyVersion" TYPE TEXT USING "feePolicyVersion"::text;

-- A pending paid order's hold ends with its Stripe Session.
ALTER TABLE "CommerceOrder" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "CommerceOrder_status_expiresAt_idx" ON "CommerceOrder"("status", "expiresAt");
