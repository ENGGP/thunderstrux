-- P1.8 Phase 2 numeric integrity constraints.
ALTER TABLE "TicketType"
  ADD CONSTRAINT "TicketType_quantity_nonnegative_chk" CHECK ("quantity" >= 0),
  ADD CONSTRAINT "TicketType_price_nonnegative_chk" CHECK ("price" >= 0);

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_quantity_positive_chk" CHECK ("quantity" > 0),
  ADD CONSTRAINT "Order_unitPrice_nonnegative_chk" CHECK ("unitPrice" >= 0),
  ADD CONSTRAINT "Order_totalAmount_nonnegative_chk" CHECK ("totalAmount" >= 0);

ALTER TABLE "TicketReservation"
  ADD CONSTRAINT "TicketReservation_quantity_positive_chk" CHECK ("quantity" > 0);
