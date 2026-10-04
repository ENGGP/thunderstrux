CREATE TABLE "NotificationOutbox" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "eventKey" TEXT NOT NULL, "recipient" TEXT NOT NULL, "template" TEXT NOT NULL,
 "templateVersion" INTEGER NOT NULL DEFAULT 1, "privacy" TEXT NOT NULL,
 "userId" TEXT, "organisationId" TEXT, "encryptedPayload" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'pending', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "processingStartedAt" TIMESTAMP(3), "processingToken" TEXT,
 "firstAttemptAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3), "acceptedAt" TIMESTAMP(3),
 "providerMessageId" TEXT, "lastError" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "NotificationOutbox_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 CONSTRAINT "NotificationOutbox_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "NotificationOutbox_status_check" CHECK ("status" IN ('pending','processing','sent','failed','cancelled')),
 CONSTRAINT "NotificationOutbox_privacy_check" CHECK (("privacy" = 'security' AND "organisationId" IS NULL) OR ("privacy" = 'business' AND "organisationId" IS NOT NULL)),
 CONSTRAINT "NotificationOutbox_attempts_check" CHECK ("attempts" >= 0 AND "templateVersion" > 0)
);
CREATE UNIQUE INDEX "NotificationOutbox_eventKey_recipient_templateVersion_key" ON "NotificationOutbox"("eventKey","recipient","templateVersion");
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status","nextAttemptAt");
CREATE INDEX "NotificationOutbox_status_processingStartedAt_idx" ON "NotificationOutbox"("status","processingStartedAt");
CREATE INDEX "NotificationOutbox_organisationId_privacy_status_createdAt_idx" ON "NotificationOutbox"("organisationId","privacy","status","createdAt");
CREATE INDEX "NotificationOutbox_userId_idx" ON "NotificationOutbox"("userId");
