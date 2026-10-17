-- T23b: ending a membership early. A free commerce order can be cancelled
-- (the T18c shape: a separate fact, never a refund); a grant's revocation
-- reason is bounded. Additive.
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'free_cancelled';

ALTER TABLE "CommerceOrder" ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  ADD CONSTRAINT "CommerceOrder_cancellation_chk" CHECK (
    "cancelledAt" IS NULL OR ("paymentKind" = 'free' AND "status" = 'paid' AND "cancellationReason" IS NOT NULL AND char_length("cancellationReason") BETWEEN 8 AND 500)
  ),
  ADD CONSTRAINT "CommerceOrder_cancelled_by_chk" CHECK ("cancelledByUserId" IS NULL OR "cancelledAt" IS NOT NULL);
ALTER TABLE "CommerceOrder" ADD CONSTRAINT "CommerceOrder_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MembershipGrant" ADD CONSTRAINT "MembershipGrant_revocation_reason_chk" CHECK ("revocationReason" IS NULL OR char_length("revocationReason") BETWEEN 1 AND 600);
