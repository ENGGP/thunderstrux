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
    const legacyPendingCutoff = new Date(
      now.getTime() - stalePreCheckoutOrderMinutes * 60 * 1000
    );
    const reservations = await expireOldActiveReservations(tx, {
      now,
      organisationId,
      eventId,
      ticketTypeId,
      userId
    });

    const reservationBackedOrders = await tx.order.updateMany({
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

    const legacyReservationlessOrders = await tx.order.updateMany({
      where: {
        ...(organisationId ? { organisationId } : {}),
        ...(eventId ? { eventId } : {}),
        ...(ticketTypeId ? { ticketTypeId } : {}),
        ...(userId ? { userId } : {}),
        status: "pending",
        createdAt: {
          lt: legacyPendingCutoff
        },
        reservation: {
          is: null
        }
      },
      data: {
        status: "expired",
        failureReason: null
      }
    });

    const ordersUpdated =
      reservationBackedOrders.count + legacyReservationlessOrders.count;

    return {
      reservationsUpdated: reservations.count,
      reservationBackedOrdersUpdated: reservationBackedOrders.count,
      legacyReservationlessOrdersUpdated: legacyReservationlessOrders.count,
      ordersUpdated
    };
  });
}

export async function failStalePreCheckoutOrders(
  filters: Parameters<typeof runStaleOrderCleanup>[0] = {}
) {
  return runStaleOrderCleanup(filters);
}
