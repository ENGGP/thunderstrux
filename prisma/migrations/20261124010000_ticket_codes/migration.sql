-- Discount, access and comp codes for event tickets, as Eventbrite and Humanitix
-- offer. Additive: existing ticket types stay visible, existing orders carry no
-- code and no discount.
ALTER TABLE "TicketType" ADD COLUMN "hidden" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TicketCode" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ticketTypeId" TEXT,
    "percentOff" INTEGER,
    "amountOff" INTEGER,
    "maxUses" INTEGER,
    "endsAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketCode_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TicketCode_code_chk" CHECK ("code" ~ '^[A-Z0-9-]{3,30}$'),
    -- At most one discount; a code without one only unlocks its (hidden) ticket type.
    CONSTRAINT "TicketCode_discount_chk" CHECK (
      num_nonnulls("percentOff", "amountOff") <= 1
      AND ("percentOff" IS NULL OR "percentOff" BETWEEN 1 AND 100)
      AND ("amountOff" IS NULL OR "amountOff" > 0)
      AND (num_nonnulls("percentOff", "amountOff") = 1 OR "ticketTypeId" IS NOT NULL)
    ),
    CONSTRAINT "TicketCode_maxUses_chk" CHECK ("maxUses" IS NULL OR "maxUses" > 0)
);

CREATE UNIQUE INDEX "TicketCode_eventId_code_key" ON "TicketCode"("eventId", "code");
CREATE INDEX "TicketCode_ticketTypeId_idx" ON "TicketCode"("ticketTypeId");

ALTER TABLE "TicketCode" ADD CONSTRAINT "TicketCode_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketCode" ADD CONSTRAINT "TicketCode_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order"
  ADD COLUMN "ticketCodeId" TEXT,
  ADD COLUMN "codeSnapshot" TEXT,
  ADD COLUMN "discountAmount" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "Order_discountAmount_chk" CHECK ("discountAmount" >= 0),
  ADD CONSTRAINT "Order_code_snapshot_chk" CHECK (("ticketCodeId" IS NULL) = ("codeSnapshot" IS NULL));

CREATE INDEX "Order_ticketCodeId_idx" ON "Order"("ticketCodeId");

ALTER TABLE "Order" ADD CONSTRAINT "Order_ticketCodeId_fkey" FOREIGN KEY ("ticketCodeId") REFERENCES "TicketCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
