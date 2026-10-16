-- T16b: guests check out under their verified session, and a purchase link
-- opens exactly one order. Additive.
ALTER TYPE "CheckoutActorKind" ADD VALUE 'guest';

ALTER TABLE "GuestAccessGrant" ADD COLUMN "orderId" TEXT;
CREATE INDEX "GuestAccessGrant_orderId_idx" ON "GuestAccessGrant"("orderId");
ALTER TABLE "GuestAccessGrant" ADD CONSTRAINT "GuestAccessGrant_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A purchase link always names its order; a checkout link never does.
ALTER TABLE "GuestAccessGrant" ADD CONSTRAINT "GuestAccessGrant_purpose_scope_chk" CHECK (
  ("purpose" = 'checkout' AND "orderId" IS NULL) OR ("purpose" = 'purchase' AND "orderId" IS NOT NULL)
);
