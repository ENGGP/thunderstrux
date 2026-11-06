-- Payouts wait 72 hours after Stripe reports a new payout bank account or default.
ALTER TABLE "Organisation" ADD COLUMN "payoutDestinationChangedAt" TIMESTAMP(3);
