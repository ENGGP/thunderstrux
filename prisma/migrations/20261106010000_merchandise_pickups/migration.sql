-- T28a: a fulfilled merchandise order's pickup, moved on by staff (pending,
-- then ready, then collected) under the order's version; who did each step
-- and when is in the order's history.
CREATE TYPE "MerchandisePickupStatus" AS ENUM ('pending', 'ready', 'collected');
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'pickup_ready';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'pickup_collected';

ALTER TABLE "CommerceOrder" ADD COLUMN "pickupStatus" "MerchandisePickupStatus",
  ADD CONSTRAINT "CommerceOrder_pickup_chk" CHECK ("pickupStatus" IS NULL OR "kind" = 'merchandise');
CREATE INDEX "CommerceOrder_organisationId_pickupStatus_createdAt_id_idx" ON "CommerceOrder"("organisationId", "pickupStatus", "createdAt", "id");

-- Merchandise already fulfilled waits to be prepared.
UPDATE "CommerceOrder" SET "pickupStatus" = 'pending'
WHERE "kind" = 'merchandise' AND "status" = 'paid' AND "fulfilledAt" IS NOT NULL AND NOT "requiresCompensationReview";
