import type { OrderDisputeStatus, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";
import { getStripe } from "@/lib/stripe";

// Disputes and refunds made outside Thunderstrux (T18b). Both arrive as signed
// webhooks, but each is projected from Stripe's state as re-read here, so
// duplicate and out-of-order deliveries converge on the same result. An event
// changes an order only once its charge is verified as that order's payment.

export class PurchaseReviewError extends Error {
  constructor(readonly kind: "not_found" | "not_allowed", message: string) {
    super(message);
    this.name = "PurchaseReviewError";
  }
}

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);

// Stripe's dispute status, as the order sees it. warning_closed is an inquiry
// that never became a chargeback: the society kept the money.
const outcomeOf = (status: string): OrderDisputeStatus =>
  status === "lost" ? "lost" : status === "won" || status === "warning_closed" ? "won" : "open";

async function journalled(eventId: string) {
  return Boolean(await prisma.stripeRefundWebhookEvent.findUnique({ where: { stripeEventId: eventId } }));
}

// Records the event once; false when another delivery already did.
async function journal(tx: Prisma.TransactionClient, event: Stripe.Event) {
  const created = await tx.stripeRefundWebhookEvent.createMany({
    data: [{ stripeEventId: event.id, eventType: event.type, eventCreatedAt: new Date(event.created * 1000) }],
    skipDuplicates: true
  });
  return created.count === 1;
}

// The order a PaymentIntent paid for, and its charge: the Checkout Session
// names the order, and the money went to the account the order was sold for.
async function verifiedOrderPayment(stripe: Stripe, paymentIntentId: string) {
  const select = { id: true, stripeSessionId: true, paymentKind: true, currency: true, totalAmount: true, sellerStripeAccountId: true } as const;
  let order = await prisma.order.findFirst({ where: { stripePaymentIntentId: paymentIntentId }, select });
  if (!order) {
    const found = (await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })).data[0];
    const orderId = found?.metadata?.orderId;
    order = orderId ? await prisma.order.findFirst({ where: { id: orderId, stripeSessionId: found.id }, select }) : null;
  }
  if (!order?.stripeSessionId || order.paymentKind !== "stripe") return null;
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId, { expand: ["payment_intent"] });
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  if (
    session.metadata?.orderId !== order.id || !intent || intent.id !== paymentIntentId || intent.currency !== order.currency ||
    // Orders from before T10 have no seller snapshot and are not checked.
    (order.sellerStripeAccountId && idOf(intent.transfer_data?.destination) !== order.sellerStripeAccountId)
  ) {
    return null;
  }
  return { order, chargeId: idOf(intent.latest_charge) };
}

// charge.dispute.created / updated / closed. The first verified event puts the
// order's valid tickets under review and fences refunds, resends and
// compensation; a lost dispute voids them; a won one waits for staff to restore them.
export async function reconcileDisputeEvent(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  if (await journalled(event.id)) return;
  const stripe = getStripe();
  const intentId = idOf(dispute.payment_intent);
  const payment = intentId ? await verifiedOrderPayment(stripe, intentId) : null;
  if (!payment || payment.chargeId !== idOf(dispute.charge) || dispute.currency !== payment.order.currency || dispute.amount > payment.order.totalAmount) {
    logWarn("stripe.dispute.unmatched", { stripeEventId: event.id, disputeId: dispute.id });
    emitOperationalAlert("purchase_dispute_unmatched", { stripeEventId: event.id, disputeId: dispute.id });
    return;
  }
  const current = await stripe.disputes.retrieve(dispute.id);
  const outcome = outcomeOf(current.status);
  const orderId = payment.order.id;
  const now = new Date();
  const opened = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event)) || !(await lockOrder(tx, orderId))) return false;
    const { event: owner } = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { event: { select: { organisationId: true } } } });
    const existing = await tx.purchaseDispute.findUnique({ where: { stripeDisputeId: current.id } });
    // Restored by staff: later events are history only.
    if (existing?.resolvedAt) return false;
    const fields = {
      providerStatus: current.status, amount: current.amount, reason: current.reason,
      evidenceDueBy: current.evidence_details?.due_by ? new Date(current.evidence_details.due_by * 1000) : null,
      closedAt: outcome === "open" ? null : existing?.closedAt ?? now
    };
    await tx.purchaseDispute.upsert({
      where: { stripeDisputeId: current.id },
      create: { ...fields, orderId, organisationId: owner.organisationId, stripeDisputeId: current.id, stripeChargeId: payment.chargeId as string, currency: current.currency },
      update: fields
    });
    if (existing && outcomeOf(existing.providerStatus) === outcome) return false;
    await tx.order.update({ where: { id: orderId }, data: { disputeStatus: outcome, stripePaymentIntentId: intentId } });
    if (!existing) {
      await tx.ticket.updateMany({ where: { orderId, validity: "active" }, data: { validity: "refund_review", validityReason: "disputed", validityChangedAt: now } });
      await appendOrderLifecycleEvent(tx, { orderId, type: "dispute_opened", source: "stripe_webhook", stripeEventId: event.id, reason: current.reason, facts: { amount: current.amount } });
    }
    if (outcome === "lost") {
      await tx.ticket.updateMany({ where: { orderId, validity: "refund_review", validityReason: "disputed" }, data: { validity: "void", validityReason: "dispute_lost", validityChangedAt: now } });
    }
    if (outcome !== "open") {
      await appendOrderLifecycleEvent(tx, { orderId, type: "dispute_closed", source: "stripe_webhook", stripeEventId: event.id, reason: current.status });
    }
    await tx.auditLog.create({ data: {
      organisationId: owner.organisationId, actorUserId: null, action: `order.dispute_${existing ? outcome : "opened"}`, targetType: "Order", targetId: orderId,
      metadata: { disputeId: current.id, providerStatus: current.status, amount: current.amount }
    } });
    return !existing;
  });
  if (opened) emitOperationalAlert("purchase_dispute_opened", { orderId, disputeId: current.id, evidenceDueBy: current.evidence_details?.due_by ?? null });
  logInfo("stripe.dispute.reconciled", { stripeEventId: event.id, orderId, providerStatus: current.status });
}

// Staff restore the tickets of a dispute Stripe closed in the society's favour.
export async function restoreDisputedTickets(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw new PurchaseReviewError("not_found", "Order was not found");
    const order = await tx.order.findFirst({ where: { id: input.orderId, event: { organisationId: input.organisationId } }, select: { disputeStatus: true } });
    if (!order) throw new PurchaseReviewError("not_found", "Order was not found");
    if (order.disputeStatus !== "won") throw new PurchaseReviewError("not_allowed", "Tickets can be restored only after Stripe closes the dispute in the society's favour");
    const dispute = await tx.purchaseDispute.findFirstOrThrow({ where: { orderId: input.orderId, resolvedAt: null }, orderBy: { createdAt: "desc" } });
    await tx.purchaseDispute.update({ where: { id: dispute.id }, data: { resolvedAt: now, resolvedByUserId: input.actor.id, resolutionReason: reason } });
    const restored = await tx.ticket.updateMany({
      where: { orderId: input.orderId, validity: "refund_review", validityReason: "disputed" },
      data: { validity: "active", validityReason: null, validityChangedAt: now }
    });
    await tx.order.update({ where: { id: input.orderId }, data: { disputeStatus: null } });
    await appendOrderLifecycleEvent(tx, { orderId: input.orderId, type: "dispute_resolved", source: "staff_action", actorUserId: input.actor.id, reason, facts: { ticketCount: restored.count } });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.dispute_resolved", targetType: "Order", targetId: input.orderId,
      metadata: { disputeId: dispute.stripeDisputeId, reason, ticketCount: restored.count }
    } });
  });
}

// refund.* events that name neither a Thunderstrux refund nor a compensation
// job: a refund made in the Stripe dashboard. The order records the total
// Stripe has refunded outside Thunderstrux. A full refund voids the tickets;
// a partial one is flagged for staff, never treated as full.
export async function reconcileExternalRefundEvent(event: Stripe.Event) {
  const refund = event.data.object as Stripe.Refund;
  if (await journalled(event.id)) return;
  const stripe = getStripe();
  const intentId = idOf(refund.payment_intent);
  const payment = intentId ? await verifiedOrderPayment(stripe, intentId) : null;
  if (!payment || !intentId) {
    logWarn("stripe.refund.unmatched", { stripeEventId: event.id, refundId: refund.id });
    return;
  }
  const refunds = await stripe.refunds.list({ payment_intent: intentId, limit: 100 });
  const outside = refunds.data
    .filter((item) => item.status === "succeeded" && !item.metadata?.refundRequestId && !item.metadata?.compensationRefundJobId)
    .reduce((sum, item) => sum + item.amount, 0);
  const orderId = payment.order.id;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event)) || !(await lockOrder(tx, orderId))) return;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, totalAmount: true, externalRefundedAmount: true, event: { select: { organisationId: true } } }
    });
    if (outside === order.externalRefundedAmount) return;
    // shortcut: a later drop (a refund that failed after succeeding) is recorded but voided tickets stay void; staff review it in Stripe.
    const full = outside >= order.totalAmount && order.status === "paid";
    await tx.order.update({
      where: { id: orderId },
      data: { externalRefundedAmount: outside, externalRefundReviewedAt: null, stripePaymentIntentId: intentId, ...(full ? { refundStatus: "refunded" } : {}) }
    });
    if (full) {
      await tx.ticket.updateMany({ where: { orderId, validity: { not: "void" } }, data: { validity: "void", validityReason: "refunded_outside", validityChangedAt: now } });
    }
    await appendOrderLifecycleEvent(tx, {
      orderId, type: "external_refund_recorded", source: "stripe_webhook", stripeEventId: event.id, reason: full ? "full" : "partial", facts: { amount: outside }
    });
    await tx.auditLog.create({ data: {
      organisationId: order.event.organisationId, actorUserId: null, action: "order.external_refund_recorded", targetType: "Order", targetId: orderId,
      metadata: { refundId: refund.id, refundedOutside: outside, totalAmount: order.totalAmount }
    } });
  });
}

// Staff confirm they have looked at a partial refund made outside Thunderstrux.
export async function markExternalRefundReviewed(input: { organisationId: string; orderId: string; actor: { id: string } }) {
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw new PurchaseReviewError("not_found", "Order was not found");
    const order = await tx.order.findFirst({
      where: { id: input.orderId, event: { organisationId: input.organisationId } },
      select: { externalRefundedAmount: true, externalRefundReviewedAt: true, refundStatus: true }
    });
    if (!order) throw new PurchaseReviewError("not_found", "Order was not found");
    if (order.externalRefundReviewedAt) return;
    if (order.externalRefundedAmount === 0 || order.refundStatus === "refunded") {
      throw new PurchaseReviewError("not_allowed", "There is no partial refund to review on this order");
    }
    await tx.order.update({ where: { id: input.orderId }, data: { externalRefundReviewedAt: new Date() } });
    await appendOrderLifecycleEvent(tx, { orderId: input.orderId, type: "external_refund_reviewed", source: "staff_action", actorUserId: input.actor.id, facts: { amount: order.externalRefundedAmount } });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.external_refund_reviewed", targetType: "Order", targetId: input.orderId,
      metadata: { refundedOutside: order.externalRefundedAmount }
    } });
  });
}

// For order detail: the latest dispute, to say what Stripe reported and when.
export function latestPurchaseDispute(orderId: string) {
  return prisma.purchaseDispute.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: { stripeDisputeId: true, amount: true, providerStatus: true, evidenceDueBy: true, createdAt: true, closedAt: true, resolvedAt: true, resolutionReason: true }
  });
}
