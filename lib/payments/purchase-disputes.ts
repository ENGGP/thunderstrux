import type { OrderDisputeStatus, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { markCommerceExternalRefundReviewed } from "@/lib/commerce/payment-recovery";
import { lockOrderInventory, returnTicketsToSale } from "@/lib/events/inventory";
import { ticketReference } from "@/lib/format";
import { refundedSoFar } from "@/lib/payments/order-refunds";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { alertNeedsReview, resumeCompensationRefund } from "@/lib/payments/compensation-refunds";
import { stageDisputeEvidence } from "@/lib/payments/dispute-evidence";
import { queueDisputeReversal, unreversedRefundAmount } from "@/lib/payments/dispute-reversals";
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
// that never became a chargeback, and prevented a dispute that never went
// ahead: either way the society kept the money.
export const outcomeOf = (status: string): OrderDisputeStatus =>
  status === "lost" ? "lost" : status === "won" || status === "warning_closed" || status === "prevented" ? "won" : "open";

// PAY-037: an inquiry (warning_*) is a bank's question before any chargeback;
// no money moves, so it doesn't fence refunds or put tickets under review. Its
// sale's payout is held while it is open (lib/payouts/release.ts).
export const isInquiry = (status: string) => status.startsWith("warning_");

// A charge can carry more than one dispute; the order shows the worst, so one
// won dispute can't release another's fence or payout hold (SEC-024). Inquiries
// don't count, so a charge with only inquiries has no dispute status.
export const worstOutcome = (statuses: string[]): OrderDisputeStatus | null => {
  const outcomes = statuses.filter((status) => !isInquiry(status)).map(outcomeOf);
  if (outcomes.length === 0) return null;
  return outcomes.includes("lost") ? "lost" : outcomes.includes("open") ? "open" : "won";
};

export async function journalled(eventId: string) {
  return Boolean(await prisma.stripeRefundWebhookEvent.findUnique({ where: { stripeEventId: eventId } }));
}

// Records the event once; false when another delivery already did.
export async function journal(tx: Prisma.TransactionClient, event: Stripe.Event) {
  const created = await tx.stripeRefundWebhookEvent.createMany({
    data: [{ stripeEventId: event.id, eventType: event.type, eventCreatedAt: new Date(event.created * 1000) }],
    skipDuplicates: true
  });
  return created.count === 1;
}

// The order a PaymentIntent paid for, and its charge: the Checkout Session
// names the order, and the money went to the account the order was sold for.
export async function verifiedOrderPayment(stripe: Stripe, paymentIntentId: string) {
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
// compensation; a lost dispute voids them; a won one waits for staff to restore
// them, and releases a compensation refund it held.
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
  let forAPerson = null as Awaited<ReturnType<typeof resumeCompensationRefund>>;
  const opened = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event))) return false;
    // A lost dispute puts the places back on sale: event and ticket type before the order.
    if (outcome === "lost") await lockOrderInventory(tx, orderId);
    if (!(await lockOrder(tx, orderId))) return false;
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
    if (existing && outcomeOf(existing.providerStatus) === outcome && isInquiry(existing.providerStatus) === isInquiry(current.status)) return false;
    const all = await tx.purchaseDispute.findMany({ where: { orderId }, select: { providerStatus: true } });
    const worst = worstOutcome(all.map((row) => row.providerStatus));
    await tx.order.update({ where: { id: orderId }, data: { disputeStatus: worst, stripePaymentIntentId: intentId } });
    // Tickets go under review once there is a chargeback, not for an inquiry.
    if (!isInquiry(current.status) && (!existing || isInquiry(existing.providerStatus))) {
      await tx.ticket.updateMany({ where: { orderId, validity: "active" }, data: { validity: "refund_review", validityReason: "disputed", validityChangedAt: now } });
    }
    if (!existing) {
      await appendOrderLifecycleEvent(tx, { orderId, type: "dispute_opened", source: "stripe_webhook", stripeEventId: event.id, reason: current.reason, facts: { amount: current.amount } });
    }
    if (outcome === "lost") {
      // PAY-004: the society bears a lost dispute; the refunds worker takes the money back.
      await queueDisputeReversal(tx, current.id, now);
      const voided = await tx.ticket.updateMany({ where: { orderId, validity: "refund_review", validityReason: "disputed" }, data: { validity: "void", validityReason: "dispute_lost", validityChangedAt: now } });
      await returnTicketsToSale(tx, orderId, voided.count);
    }
    if (outcome !== "open") {
      await appendOrderLifecycleEvent(tx, { orderId, type: "dispute_closed", source: "stripe_webhook", stripeEventId: event.id, reason: current.status });
    }
    await tx.auditLog.create({ data: {
      organisationId: owner.organisationId, actorUserId: null, action: `order.dispute_${existing ? outcome : "opened"}`, targetType: "Order", targetId: orderId,
      metadata: { disputeId: current.id, providerStatus: current.status, amount: current.amount }
    } });
    if (worst === "won") forAPerson = await resumeCompensationRefund(tx, { id: orderId, organisationId: owner.organisationId }, event.id);
    return !existing;
  });
  if (forAPerson) alertNeedsReview(forAPerson, "review_required", "dispute_won");
  if (opened) {
    emitOperationalAlert("purchase_dispute_opened", { orderId, disputeId: current.id, evidenceDueBy: current.evidence_details?.due_by ?? null });
    await stageDisputeEvidence(current, { orderId });
  }
  logInfo("stripe.dispute.reconciled", { stripeEventId: event.id, orderId, providerStatus: current.status });
}

// Staff restore the tickets of a dispute Stripe closed in the society's favour.
export async function restoreDisputedTickets(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId, input.organisationId))) throw new PurchaseReviewError("not_found", "Order was not found");
    const order = await tx.order.findFirst({ where: { id: input.orderId, event: { organisationId: input.organisationId } }, select: { disputeStatus: true } });
    if (!order) throw new PurchaseReviewError("not_found", "Order was not found");
    // Every dispute still on the order must have closed in the society's favour; all of them are resolved together.
    const disputes = await tx.purchaseDispute.findMany({ where: { orderId: input.orderId, resolvedAt: null }, select: { id: true, stripeDisputeId: true, providerStatus: true } });
    if (order.disputeStatus !== "won" || !disputes.length || worstOutcome(disputes.map((row) => row.providerStatus)) !== "won") {
      throw new PurchaseReviewError("not_allowed", "Tickets can be restored only after Stripe closes every dispute in the society's favour");
    }
    await tx.purchaseDispute.updateMany({ where: { id: { in: disputes.map((row) => row.id) } }, data: { resolvedAt: now, resolvedByUserId: input.actor.id, resolutionReason: reason } });
    const restored = await tx.ticket.updateMany({
      where: { orderId: input.orderId, validity: "refund_review", validityReason: "disputed" },
      data: { validity: "active", validityReason: null, validityChangedAt: now }
    });
    await tx.order.update({ where: { id: input.orderId }, data: { disputeStatus: null } });
    await appendOrderLifecycleEvent(tx, { orderId: input.orderId, type: "dispute_resolved", source: "staff_action", actorUserId: input.actor.id, reason, facts: { ticketCount: restored.count } });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.dispute_resolved", targetType: "Order", targetId: input.orderId,
      metadata: { disputeIds: disputes.map((row) => row.stripeDisputeId), reason, ticketCount: restored.count }
    } });
  });
}

// refund.* events that name neither a Thunderstrux refund nor a compensation
// job: a refund made in the Stripe dashboard. The order records the total
// Stripe has refunded outside Thunderstrux. Once that and the refunds made here
// cover the whole order, the tickets are voided; short of that it is flagged for
// staff, who pick the tickets it covered (DEBT-002), never treated as full.
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
  // PAY-027: payouts hold what a refund didn't take back from the society.
  const unreversed = await unreversedRefundAmount(stripe, intentId);
  const orderId = payment.order.id;
  const now = new Date();
  const recorded = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event))) return false;
    // A full refund puts the places back on sale: event and ticket type before the order.
    await lockOrderInventory(tx, orderId);
    if (!(await lockOrder(tx, orderId))) return false;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, totalAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, event: { select: { organisationId: true } } }
    });
    if (outside === order.externalRefundedAmount && unreversed === order.externalUnreversedAmount) return false;
    // shortcut: a later drop (a refund that failed after succeeding) is recorded but voided tickets stay void; staff review it in Stripe.
    const refundedHere = await refundedSoFar(tx, { orderId, commerceOrderId: null });
    const full = outside + refundedHere >= order.totalAmount && order.status === "paid";
    await tx.order.update({
      where: { id: orderId },
      data: { externalRefundedAmount: outside, externalUnreversedAmount: unreversed, externalRefundReviewedAt: null, stripePaymentIntentId: intentId, ...(full ? { refundStatus: "refunded" } : {}) }
    });
    if (full) {
      const voided = await tx.ticket.updateMany({ where: { orderId, validity: { not: "void" } }, data: { validity: "void", validityReason: "refunded_outside", validityChangedAt: now } });
      await returnTicketsToSale(tx, orderId, voided.count);
    }
    await appendOrderLifecycleEvent(tx, {
      orderId, type: "external_refund_recorded", source: "stripe_webhook", stripeEventId: event.id, reason: full ? "full" : "partial", facts: { amount: outside }
    });
    await tx.auditLog.create({ data: {
      organisationId: order.event.organisationId, actorUserId: null, action: "order.external_refund_recorded", targetType: "Order", targetId: orderId,
      metadata: { refundId: refund.id, refundedOutside: outside, totalAmount: order.totalAmount, notReversed: unreversed }
    } });
    return true;
  });
  if (recorded && unreversed > 0) alertOutsideRefundNotReversed({ orderId }, unreversed);
}

// PAY-027: a refund made in Stripe's Dashboard that didn't reverse the transfer.
// Thunderstrux paid the buyer; the society's share stays held until Stripe shows it taken back.
export function alertOutsideRefundNotReversed(purchase: { orderId: string } | { commerceOrderId: string }, unreversed: number) {
  const id = "orderId" in purchase ? purchase.orderId : purchase.commerceOrderId;
  emitOperationalAlert("outside_refund_not_reversed", { ...purchase, unreversed, dedupeKey: `outside_refund_not_reversed:${id}:${unreversed}` });
}

// Staff confirm they have looked at a partial refund made outside
// Thunderstrux, on a ticket order or (PAY-003) a membership or merchandise order.
// On a ticket order they may name the tickets it covered (DEBT-002): those stop
// working and go back on sale; none picked keeps every ticket valid.
export async function markExternalRefundReviewed(input: { organisationId: string; orderId: string; actor: { id: string }; ticketIds?: string[] }) {
  const commerce = await prisma.commerceOrder.findFirst({ where: { id: input.orderId, organisationId: input.organisationId }, select: { id: true } });
  if (commerce) {
    const outcome = await prisma.$transaction(async (tx) => {
      if (!(await lockCommerceOrderForFamily(tx, commerce.id))) throw new PurchaseReviewError("not_found", "Order was not found");
      return markCommerceExternalRefundReviewed(tx, { organisationId: input.organisationId, commerceOrderId: commerce.id, actor: input.actor });
    });
    if (outcome === "nothing") throw new PurchaseReviewError("not_allowed", "There is no partial refund to review on this order");
    return;
  }
  const picked = [...new Set(input.ticketIds ?? [])];
  await prisma.$transaction(async (tx) => {
    // Tickets going back on sale lock the event and ticket type before the order.
    if (picked.length) await lockOrderInventory(tx, input.orderId);
    if (!(await lockOrder(tx, input.orderId, input.organisationId))) throw new PurchaseReviewError("not_found", "Order was not found");
    const order = await tx.order.findFirst({
      where: { id: input.orderId, event: { organisationId: input.organisationId } },
      select: { externalRefundedAmount: true, externalRefundReviewedAt: true, refundStatus: true }
    });
    if (!order) throw new PurchaseReviewError("not_found", "Order was not found");
    if (order.externalRefundReviewedAt) return;
    if (order.externalRefundedAmount === 0 || order.refundStatus === "refunded") {
      throw new PurchaseReviewError("not_allowed", "There is no partial refund to review on this order");
    }
    const now = new Date();
    if (picked.length) {
      const valid = await tx.ticket.findMany({ where: { orderId: input.orderId, id: { in: picked }, validity: "active" }, select: { id: true } });
      if (valid.length !== picked.length || picked.length !== (input.ticketIds ?? []).length) throw new PurchaseReviewError("not_allowed", "Pick tickets of this order that are still valid");
      await tx.ticket.updateMany({ where: { id: { in: picked } }, data: { validity: "void", validityReason: "refunded_outside", validityChangedAt: now } });
      await returnTicketsToSale(tx, input.orderId, picked.length);
    }
    await tx.order.update({ where: { id: input.orderId }, data: { externalRefundReviewedAt: now } });
    await appendOrderLifecycleEvent(tx, { orderId: input.orderId, type: "external_refund_reviewed", source: "staff_action", actorUserId: input.actor.id, facts: { amount: order.externalRefundedAmount, ticketCount: picked.length } });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.external_refund_reviewed", targetType: "Order", targetId: input.orderId,
      metadata: { refundedOutside: order.externalRefundedAmount, tickets: picked.map(ticketReference) }
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
