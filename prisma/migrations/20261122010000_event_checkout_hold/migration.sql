-- PAY-009: how long a checkout holds an event's tickets while the buyer pays,
-- 5 to 59 minutes and 20 by default, as Humanitix hosts choose. Each order keeps
-- the end time it was given. Additive: existing events take the default.
ALTER TABLE "Event" ADD COLUMN "checkoutHoldMinutes" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_checkoutHoldMinutes_chk"
  CHECK ("checkoutHoldMinutes" BETWEEN 5 AND 59);
