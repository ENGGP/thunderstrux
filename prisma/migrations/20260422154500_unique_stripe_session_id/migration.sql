-- DropIndex
DROP INDEX IF EXISTS "Order_stripeSessionId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Order_stripeSessionId_key" ON "Order"("stripeSessionId");
