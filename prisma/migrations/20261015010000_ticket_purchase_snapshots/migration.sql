-- T10: purchase snapshots and ticket validity. Additive; backfills only facts the
-- existing rows prove. Unknown historical names, sellers and fees stay null.
CREATE TYPE "PaymentKind" AS ENUM ('stripe', 'free');
CREATE TYPE "TicketValidity" AS ENUM ('active', 'void', 'refund_review');

ALTER TABLE "Order"
  ADD COLUMN "paymentKind" "PaymentKind",
  ADD COLUMN "fulfilledAt" TIMESTAMP(3),
  ADD COLUMN "purchasedTicketTypeName" TEXT,
  ADD COLUMN "sellerName" TEXT,
  ADD COLUMN "sellerStripeAccountId" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'aud',
  ADD COLUMN "feeAmount" INTEGER,
  ADD COLUMN "feePolicyVersion" TEXT,
  ADD COLUMN "snapshotVersion" INTEGER;

-- Checkout has always rejected totals of zero, so every existing order is a Stripe order.
UPDATE "Order" SET "paymentKind" = 'stripe';
ALTER TABLE "Order" ALTER COLUMN "paymentKind" SET NOT NULL;

-- Tickets are created inside the fulfilment transaction, so the first ticket time is when the order was fulfilled.
UPDATE "Order" AS o
SET "fulfilledAt" = issued."firstIssuedAt"
FROM (SELECT "orderId", MIN("createdAt") AS "firstIssuedAt" FROM "Ticket" GROUP BY "orderId") AS issued
WHERE issued."orderId" = o."id" AND o."status" = 'paid'::"OrderStatus";

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_fulfilled_requires_paid_chk"
    CHECK ("fulfilledAt" IS NULL OR "status" = 'paid'::"OrderStatus"),
  ADD CONSTRAINT "Order_free_has_zero_total_chk"
    CHECK ("paymentKind" <> 'free'::"PaymentKind" OR "totalAmount" = 0),
  ADD CONSTRAINT "Order_feeAmount_bounds_chk"
    CHECK ("feeAmount" IS NULL OR ("feeAmount" >= 0 AND "feeAmount" <= "totalAmount"));

-- Buyer identity is now captured when the order is created, as well as at account closure.
ALTER TABLE "Order" DROP CONSTRAINT "Order_buyer_capture_check";
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyer_capture_check" CHECK (
  ("buyerIdentityCapturedAt" IS NULL AND "buyerIdentityProvenance" IS NULL AND "buyerEmailSnapshot" IS NULL AND "buyerFirstNameSnapshot" IS NULL AND "buyerLastNameSnapshot" IS NULL AND "buyerDisplayNameSnapshot" IS NULL)
  OR ("buyerIdentityCapturedAt" IS NOT NULL AND "buyerEmailSnapshot" IS NOT NULL AND "buyerIdentityProvenance" IS NOT NULL AND "buyerIdentityProvenance" IN ('current_account_at_capture', 'purchase'))
);

ALTER TABLE "Ticket"
  ADD COLUMN "issueSequence" INTEGER,
  ADD COLUMN "validity" "TicketValidity" NOT NULL DEFAULT 'active',
  ADD COLUMN "validityReason" TEXT,
  ADD COLUMN "validityChangedAt" TIMESTAMP(3);

-- Number existing units in issue order. The integrity audit reports any order with more units than its quantity.
UPDATE "Ticket" AS t
SET "issueSequence" = numbered."sequence"
FROM (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "orderId" ORDER BY "createdAt", "id")::INTEGER AS "sequence"
  FROM "Ticket"
) AS numbered
WHERE numbered."id" = t."id";
ALTER TABLE "Ticket" ALTER COLUMN "issueSequence" SET NOT NULL;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_issueSequence_positive_chk" CHECK ("issueSequence" > 0);
CREATE UNIQUE INDEX "Ticket_orderId_issueSequence_key" ON "Ticket"("orderId", "issueSequence");
