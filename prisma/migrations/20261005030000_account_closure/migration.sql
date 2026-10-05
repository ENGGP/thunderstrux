ALTER TABLE "User" ADD COLUMN "closedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD CONSTRAINT "User_closed_disabled_check" CHECK ("closedAt" IS NULL OR "disabledAt" IS NOT NULL);
ALTER TABLE "Order"
  ADD COLUMN "buyerEmailSnapshot" TEXT,
  ADD COLUMN "buyerFirstNameSnapshot" TEXT,
  ADD COLUMN "buyerLastNameSnapshot" TEXT,
  ADD COLUMN "buyerDisplayNameSnapshot" TEXT,
  ADD COLUMN "buyerIdentityCapturedAt" TIMESTAMP(3),
  ADD COLUMN "buyerIdentityProvenance" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyer_capture_check" CHECK (
  ("buyerIdentityCapturedAt" IS NULL AND "buyerIdentityProvenance" IS NULL AND "buyerEmailSnapshot" IS NULL AND "buyerFirstNameSnapshot" IS NULL AND "buyerLastNameSnapshot" IS NULL AND "buyerDisplayNameSnapshot" IS NULL)
  OR ("buyerIdentityCapturedAt" IS NOT NULL AND "buyerEmailSnapshot" IS NOT NULL AND "buyerIdentityProvenance" IS NOT NULL AND "buyerIdentityProvenance" = 'current_account_at_capture')
);
CREATE FUNCTION prevent_account_reopening() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."closedAt" IS NOT NULL AND (NEW."closedAt" IS DISTINCT FROM OLD."closedAt" OR NEW."disabledAt" IS NULL) THEN
    RAISE EXCEPTION 'Closed accounts cannot be reopened';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "User_permanent_closure" BEFORE UPDATE ON "User" FOR EACH ROW EXECUTE FUNCTION prevent_account_reopening();
CREATE FUNCTION preserve_order_buyer_capture() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."buyerIdentityCapturedAt" IS NOT NULL AND ROW(NEW."buyerEmailSnapshot", NEW."buyerFirstNameSnapshot", NEW."buyerLastNameSnapshot", NEW."buyerDisplayNameSnapshot", NEW."buyerIdentityCapturedAt", NEW."buyerIdentityProvenance") IS DISTINCT FROM ROW(OLD."buyerEmailSnapshot", OLD."buyerFirstNameSnapshot", OLD."buyerLastNameSnapshot", OLD."buyerDisplayNameSnapshot", OLD."buyerIdentityCapturedAt", OLD."buyerIdentityProvenance") THEN
    RAISE EXCEPTION 'Captured buyer identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Order_preserve_buyer_capture" BEFORE UPDATE ON "Order" FOR EACH ROW EXECUTE FUNCTION preserve_order_buyer_capture();
