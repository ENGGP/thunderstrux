-- PAY-004: a lost dispute takes the money back from the society. On destination
-- charges Stripe debits the platform for a dispute, so the transfer to the
-- society is reversed by the disputed amount once Stripe closes it as lost.
-- The reversal's progress lives on the dispute it recovers. Additive.
CREATE TYPE "DisputeReversalStatus" AS ENUM ('pending', 'uncertain', 'succeeded', 'failed');

ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'dispute_funds_recovered';
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'dispute_funds_recovered';

ALTER TABLE "PurchaseDispute" ADD COLUMN "reversalStatus" "DisputeReversalStatus",
  ADD COLUMN "reversalAmount" INTEGER,
  ADD COLUMN "stripeTransferReversalId" TEXT,
  ADD COLUMN "reversalAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "reversalNextAttemptAt" TIMESTAMP(3),
  ADD COLUMN "reversalProcessingToken" TEXT,
  ADD COLUMN "reversalProcessingStartedAt" TIMESTAMP(3),
  ADD COLUMN "reversalLastError" TEXT,
  ADD CONSTRAINT "PurchaseDispute_reversalAmount_chk" CHECK ("reversalAmount" IS NULL OR "reversalAmount" > 0);
CREATE UNIQUE INDEX "PurchaseDispute_stripeTransferReversalId_key" ON "PurchaseDispute"("stripeTransferReversalId");
CREATE INDEX "PurchaseDispute_reversalStatus_reversalNextAttemptAt_idx" ON "PurchaseDispute"("reversalStatus", "reversalNextAttemptAt");
