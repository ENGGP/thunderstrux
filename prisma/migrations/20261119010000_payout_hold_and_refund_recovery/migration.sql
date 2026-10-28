-- Payout hold and refund recovery (SEC-032, PAY-027). latestEndTime records the
-- latest end an event has had, so moving the end earlier never releases ticket
-- money sooner, whether or not any ticket is still active; it starts from the
-- latest earlier end the event's changes recorded. externalUnreversedAmount is
-- what Stripe shows refunded but not yet taken back from the society's transfer,
-- held from payouts until it is. Additive.
ALTER TABLE "Event" ADD COLUMN "latestEndTime" TIMESTAMP(3);
UPDATE "Event" AS e SET "latestEndTime" = changed."latestEnd"
FROM (SELECT "eventId", MAX("previousEndTime") AS "latestEnd" FROM "EventChange" GROUP BY "eventId") AS changed
WHERE changed."eventId" = e."id" AND changed."latestEnd" > e."endTime";
ALTER TABLE "Order" ADD COLUMN "externalUnreversedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "CommerceOrder" ADD COLUMN "externalUnreversedAmount" INTEGER NOT NULL DEFAULT 0;
