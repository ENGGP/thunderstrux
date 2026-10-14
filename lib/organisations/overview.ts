import { prisma } from "@/lib/db";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";

// Setup and order reads for the organisation dashboard. Order queries scope through the
// canonical Event owner and are skipped when the caller lacks orders:read.
export async function getOrganisationOverview(
  organisationId: string,
  { includeOrders, paidSince }: { includeOrders: boolean; paidSince: Date }
) {
  const ownedOrder = { event: { is: { organisationId } } };
  const [setup, recentOrders, monthlyPaidOrders] = await Promise.all([
    prisma.organisation.findUnique({
      where: { id: organisationId },
      select: {
        onboardingCompletedAt: true,
        stripeAccountId: true,
        stripeChargesEnabled: true
      }
    }),
    includeOrders
      ? prisma.order.findMany({
          where: ownedOrder,
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            status: true,
            quantity: true,
            totalAmount: true,
            createdAt: true,
            paidAt: true,
            event: { select: { title: true } }
          }
        })
      : Promise.resolve([]),
    includeOrders
      ? prisma.order.findMany({
          where: { ...ownedOrder, status: "paid", paidAt: { gte: paidSince } },
          select: { totalAmount: true, paidAt: true }
        })
      : Promise.resolve([])
  ]);

  return {
    profileComplete: !!setup?.onboardingCompletedAt,
    chargesReady: !!setup && isOrganisationStripeReady(setup),
    recentOrders,
    monthlyPaidOrders
  };
}
