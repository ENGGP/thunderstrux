CREATE TABLE "Asset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organisationId" TEXT NOT NULL REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "uploadedByUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "storageKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('logo','cover','event','product')),
  "contentType" TEXT NOT NULL DEFAULT 'image/webp' CHECK ("contentType" = 'image/webp'),
  "byteSize" INTEGER NOT NULL CHECK ("byteSize" > 0 AND "byteSize" <= 5242880),
  "width" INTEGER NOT NULL CHECK ("width" BETWEEN 1 AND 4096),
  "height" INTEGER NOT NULL CHECK ("height" BETWEEN 1 AND 4096),
  "sha256" TEXT NOT NULL CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
  "status" TEXT NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending','ready','failed','deleted')),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readyAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "unreferencedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Asset_storageKey_key" ON "Asset"("storageKey");
CREATE INDEX "Asset_organisationId_status_idx" ON "Asset"("organisationId", "status");
CREATE INDEX "Asset_status_createdAt_idx" ON "Asset"("status", "createdAt");
CREATE INDEX "Asset_uploadedByUserId_idx" ON "Asset"("uploadedByUserId");
