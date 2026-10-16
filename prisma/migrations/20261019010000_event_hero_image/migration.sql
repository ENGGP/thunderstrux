-- T11b: an optional event image. Additive; the composite reference keeps the
-- image in the event's own society.
ALTER TABLE "Event" ADD COLUMN "heroAssetId" TEXT;

CREATE INDEX "Event_heroAssetId_idx" ON "Event"("heroAssetId");

ALTER TABLE "Event" ADD CONSTRAINT "Event_heroAssetId_organisationId_fkey" FOREIGN KEY ("heroAssetId", "organisationId") REFERENCES "Asset"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
