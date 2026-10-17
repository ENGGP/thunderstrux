-- T18c: staff cancellation of a free purchase. Additive.
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'free_cancelled';

ALTER TABLE "Order" ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByUserId" TEXT,
  ADD COLUMN "cancellationReason" TEXT,
  -- Only a free purchase is cancelled this way, and always with a reason.
  ADD CONSTRAINT "Order_cancellation_chk" CHECK (
    "cancelledAt" IS NULL OR ("paymentKind" = 'free' AND "cancellationReason" IS NOT NULL AND char_length("cancellationReason") BETWEEN 8 AND 500)
  );

ALTER TABLE "Order" ADD CONSTRAINT "Order_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- T18b's restore check let a missing reason through (a NULL check passes); require one.
ALTER TABLE "PurchaseDispute" DROP CONSTRAINT "PurchaseDispute_resolution_chk",
  ADD CONSTRAINT "PurchaseDispute_resolution_chk" CHECK ("resolvedAt" IS NULL OR ("resolutionReason" IS NOT NULL AND char_length("resolutionReason") BETWEEN 8 AND 500));
