-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "stripeAccountId" TEXT,
ADD COLUMN     "stripeAccountStatus" TEXT;

-- CreateIndex
CREATE INDEX "Organisation_stripeAccountId_idx" ON "Organisation"("stripeAccountId");
