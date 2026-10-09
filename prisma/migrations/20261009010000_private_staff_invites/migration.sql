ALTER TABLE "OrganisationStaffInvite" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "OrganisationStaffInvite" ADD CONSTRAINT "OrganisationStaffInvite_version_check" CHECK ("version" > 0);
CREATE INDEX "OrganisationStaffInvite_email_acceptedAt_revokedAt_idx" ON "OrganisationStaffInvite"("email", "acceptedAt", "revokedAt");
ALTER TABLE "NotificationOutbox" ADD COLUMN "staffInviteId" TEXT, ADD COLUMN "staffInviteVersion" INTEGER;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_staffInviteId_fkey" FOREIGN KEY ("staffInviteId") REFERENCES "OrganisationStaffInvite"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationOutbox" ADD CONSTRAINT "NotificationOutbox_invite_version_check" CHECK (("staffInviteVersion" IS NULL OR "staffInviteVersion" > 0) AND ("staffInviteId" IS NULL OR ("template" = 'staff_invite' AND "privacy" = 'security' AND "staffInviteVersion" IS NOT NULL)));
CREATE INDEX "NotificationOutbox_staffInviteId_idx" ON "NotificationOutbox"("staffInviteId");
