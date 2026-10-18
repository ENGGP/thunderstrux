-- T27a: a merchandise order line names the option it sold. Holds are not a
-- separate table: a pending, unexpired Stripe order's lines hold their stock,
-- so a hold ends exactly when its order is paid, fails or expires.
ALTER TABLE "CommerceOrderLine" ADD COLUMN "merchandiseVariantId" TEXT,
  ADD CONSTRAINT "CommerceOrderLine_merchandise_variant_chk" CHECK ("merchandiseVariantId" IS NULL OR "kind" = 'merchandise');
CREATE INDEX "CommerceOrderLine_merchandiseVariantId_idx" ON "CommerceOrderLine"("merchandiseVariantId");
CREATE UNIQUE INDEX "CommerceOrderLine_orderId_merchandiseVariantId_key" ON "CommerceOrderLine"("orderId", "merchandiseVariantId");
ALTER TABLE "CommerceOrderLine" ADD CONSTRAINT "CommerceOrderLine_merchandiseVariantId_organisationId_fkey" FOREIGN KEY ("merchandiseVariantId", "organisationId") REFERENCES "MerchandiseVariant"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
