-- One Stripe account per society (SEC-035). Two societies on one account would
-- each subtract only their own held money, so a payout run could send the
-- other's. NULLs stay allowed for societies not connected. Replaces the plain
-- index; dev and the preview had no duplicates when this was written.
DROP INDEX "Organisation_stripeAccountId_idx";
CREATE UNIQUE INDEX "Organisation_stripeAccountId_key" ON "Organisation"("stripeAccountId");
