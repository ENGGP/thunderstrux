-- T30: a material schedule or place change to an event with issued tickets.
-- The notification worker emails each valid holder once, resuming after
-- "cursor" (the last order id it queued) if a run stops part way.
CREATE TABLE "EventChange" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "previousStartTime" TIMESTAMP(3) NOT NULL,
    "previousEndTime" TIMESTAMP(3) NOT NULL,
    "previousLocation" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "actorUserId" TEXT,
    "cursor" TEXT,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventChange_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EventChange_outcome_chk" CHECK ("outcome" IS NULL OR "outcome" IN ('sent', 'superseded')),
    CONSTRAINT "EventChange_completed_chk" CHECK (("completedAt" IS NULL) = ("outcome" IS NULL))
);
CREATE UNIQUE INDEX "EventChange_eventId_eventVersion_key" ON "EventChange"("eventId", "eventVersion");
CREATE INDEX "EventChange_completedAt_createdAt_idx" ON "EventChange"("completedAt", "createdAt");
CREATE INDEX "EventChange_organisationId_idx" ON "EventChange"("organisationId");
CREATE INDEX "EventChange_actorUserId_idx" ON "EventChange"("actorUserId");
ALTER TABLE "EventChange" ADD CONSTRAINT "EventChange_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventChange" ADD CONSTRAINT "EventChange_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventChange" ADD CONSTRAINT "EventChange_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Optional mail: the seven-day membership renewal reminder. On by default;
-- receipts, refunds, event changes and security mail ignore it.
ALTER TABLE "User" ADD COLUMN "renewalReminders" BOOLEAN NOT NULL DEFAULT true;

-- The reminder and expiry scans look up grants by end time.
CREATE INDEX "MembershipGrant_endsAt_idx" ON "MembershipGrant"("endsAt");
