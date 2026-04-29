import { prisma } from "@/lib/db";
import { expireOldActiveReservations } from "@/lib/tickets/reservations";

export const stalePreCheckoutOrderMinutes = 30;

export async function failStalePreCheckoutOrders({
  organisationId,
  userId
}: {
  organisationId?: string;
  userId?: string;
} = {}) {
  return prisma.$transaction(async (tx) => {
    return expireOldActiveReservations(tx, {
      organisationId,
      userId
    });
  });
}
