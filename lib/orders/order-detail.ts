import { lockOrderInventory, returnTicketsToSale } from "@/lib/events/inventory";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import { queueManualRefundNotice } from "@/lib/payments/compensation-notices";
import { latestRefundRequest } from "@/lib/payments/order-refunds";
import { latestPurchaseDispute } from "@/lib/payments/purchase-disputes";
import { purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import type { OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isLiveStripeKey } from "@/lib/stripe";
import { enqueueTicketEmail } from "@/lib/email/ticket-email-outbox";
import { ticketEmailRefusal, ticketEmailRefusalSelect } from "@/lib/email/ticket-delivery";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";

export class OrganisationOrderAccessError extends Error {
  constructor(message = "Order not found or access denied") {
    super(message);
    this.name = "OrganisationOrderAccessError";
  }
}

export class OrganisationOrderOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrganisationOrderOperationError";
  }
}

const visibleOrderStatuses: OrderStatus[] = ["paid", "failed", "expired"];

export function getStripeSessionDashboardUrl(stripeSessionId: string | null) {
  if (!stripeSessionId) {
    return null;
  }

  const baseUrl = isLiveStripeKey()
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
      paymentKind: true,
      purchasedTicketTypeName: true,
      quantity: true,
      unitPrice: true,
      totalAmount: true,
      stripeSessionId: true,
      createdAt: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      requiresCompensationReview: true,
      refundStatus: true,
      disputeStatus: true,
      externalRefundedAmount: true,
      externalRefundReviewedAt: true,
      stripePaymentIntentId: true,
      cancelledAt: true,
      cancellationReason: true,
      cancelledBy: { select: { firstName: true, lastName: true, email: true } },
      fulfilmentFailedAt: true,
      fulfilmentFailureReason: true,
      isManuallyRefunded: true,
      compensationRefundJob: {
        select: {
          state: true,
          providerStatus: true,
          stripeRefundId: true,
          lastErrorCode: true
        }
      },
      ...buyerIdentitySelect,
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
    user: retainedBuyerIdentity(order),
    projection: ticketOrderProjection(order),
    latestRefund: await latestRefundRequest(prisma, order.id),
    latestDispute: await latestPurchaseDispute(order.id),
    purchasedTicketType: purchasedTicketTypeLabel(order.purchasedTicketTypeName, order.ticketType.name),
    stripeDashboardUrl: getStripeSessionDashboardUrl(order.stripeSessionId)
  };
}

export async function markOrganisationOrderManuallyRefunded(
  organisationId: string,
  orderId: string,
  actorUserId: string | undefined,
  reason: string
) {
  await prisma.$transaction(async (tx) => {
    const owned = await tx.order.findFirst({
      where: {
        id: orderId,
        event: { is: { organisationId } },
        status: { in: visibleOrderStatuses }
      },
      select: { id: true }
    });
    if (!owned) throw new OrganisationOrderAccessError();
    // The mark puts the places back on sale: event and ticket type before the order.
    await lockOrderInventory(tx, orderId);
    if (!(await lockOrder(tx, orderId))) {
      throw new OrganisationOrderAccessError();
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        paymentKind: true,
        isManuallyRefunded: true,
        requiresCompensationReview: true,
        refundStatus: true,
        disputeStatus: true,
        compensationRefundJob: { select: { id: true } },
        reservation: { select: { status: true } }
      }
    });
    if (order.paymentKind === "free") {
      throw new OrganisationOrderOperationError("Free registrations have no payment to refund");
    }
    if (order.requiresCompensationReview || order.compensationRefundJob) {
      throw new OrganisationOrderOperationError(
        "Compensation refunds require verified Stripe refund confirmation"
      );
    }
    if (order.refundStatus) {
      throw new OrganisationOrderOperationError("This order has a refund through Thunderstrux");
    }
    if (order.disputeStatus === "open" || order.disputeStatus === "lost") {
      throw new OrganisationOrderOperationError("The buyer has disputed this payment");
    }
    if (order.isManuallyRefunded) return;
    const updated = await tx.order.updateMany({
      where: {
        id: orderId,
        status: { in: visibleOrderStatuses },
        isManuallyRefunded: false
      },
      data: { isManuallyRefunded: true }
    });
    if (updated.count === 0) return;
    // The buyer has their money back, so the tickets stop admitting, as after a refund made in Stripe.
    const voided = await tx.ticket.updateMany({ where: { orderId, validity: { not: "void" } }, data: { validity: "void", validityReason: "refunded_outside", validityChangedAt: new Date() } });
    await returnTicketsToSale(tx, orderId, voided.count);
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "manual_refund_marked",
      source: "staff_action",
      actorUserId,
      reason,
      fromOrderStatus: order.status,
      toOrderStatus: order.status,
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: actorUserId ?? null,
      action: "order.manual_refund_marked", targetType: "Order", targetId: orderId, metadata: { reason }
    } });
    await queueManualRefundNotice(tx, orderId);
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

export async function getOrganisationOrderResendTarget(
  organisationId: string,
  orderId: string
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      event: { is: { organisationId } },
      status: { in: visibleOrderStatuses }
    },
    select: { id: true }
  });

  if (!order) {
    throw new OrganisationOrderAccessError();
  }

  return order;
}

export async function enqueueOrganisationOrderTicketEmail(
  organisationId: string,
  orderId: string,
  actorUserId?: string
) {
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      event: { is: { organisationId } },
      status: { in: visibleOrderStatuses }
    },
    select: { id: true, ...ticketEmailRefusalSelect }
  });

  if (!order) {
    throw new OrganisationOrderAccessError();
  }

  const refusal = ticketEmailRefusal(order);
  if (refusal) throw new OrganisationOrderOperationError(refusal);

  await enqueueTicketEmail({ orderId: order.id, mode: "manual", actorUserId });
}
