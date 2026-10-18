-- A purchase link can open one merchandise order as well as one ticket order.
-- Additive: a new nullable column, and the scope check now allows a purchase
-- link to name exactly one of the two. Checkout links still name none.
ALTER TABLE "GuestAccessGrant" ADD COLUMN "commerceOrderId" TEXT;
CREATE INDEX "GuestAccessGrant_commerceOrderId_idx" ON "GuestAccessGrant"("commerceOrderId");
ALTER TABLE "GuestAccessGrant" ADD CONSTRAINT "GuestAccessGrant_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GuestAccessGrant" DROP CONSTRAINT "GuestAccessGrant_purpose_scope_chk";
ALTER TABLE "GuestAccessGrant" ADD CONSTRAINT "GuestAccessGrant_purpose_scope_chk" CHECK (
  ("purpose" = 'checkout' AND "orderId" IS NULL AND "commerceOrderId" IS NULL)
  OR ("purpose" = 'purchase' AND num_nonnulls("orderId", "commerceOrderId") = 1)
);
