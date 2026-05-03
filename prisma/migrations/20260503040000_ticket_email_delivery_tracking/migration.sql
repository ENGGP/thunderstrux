ALTER TABLE "Order"
ADD COLUMN "ticketEmailSentAt" TIMESTAMP(3),
ADD COLUMN "ticketEmailLastError" TEXT,
ADD COLUMN "ticketEmailResentAt" TIMESTAMP(3);
