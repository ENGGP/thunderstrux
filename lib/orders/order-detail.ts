import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export class OrganisationOrderAccessError extends Error {
  constructor(message = "Order not found or access denied") {
    super(message);
    this.name = "OrganisationOrderAccessError";
  }
}

const visibleOrderStatuses: OrderStatus[] = ["paid", "failed", "expired"];

export function getStripeSessionDashboardUrl(stripeSessionId: string | null) {
  if (!stripeSessionId) {
    return null;
  }

  const isLiveMode = process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") ?? false;
  const baseUrl = isLiveMode
    ? "https://dashboard.stripe.com/payments"
    : "https://dashboard.stripe.com/test/payments";

  return `${baseUrl}?query=${encodeURIComponent(stripeSessionId)}`;
}

export async function getOrganisationOrderDetail(
  organisationId: string,
  orderId: string
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      event: {
        is: {
          organisationId
        }
      },
      status: { in: visibleOrderStatuses }
    },
    select: {
      id: true,
      organisationId: true,
      eventId: true,
      ticketTypeId: true,
      status: true,
      quantity: true,
      unitPrice: true,
      totalAmount: true,
      stripeSessionId: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      requiresCompensationReview: true,
      fulfilmentFailedAt: true,
      fulfilmentFailureReason: true,
      isManuallyRefunded: true,
      user: {
        select: {
          email: true,
          firstName: true,
          lastName: true,
          displayName: true
        }
      },
      event: {
        select: {
          id: true,
          title: true
        }
      },
      ticketType: {
        select: {
          id: true,
          name: true
        }
      },
      tickets: {
        select: {
          id: true,
          ticketType: {
            select: {
              name: true
            }
          }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!order) {
    throw new OrganisationOrderAccessError();
  }

  return {
    ...order,
    stripeDashboardUrl: getStripeSessionDashboardUrl(order.stripeSessionId)
  };
}

export async function markOrganisationOrderManuallyRefunded(
  organisationId: string,
  orderId: string
) {
  await getOrganisationOrderDetail(organisationId, orderId);

  await prisma.order.updateMany({
    where: {
      id: orderId,
      event: {
        is: {
          organisationId
        }
      },
      status: { in: visibleOrderStatuses }
    },
    data: { isManuallyRefunded: true }
  });

  return prisma.order.findFirstOrThrow({
    where: {
      id: orderId,
      event: {
        is: {
          organisationId
        }
      }
    },
    select: {
      id: true,
      isManuallyRefunded: true
    }
  });
}
