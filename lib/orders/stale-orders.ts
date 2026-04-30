import { prisma } from "@/lib/db";
import { expireOldActiveReservations } from "@/lib/tickets/reservations";

export const stalePreCheckoutOrderMinutes = 30;

export async function runStaleOrderCleanup({
  organisationId,
  eventId,
  ticketTypeId,
  userId
}: {
  organisationId?: string;
  eventId?: string;
  ticketTypeId?: string;
  userId?: string;
} = {}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const reservations = await expireOldActiveReservations(tx, {
      now,
      organisationId,
      eventId,
      ticketTypeId,
      userId
    });

    const orders = await tx.order.updateMany({
      where: {
        ...(organisationId ? { organisationId } : {}),
        ...(eventId ? { eventId } : {}),
        ...(ticketTypeId ? { ticketTypeId } : {}),
        ...(userId ? { userId } : {}),
        status: "pending",
        reservation: {
          is: {
            OR: [
              { status: "expired" },
              {
                expiresAt: {
                  lte: now
                }
              }
            ]
          }
        }
      },
      data: {
        status: "expired",
        failureReason: null
      }
    });

    console.log("STALE CLEANUP:", {
      organisationId,
      eventId,
      ticketTypeId,
      userId,
      reservationsUpdated: reservations.count,
      ordersUpdated: orders.count
    });

    return {
      reservationsUpdated: reservations.count,
      ordersUpdated: orders.count
    };
  });
}

export async function failStalePreCheckoutOrders(
  filters: Parameters<typeof runStaleOrderCleanup>[0] = {}
) {
  return runStaleOrderCleanup(filters);
}
