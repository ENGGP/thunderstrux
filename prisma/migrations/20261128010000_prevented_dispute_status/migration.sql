-- PAY-087: a dispute Stripe closed as `prevented` before 20261127010000 has no case type, so it
-- now reads as open (PAY-075 fails closed), but its order kept the `won` it was given then
-- (a commerce order keeps no status for a win). Recompute those orders as open, so payouts,
-- refunds and restore agree with the dispute row. Rerunning it changes nothing.
UPDATE "Order" AS o SET "disputeStatus" = 'open'
WHERE o."disputeStatus" = 'won'
  AND EXISTS (SELECT 1 FROM "PurchaseDispute" AS d WHERE d."orderId" = o."id" AND d."providerStatus" = 'prevented' AND d."caseType" IS NULL);

UPDATE "CommerceOrder" AS c SET "disputeStatus" = 'open'
WHERE c."disputeStatus" IS NULL
  AND EXISTS (SELECT 1 FROM "PurchaseDispute" AS d WHERE d."commerceOrderId" = c."id" AND d."providerStatus" = 'prevented' AND d."caseType" IS NULL);
