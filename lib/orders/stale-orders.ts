import { prisma } from "@/lib/db";

export const stalePreCheckoutOrderMinutes = 30;

export async function failStalePreCheckoutOrders({
  organisationId,
  userId
}: {
  organisationId?: string;
  userId?: string;
} = {}) {
  const staleBefore = new Date(
    Date.now() - stalePreCheckoutOrderMinutes * 60 * 1000
  );

  return prisma.$transaction(async (tx) => {
    const staleOrders = await tx.order.findMany({
      where: {
        ...(organisationId ? { organisationId } : {}),
        ...(userId ? { userId } : {}),
        status: "pending",
        stripeSessionId: null,
        createdAt: {
          lt: staleBefore
        }
      },
      select: { id: true }
    });
    const staleOrderIds = staleOrders.map((order) => order.id);
    const now = new Date();

    if (staleOrderIds.length === 0) {
      return { count: 0 };
    }

    const failedOrders = await tx.order.updateMany({
      where: {
        id: { in: staleOrderIds }
      },
      data: {
        status: "failed",
        failedAt: now,
        failureReason:
          "Checkout did not reach Stripe within the expected local timeout"
      }
    });

    await tx.ticketReservation.updateMany({
      where: {
        orderId: { in: staleOrderIds },
        status: "active"
      },
      data: {
        status: "released",
        releasedAt: now,
        releaseReason:
          "Checkout did not reach Stripe within the expected local timeout"
      }
    });

    return failedOrders;
  });
}
