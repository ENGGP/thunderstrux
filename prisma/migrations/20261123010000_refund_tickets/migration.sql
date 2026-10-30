-- Per-ticket refunds (DEBT-002), as Humanitix: a refund names the tickets it is
-- for, whether it cancels them, and whether the buyer is emailed, with an
-- optional note from the society. Additive: existing requests were whole-order
-- refunds, which an empty ticket list with these defaults still means.
ALTER TABLE "RefundRequest"
  ADD COLUMN "ticketIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "cancelsTickets" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyBuyer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "buyerMessage" TEXT,
  ADD CONSTRAINT "RefundRequest_buyerMessage_chk" CHECK ("buyerMessage" IS NULL OR char_length("buyerMessage") BETWEEN 1 AND 500);

-- Staff cancel paid tickets without a refund (amount 0): its own history step.
ALTER TYPE "OrderLifecycleEventType" ADD VALUE 'tickets_cancelled';
