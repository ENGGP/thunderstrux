import type { Prisma } from "@prisma/client";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatMoney, orderReference } from "@/lib/format";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";

// Buyer emails for a payment that could not be honoured (T30, readiness plan
// §5): one when the order goes to payment review, one when Stripe confirms
// its compensation refund. Neither promises tickets or items, and neither
// carries provider detail. Each is keyed to its transition, so a replayed
// webhook queues nothing twice.

// A ticket order newly in payment review; `automatic` when its event refunds in full on its own.
export async function queueTicketReviewNotice(tx: Prisma.TransactionClient, orderId: string, automatic: boolean) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true, organisationId: true, totalAmount: true, sellerName: true, ...buyerIdentitySelect,
      user: { select: { email: true, firstName: true, lastName: true, displayName: true } },
      event: { select: { title: true, organisation: { select: { name: true } } } }
    }
  });
  const recipient = retainedBuyerIdentity(order)?.email;
  if (!recipient) return;
  const seller = order.sellerName ?? order.event.organisation.name;
  await enqueueNotification(tx, {
    eventKey: `payment-review/${order.id}`, recipient, template: "business_notice", organisationId: order.organisationId,
    payload: {
      subject: `We're checking your payment for ${order.event.title}`.slice(0, 200),
      message: `We received your payment of ${formatMoney(order.totalAmount)} for ${order.event.title}, but we couldn't issue your tickets, so you don't have tickets for this order. ${
        automatic ? "It is being refunded in full, and we'll email you when the refund is confirmed." : `${seller} will review it and refund you.`
      } Contact ${seller} if you have questions.`
    }
  });
}

// A membership or merchandise order newly in payment review.
export async function queueCommerceReviewNotice(tx: Prisma.TransactionClient, commerceOrderId: string) {
  const order = await tx.commerceOrder.findUniqueOrThrow({
    where: { id: commerceOrderId },
    select: { id: true, organisationId: true, kind: true, totalAmount: true, sellerName: true, buyerEmailSnapshot: true }
  });
  const what = order.kind === "membership" ? "your membership" : "your items";
  await enqueueNotification(tx, {
    eventKey: `payment-review/${order.id}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: order.organisationId,
    payload: {
      subject: `We're checking your payment to ${order.sellerName}`.slice(0, 200),
      message: `We received your payment of ${formatMoney(order.totalAmount)} for order ${orderReference(order.id)}, but we couldn't confirm ${what}, so we're refunding the full amount to your card. We'll email you when the refund is done. Contact ${order.sellerName} if you have questions.`
    }
  });
}

// PAY-025: that compensation refund came back from the buyer's bank after Stripe confirmed it.
export async function queueCompensationRefundReturnedNotice(tx: Prisma.TransactionClient, job: { id: string; orderId: string; amount: number }) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: job.orderId },
    select: {
      organisationId: true, ...buyerIdentitySelect,
      user: { select: { email: true, firstName: true, lastName: true, displayName: true } },
      event: { select: { title: true } }
    }
  });
  const recipient = retainedBuyerIdentity(order)?.email;
  if (!recipient) return;
  await enqueueNotification(tx, {
    eventKey: `compensation-refund-returned/${job.id}`, recipient, template: "business_notice", organisationId: order.organisationId,
    payload: {
      subject: "Your refund came back",
      message: `The refund of ${formatMoney(job.amount)} for your payment for ${order.event.title} came back from your bank, so it hasn't reached you. Thunderstrux will contact you to return it another way.`
    }
  });
}

// PAY-039: staff recorded a refund made outside Thunderstrux, which voids the tickets.
export async function queueManualRefundNotice(tx: Prisma.TransactionClient, orderId: string) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      organisationId: true, sellerName: true, ...buyerIdentitySelect,
      user: { select: { email: true, firstName: true, lastName: true, displayName: true } },
      event: { select: { title: true, organisation: { select: { name: true } } } }
    }
  });
  const recipient = retainedBuyerIdentity(order)?.email;
  if (!recipient) return;
  const seller = order.sellerName ?? order.event.organisation.name;
  await enqueueNotification(tx, {
    eventKey: `refund-marked/${orderId}`, recipient, template: "business_notice", organisationId: order.organisationId,
    payload: {
      subject: `Your tickets for ${order.event.title} are cancelled`.slice(0, 200),
      message: `${seller} recorded that your order for ${order.event.title} was refunded outside Thunderstrux, so your tickets are cancelled. If you haven't received your money back, contact ${seller}.`
    }
  });
}

// Stripe confirmed a ticket order's compensation refund.
export async function queueCompensationRefundNotice(tx: Prisma.TransactionClient, job: { id: string; orderId: string; amount: number }) {
  const order = await tx.order.findUniqueOrThrow({
    where: { id: job.orderId },
    select: {
      organisationId: true, sellerName: true, ...buyerIdentitySelect,
      user: { select: { email: true, firstName: true, lastName: true, displayName: true } },
      event: { select: { title: true } }
    }
  });
  const recipient = retainedBuyerIdentity(order)?.email;
  if (!recipient) return;
  await enqueueNotification(tx, {
    eventKey: `compensation-refund/${job.id}`, recipient, template: "business_notice", organisationId: order.organisationId,
    payload: {
      subject: `Refund for ${order.event.title}`.slice(0, 200),
      message: `Your payment for ${order.event.title} has been refunded: ${formatMoney(job.amount)} is on its way back to your card. Banks usually take 5 to 10 business days. No tickets were issued for this order.`
    }
  });
}
