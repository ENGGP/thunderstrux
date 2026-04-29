-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('active', 'confirmed', 'released', 'expired');

-- CreateTable
CREATE TABLE "TicketReservation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "userId" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "releaseReason" TEXT,

    CONSTRAINT "TicketReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TicketReservation_orderId_key" ON "TicketReservation"("orderId");

-- CreateIndex
CREATE INDEX "TicketReservation_ticketTypeId_status_expiresAt_idx" ON "TicketReservation"("ticketTypeId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "TicketReservation_orderId_idx" ON "TicketReservation"("orderId");

-- CreateIndex
CREATE INDEX "TicketReservation_userId_idx" ON "TicketReservation"("userId");

-- AddForeignKey
ALTER TABLE "TicketReservation" ADD CONSTRAINT "TicketReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReservation" ADD CONSTRAINT "TicketReservation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReservation" ADD CONSTRAINT "TicketReservation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReservation" ADD CONSTRAINT "TicketReservation_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "TicketType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketReservation" ADD CONSTRAINT "TicketReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
