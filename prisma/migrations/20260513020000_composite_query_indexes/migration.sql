-- P1.10 composite indexes for real query shapes.
CREATE INDEX "Event_status_startTime_id_idx" ON "Event"("status", "startTime", "id");

CREATE INDEX "Order_eventId_status_createdAt_id_idx" ON "Order"("eventId", "status", "createdAt", "id");
CREATE INDEX "Order_userId_status_createdAt_id_idx" ON "Order"("userId", "status", "createdAt", "id");
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

CREATE INDEX "TicketReservation_status_expiresAt_idx" ON "TicketReservation"("status", "expiresAt");
