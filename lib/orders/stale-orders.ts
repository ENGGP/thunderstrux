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

  return prisma.order.updateMany({
    where: {
      ...(organisationId ? { organisationId } : {}),
      ...(userId ? { userId } : {}),
      status: "pending",
      stripeSessionId: null,
      createdAt: {
        lt: staleBefore
      }
    },
    data: {
      status: "failed",
      failedAt: new Date(),
      failureReason:
        "Checkout did not reach Stripe within the expected local timeout"
    }
  });
}
