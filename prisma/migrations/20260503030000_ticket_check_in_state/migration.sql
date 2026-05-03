-- Add nullable ticket check-in state for organiser check-in workflows.
ALTER TABLE "Ticket" ADD COLUMN "checkedInAt" TIMESTAMP(3);

CREATE INDEX "Ticket_eventId_checkedInAt_idx" ON "Ticket"("eventId", "checkedInAt");
