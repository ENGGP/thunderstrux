-- T25: the merchandise catalogue. Products, their photos and the options
-- buyers pick (colour, size, price, stock). Additive; nothing sells until T27.
CREATE TYPE "MerchandiseProductStatus" AS ENUM ('draft', 'published', 'archived');

CREATE TABLE "MerchandiseProduct" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" "MerchandiseProductStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    -- Set on the first publish and never cleared: options of a product that
    -- has been on sale stop selling instead of being removed.
    "firstPublishedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchandiseProduct_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchandiseProduct_name_chk" CHECK (char_length("name") BETWEEN 1 AND 120),
    CONSTRAINT "MerchandiseProduct_description_chk" CHECK (char_length("description") <= 2000),
    CONSTRAINT "MerchandiseProduct_version_chk" CHECK ("version" >= 1),
    CONSTRAINT "MerchandiseProduct_published_chk" CHECK ("status" <> 'published' OR ("publishedAt" IS NOT NULL AND "firstPublishedAt" IS NOT NULL)),
    CONSTRAINT "MerchandiseProduct_archived_chk" CHECK (("status" = 'archived') = ("archivedAt" IS NOT NULL))
);

CREATE UNIQUE INDEX "MerchandiseProduct_id_organisationId_key" ON "MerchandiseProduct"("id", "organisationId");
CREATE INDEX "MerchandiseProduct_organisationId_status_createdAt_id_idx" ON "MerchandiseProduct"("organisationId", "status", "createdAt", "id");
ALTER TABLE "MerchandiseProduct" ADD CONSTRAINT "MerchandiseProduct_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Up to four photos, in order; each a product image of the same society.
CREATE TABLE "MerchandiseProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseProductImage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchandiseProductImage_position_chk" CHECK ("position" BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX "MerchandiseProductImage_productId_position_key" ON "MerchandiseProductImage"("productId", "position");
CREATE UNIQUE INDEX "MerchandiseProductImage_productId_assetId_key" ON "MerchandiseProductImage"("productId", "assetId");
CREATE INDEX "MerchandiseProductImage_assetId_idx" ON "MerchandiseProductImage"("assetId");
ALTER TABLE "MerchandiseProductImage" ADD CONSTRAINT "MerchandiseProductImage_productId_organisationId_fkey" FOREIGN KEY ("productId", "organisationId") REFERENCES "MerchandiseProduct"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchandiseProductImage" ADD CONSTRAINT "MerchandiseProductImage_assetId_organisationId_fkey" FOREIGN KEY ("assetId", "organisationId") REFERENCES "Asset"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One thing a buyer picks. The SKU is unique in the society for good, so a
-- receipt's SKU always names one option; options stop selling, never vanish.
CREATE TABLE "MerchandiseVariant" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "colour" TEXT NOT NULL DEFAULT '',
    "size" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL,
    "priceAmount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'aud',
    "remaining" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MerchandiseVariant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchandiseVariant_label_chk" CHECK (char_length("colour") <= 40 AND char_length("size") <= 40),
    CONSTRAINT "MerchandiseVariant_sku_chk" CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]{0,63}$'),
    CONSTRAINT "MerchandiseVariant_price_chk" CHECK ("priceAmount" BETWEEN 0 AND 99999999 AND "currency" = 'aud'),
    CONSTRAINT "MerchandiseVariant_remaining_chk" CHECK ("remaining" BETWEEN 0 AND 100000),
    CONSTRAINT "MerchandiseVariant_position_chk" CHECK ("position" >= 0),
    CONSTRAINT "MerchandiseVariant_version_chk" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "MerchandiseVariant_organisationId_sku_key" ON "MerchandiseVariant"("organisationId", "sku");
CREATE UNIQUE INDEX "MerchandiseVariant_id_organisationId_key" ON "MerchandiseVariant"("id", "organisationId");
CREATE INDEX "MerchandiseVariant_productId_position_id_idx" ON "MerchandiseVariant"("productId", "position", "id");
ALTER TABLE "MerchandiseVariant" ADD CONSTRAINT "MerchandiseVariant_productId_organisationId_fkey" FOREIGN KEY ("productId", "organisationId") REFERENCES "MerchandiseProduct"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
