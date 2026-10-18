-- T24b1: member prices on ticket types. An order records the membership it
-- was priced with and that membership's rights version. Additive.
ALTER TABLE "TicketType" ADD COLUMN "memberPrice" INTEGER,
  ADD CONSTRAINT "TicketType_member_price_chk" CHECK ("memberPrice" IS NULL OR ("memberPrice" >= 0 AND "memberPrice" <= "price"));

ALTER TABLE "Order" ADD COLUMN "membershipGrantId" TEXT,
  ADD COLUMN "membershipEntitlementVersion" INTEGER,
  ADD CONSTRAINT "Order_member_price_chk" CHECK (("membershipGrantId" IS NULL) = ("membershipEntitlementVersion" IS NULL));
CREATE INDEX "Order_membershipGrantId_idx" ON "Order"("membershipGrantId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_membershipGrantId_fkey" FOREIGN KEY ("membershipGrantId") REFERENCES "MembershipGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The price basis is a purchase fact: set when the order is created, never changed.
CREATE FUNCTION preserve_order_member_price() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."membershipGrantId", NEW."membershipEntitlementVersion") IS DISTINCT FROM ROW(OLD."membershipGrantId", OLD."membershipEntitlementVersion") THEN
    RAISE EXCEPTION 'An order''s member price basis is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Order_preserve_member_price" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION preserve_order_member_price();
