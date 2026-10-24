-- PAY-005: a society is paid out once its event is over (design round F1).
-- Connected accounts move to manual payouts; the payouts worker sends what is
-- no longer held and records each payout here, and Stripe's payout events keep
-- its status. Additive.
CREATE TYPE "SocietyPayoutStatus" AS ENUM ('pending', 'paid', 'failed');

ALTER TABLE "Organisation" ADD COLUMN "payoutCheckedAt" TIMESTAMP(3);

CREATE TABLE "SocietyPayout" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "stripeAccountId" TEXT NOT NULL,
  "stripePayoutId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "status" "SocietyPayoutStatus" NOT NULL DEFAULT 'pending',
  "failureMessage" TEXT,
  "arrivalDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SocietyPayout_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SocietyPayout_amount_chk" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "SocietyPayout_stripePayoutId_key" ON "SocietyPayout"("stripePayoutId");
CREATE INDEX "SocietyPayout_organisationId_createdAt_idx" ON "SocietyPayout"("organisationId", "createdAt");
ALTER TABLE "SocietyPayout" ADD CONSTRAINT "SocietyPayout_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
