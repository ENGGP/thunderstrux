ALTER TABLE "Organisation"
  ADD COLUMN "description" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "supportEmail" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "refundPolicy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "pickupPolicy" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'Australia/Brisbane',
  ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3),
  ADD COLUMN "profileVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "logoAssetId" TEXT,
  ADD COLUMN "coverAssetId" TEXT,
  ADD CONSTRAINT "Organisation_profile_bounds_chk" CHECK (length("description") <= 5000 AND length("supportEmail") <= 254 AND length("refundPolicy") <= 5000 AND length("pickupPolicy") <= 5000 AND length("timeZone") <= 64 AND "profileVersion" > 0);
CREATE UNIQUE INDEX "Asset_id_organisationId_key" ON "Asset"("id", "organisationId");
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_logoAssetId_id_fkey" FOREIGN KEY ("logoAssetId", "id") REFERENCES "Asset"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_coverAssetId_id_fkey" FOREIGN KEY ("coverAssetId", "id") REFERENCES "Asset"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Organisation_name_id_idx" ON "Organisation"("name", "id");
