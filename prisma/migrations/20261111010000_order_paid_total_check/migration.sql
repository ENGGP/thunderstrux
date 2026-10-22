-- T41: a paid ticket order's total is its unit price times its quantity.
-- The integrity audit found no exception in any development database from
-- 21 Sep to 22 Oct 2026 (migration 22 onward), so the rule moves from audit
-- to constraint. Validating it fails the deploy, before the app starts, if a
-- hosted database holds an exception; investigate it rather than editing it.
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_paid_total_matches_units_chk"
  CHECK ("status" <> 'paid' OR "totalAmount" = "unitPrice" * "quantity");
