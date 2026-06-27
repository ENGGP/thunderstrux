-- P1.8 Phase 3 narrow lifecycle integrity constraints.
ALTER TABLE "Event"
  ADD CONSTRAINT "Event_endTime_after_startTime_chk" CHECK ("endTime" > "startTime");

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_paid_requires_paidAt_chk"
    CHECK ("status" <> 'paid'::"OrderStatus" OR "paidAt" IS NOT NULL),
  ADD CONSTRAINT "Order_expired_has_no_paidAt_chk"
    CHECK ("status" <> 'expired'::"OrderStatus" OR "paidAt" IS NULL);
