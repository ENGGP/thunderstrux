-- PAY-072: a lost dispute's transfer reversal that Stripe's later win made unnecessary.
ALTER TYPE "DisputeReversalStatus" ADD VALUE 'cancelled';

-- PAY-075 (N4): the card network's case type, so a prevented dispute counts as won only when blocked.
-- PAY-076: when Thunderstrux last read the dispute from Stripe, so a slower, older read can't overwrite a newer one.
ALTER TABLE "PurchaseDispute" ADD COLUMN "caseType" TEXT, ADD COLUMN "providerReadAt" TIMESTAMP(3);
