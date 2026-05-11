-- Add an index for organiser ticket cursor pagination by event.
CREATE INDEX "Ticket_eventId_createdAt_id_idx" ON "Ticket"("eventId", "createdAt", "id");
