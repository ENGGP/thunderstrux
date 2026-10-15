-- T11: event capacity, visibility, sales window and version. Additive; no
-- capacity is invented for existing events, and sales close at their start.
CREATE TYPE "EventVisibility" AS ENUM ('public', 'unlisted', 'members_only');
CREATE TYPE "EventSaleState" AS ENUM ('open', 'closed');

ALTER TABLE "Event"
  ADD COLUMN "capacity" INTEGER,
  ADD COLUMN "visibility" "EventVisibility" NOT NULL DEFAULT 'public',
  ADD COLUMN "salesCloseAt" TIMESTAMP(3),
  ADD COLUMN "saleState" "EventSaleState" NOT NULL DEFAULT 'open',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Sales have always been possible until the event started, so that is the existing close time.
UPDATE "Event" SET "salesCloseAt" = "startTime";
ALTER TABLE "Event" ALTER COLUMN "salesCloseAt" SET NOT NULL;

ALTER TABLE "Event"
  ADD CONSTRAINT "Event_capacity_positive_chk" CHECK ("capacity" IS NULL OR "capacity" > 0),
  ADD CONSTRAINT "Event_version_positive_chk" CHECK ("version" > 0);
