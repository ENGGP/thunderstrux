-- T28b: an item handed back after a merchandise sale. Each row is one
-- recorded return of one line; restocking happens once, when the row is
-- written, and the operation key makes a repeated request a replay.
ALTER TYPE "CommerceLifecycleEventType" ADD VALUE 'return_recorded';

CREATE TABLE "MerchandiseReturn" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "commerceOrderId" TEXT NOT NULL,
    "commerceOrderLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "actorUserId" TEXT,
    "operationKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseReturn_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MerchandiseReturn_quantity_chk" CHECK ("quantity" BETWEEN 1 AND 10),
    CONSTRAINT "MerchandiseReturn_reason_chk" CHECK (char_length("reason") BETWEEN 3 AND 500)
);
CREATE UNIQUE INDEX "MerchandiseReturn_operationKey_key" ON "MerchandiseReturn"("operationKey");
CREATE INDEX "MerchandiseReturn_commerceOrderId_createdAt_idx" ON "MerchandiseReturn"("commerceOrderId", "createdAt");
CREATE INDEX "MerchandiseReturn_commerceOrderLineId_idx" ON "MerchandiseReturn"("commerceOrderLineId");
CREATE INDEX "MerchandiseReturn_actorUserId_idx" ON "MerchandiseReturn"("actorUserId");
-- The line's composite key keeps a return in the line's society.
ALTER TABLE "MerchandiseReturn" ADD CONSTRAINT "MerchandiseReturn_commerceOrderLineId_organisationId_fkey" FOREIGN KEY ("commerceOrderLineId", "organisationId") REFERENCES "CommerceOrderLine"("id", "organisationId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchandiseReturn" ADD CONSTRAINT "MerchandiseReturn_commerceOrderId_fkey" FOREIGN KEY ("commerceOrderId") REFERENCES "CommerceOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MerchandiseReturn" ADD CONSTRAINT "MerchandiseReturn_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
