-- T31: analytics read fulfilled sales by time. Measured with EXPLAIN ANALYZE
-- on synthetic _test data (360k orders, 648k tickets, 88k commerce orders):
-- a 30-day ticket sales read fell from 88.6 ms to 16.5 ms and a merchandise
-- sales read from 10.6 ms to 3.1 ms. Year-long reads keep their scans.
CREATE INDEX "Order_eventId_fulfilledAt_idx" ON "Order"("eventId", "fulfilledAt");
CREATE INDEX "CommerceOrder_organisationId_kind_fulfilledAt_idx" ON "CommerceOrder"("organisationId", "kind", "fulfilledAt");
