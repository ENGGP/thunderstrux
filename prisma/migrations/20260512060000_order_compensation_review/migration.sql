ALTER TABLE "Order"
ADD COLUMN "requiresCompensationReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fulfilmentFailedAt" TIMESTAMP(3),
ADD COLUMN "fulfilmentFailureReason" TEXT;
