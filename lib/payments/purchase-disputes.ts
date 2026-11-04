import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { markCommerceExternalRefundReviewed } from "@/lib/commerce/payment-recovery";
import { lockOrderInventory, returnTicketsToSale } from "@/lib/events/inventory";
import { ticketReference } from "@/lib/format";
import { OrderRefundError, closeRepaidReview, openOrderRefund, refundedSoFar, reopenRepaidReview } from "@/lib/payments/order-refunds";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { alertNeedsReview, resumeCompensationRefund } from "@/lib/payments/compensation-refunds";
import { stageDisputeEvidence } from "@/lib/payments/dispute-evidence";
import { caseTypeOf, isInquiry, outcomeOf, worstOutcome } from "@/lib/payments/dispute-outcome";
import { outsideRefundOwed, queueDisputeReversal } from "@/lib/payments/dispute-reversals";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";
import { releasedEarlyShare, shareRefundsSelect } from "@/lib/payouts/release";
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

// What only a person can settle about a dispute: lost for part of a payment
// (PAY-074), won after its loss on a used order (PAY-073), lost again after staff
// restored the tickets (PAY-076), or prevented without a block (PAY-075).
export type DisputeReview = "lost_for_part" | "won_after_loss" | "lost_after_restore" | "prevented_unconfirmed";
export function alertDisputeReview(purchase: { orderId: string } | { commerceOrderId: string }, dispute: { id: string; status: string }, reason: DisputeReview) {
  emitOperationalAlert("purchase_dispute_needs_review", {
    ...purchase, disputeId: dispute.id, providerStatus: dispute.status, reason, dedupeKey: `purchase_dispute_needs_review:${dispute.id}:${dispute.status}:${reason}`
  });
}

// Why a dispute event changed nothing (#38): the payment is no order's, the charge
// isn't the order's, or the currency differs.
export function alertDisputeUnmatched(event: Stripe.Event, dispute: Stripe.Dispute, reason: "no_order" | "other_charge" | "currency") {
  logWarn("stripe.dispute.unmatched", { stripeEventId: event.id, disputeId: dispute.id, reason });
  emitOperationalAlert("purchase_dispute_unmatched", { stripeEventId: event.id, disputeId: dispute.id, reason });
}

// One record of a Stripe dispute for ticket and commerce orders alike, under the
// purchase's lock. Null when the order needn't change: a newer read already
// landed (PAY-076: deliveries race, and a slower read of an older state must not
// overwrite it), or Stripe's outcome is the one recorded. A restored dispute that
// Stripe moves again is live again (PAY-076).
export async function recordDispute(tx: Prisma.TransactionClient, input: {
  current: Stripe.Dispute; readAt: Date; now: Date; chargeId: string; organisationId: string;
  scope: { orderId: string } | { commerceOrderId: string };
}) {
  const { current, readAt, now, scope } = input;
  const existing = await tx.purchaseDispute.findUnique({ where: { stripeDisputeId: current.id } });
  if (existing?.providerReadAt && existing.providerReadAt > readAt) return null;
  const caseType = caseTypeOf(current);
  const outcome = outcomeOf(current.status, caseType);
  const previous = existing ? outcomeOf(existing.providerStatus, existing.caseType) : null;
  const changed = !existing || previous !== outcome || isInquiry(existing.providerStatus) !== isInquiry(current.status);
  const fields = {
    providerStatus: current.status, caseType, providerReadAt: readAt, amount: current.amount, reason: current.reason,
    evidenceDueBy: current.evidence_details?.due_by ? new Date(current.evidence_details.due_by * 1000) : null,
    closedAt: outcome === "open" ? null : existing?.closedAt ?? now,
    ...(existing?.resolvedAt && changed ? { resolvedAt: null, resolvedByUserId: null, resolutionReason: null } : {})
  };
  await tx.purchaseDispute.upsert({
    where: { stripeDisputeId: current.id },
    create: { ...fields, ...scope, organisationId: input.organisationId, stripeDisputeId: current.id, stripeChargeId: input.chargeId, currency: current.currency },
    update: fields
  });
  if (!changed) return null;
  const rows = await tx.purchaseDispute.findMany({ where: scope, select: { providerStatus: true, caseType: true, amount: true } });
  // What the bank took back: every lost chargeback's amount, for a partial loss (PAY-074).
  const lostAmount = rows.filter((row) => !isInquiry(row.providerStatus) && outcomeOf(row.providerStatus, row.caseType) === "lost").reduce((sum, row) => sum + row.amount, 0);
  const review: DisputeReview | null = current.status === "prevented" && outcome === "open" ? "prevented_unconfirmed" : null;
  return { existing, outcome, previous, worst: worstOutcome(rows), lostAmount, restored: Boolean(existing?.resolvedAt), review };
}

// PAY-072: a dispute Stripe turned won after its loss no longer owes the society's
// share back: a reversal not yet sent is cancelled (the worker re-reads Stripe
// before sending one it already claimed).
export async function cancelQueuedReversals(tx: Prisma.TransactionClient, scope: { orderId: string } | { commerceOrderId: string }) {
  await tx.purchaseDispute.updateMany({
    where: { ...scope, reversalStatus: { in: ["pending", "uncertain"] }, reversalProcessingToken: null },
    data: { reversalStatus: "cancelled", reversalNextAttemptAt: null }
  });
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

// charge.dispute.* (and funds_reinstated / funds_withdrawn, re-read the same way).
// A chargeback puts the order's valid tickets under review and fences refunds,
// resends and compensation. A loss of the whole payment voids them and closes a
// review it repaid; a loss of part leaves them valid for staff to pick (PAY-074).
// A win waits for staff to restore them, releases a compensation refund it held,
// and on a cancelled event opens the refund the cancellation couldn't. A win after
// a loss cancels the reversal still owed and refunds the buyer (PAY-072, PAY-073).
export async function reconcileDisputeEvent(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  if (await journalled(event.id)) return;
  const stripe = getStripe();
  const intentId = idOf(dispute.payment_intent);
  const payment = intentId ? await verifiedOrderPayment(stripe, intentId) : null;
  // PAY-078: no amount check. A currency conversion can make a verified dispute larger than its order.
  if (!payment) return alertDisputeUnmatched(event, dispute, "no_order");
  if (payment.chargeId !== idOf(dispute.charge)) return alertDisputeUnmatched(event, dispute, "other_charge");
  if (dispute.currency !== payment.order.currency) return alertDisputeUnmatched(event, dispute, "currency");
  // Read before Stripe answers, so a slower read of an older state loses (PAY-076).
  const readAt = new Date();
  const current = await stripe.disputes.retrieve(dispute.id);
  const outcome = outcomeOf(current.status, caseTypeOf(current));
  const orderId = payment.order.id;
  const now = new Date();
  let forAPerson = null as Awaited<ReturnType<typeof resumeCompensationRefund>>;
  let partReturned = false as boolean;
  let review = null as DisputeReview | null;
  // EVT-012, PAY-073: why a refund the buyer is owed didn't open, and any of it already paid out.
  let refused = null as string | null;
  let releasedEarly = null as { organisationId: string; eventId: string; amount: number } | null;
  const opened = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event))) return false;
    // A lost dispute puts the places back on sale: event and ticket type before the order.
    if (outcome === "lost") await lockOrderInventory(tx, orderId);
    if (!(await lockOrder(tx, orderId))) return false;
    const { event: owner, requiresCompensationReview, status, paymentKind, isManuallyRefunded, totalAmount, externalRefundedAmount } = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { requiresCompensationReview: true, status: true, paymentKind: true, isManuallyRefunded: true, totalAmount: true, externalRefundedAmount: true, event: { select: { id: true, organisationId: true, cancelledAt: true, cancellationReason: true } } }
    });
    const record = await recordDispute(tx, { current, readAt, now, chargeId: payment.chargeId as string, organisationId: owner.organisationId, scope: { orderId } });
    if (!record) return false;
    const { existing, worst } = record;
    review = record.review;
    await tx.order.update({ where: { id: orderId }, data: { disputeStatus: worst, stripePaymentIntentId: intentId } });
    // Tickets go under review for a chargeback, not an inquiry, and again when a won or restored one reopens.
    if (!isInquiry(current.status) && (outcome === "open" || !existing || isInquiry(existing.providerStatus))) {
      await tx.ticket.updateMany({ where: { orderId, validity: "active" }, data: { validity: "refund_review", validityReason: "disputed", validityChangedAt: now } });
    }
    if (!existing) {
      await appendOrderLifecycleEvent(tx, { orderId, type: "dispute_opened", source: "stripe_webhook", stripeEventId: event.id, reason: current.reason, facts: { amount: current.amount } });
    }
    if (outcome === "lost") {
      // PAY-004: the society bears a lost dispute; the refunds worker takes the money back.
      await queueDisputeReversal(tx, current.id, now);
      const refundedHere = await refundedSoFar(tx, { orderId, commerceOrderId: null });
      if (record.lostAmount + refundedHere + externalRefundedAmount >= totalAmount) {
        // Every ticket still standing, including any staff restored before this loss.
        const voided = await tx.ticket.updateMany({ where: { orderId, validity: { not: "void" } }, data: { validity: "void", validityReason: "dispute_lost", validityChangedAt: now } });
        await returnTicketsToSale(tx, orderId, voided.count);
      } else {
        // PAY-074: the bank took back part of the payment. The tickets stand until staff pick
        // the ones it covered; the payout holds the rest of the sale.
        await tx.ticket.updateMany({ where: { orderId, validity: "refund_review", validityReason: "disputed" }, data: { validity: "active", validityReason: null, validityChangedAt: now } });
        if (!requiresCompensationReview) review = "lost_for_part";
      }
      if (record.restored) review ??= "lost_after_restore";
    }
    if (outcome !== "open") {
      await appendOrderLifecycleEvent(tx, { orderId, type: "dispute_closed", source: "stripe_webhook", stripeEventId: event.id, reason: current.status });
    }
    await tx.auditLog.create({ data: {
      organisationId: owner.organisationId, actorUserId: null, action: `order.dispute_${existing ? outcome : "opened"}`, targetType: "Order", targetId: orderId,
      metadata: { disputeId: current.id, providerStatus: current.status, amount: current.amount }
    } });
    if (worst === "won") {
      let refundReason = null as string | null;
      if (record.previous === "lost") {
        await cancelQueuedReversals(tx, { orderId });
        // PAY-073: the bank re-billed the buyer for a loss that voided their tickets. Places may be
        // resold and the event over, so the buyer is refunded, never restored. A used order, or one
        // lost for part with tickets still standing, is a person's call.
        if (await tx.ticket.count({ where: { orderId, validity: "void", validityReason: "dispute_lost" } })) {
          if (await tx.ticket.count({ where: { orderId, OR: [{ checkedInAt: { not: null } }, { validity: { not: "void" } }] } })) review = "won_after_loss";
          else refundReason = "The bank returned this payment, then reversed its decision: the buyer is refunded";
        }
      }
      await reopenRepaidReview(tx, { orderId, commerceOrderId: null }, event.id);
      forAPerson = await resumeCompensationRefund(tx, { id: orderId, organisationId: owner.organisationId }, event.id);
      // EVT-012: the event is off, so the buyer is owed this, as their cancellation email said.
      refundReason ??= owner.cancelledAt ? `Event cancelled: ${owner.cancellationReason ?? ""}`.slice(0, 500) : null;
      if (refundReason && status === "paid" && paymentKind === "stripe" && !isManuallyRefunded) {
        try {
          await openOrderRefund(tx, { organisationId: owner.organisationId, orderId, actor: null, reason: refundReason });
          if (owner.cancelledAt) {
            const sale = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { paidAt: true, totalAmount: true, feeAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, ...shareRefundsSelect } });
            const amount = releasedEarlyShare(sale, now);
            if (amount > 0) releasedEarly = { organisationId: owner.organisationId, eventId: owner.id, amount };
          }
        } catch (error) {
          if (!(error instanceof OrderRefundError)) throw error;
          if (error.kind !== "already_refunded" && error.kind !== "in_progress") refused = error.kind;
        }
      }
    }
    if (outcome === "lost") partReturned = !(await closeRepaidReview(tx, { orderId, commerceOrderId: null, organisationId: owner.organisationId }, { source: "stripe_webhook", stripeEventId: event.id })) && requiresCompensationReview;
    return !existing;
  });
  if (forAPerson) alertNeedsReview(forAPerson, forAPerson.state, "dispute_won");
  if (partReturned) alertPartReturned({ orderId });
  if (review) alertDisputeReview({ orderId }, current, review);
  if (refused) emitOperationalAlert("refund_failed", { orderId, reason: refused, dedupeKey: `refund_failed:${orderId}:${refused}` });
  if (releasedEarly) emitOperationalAlert("event_cancelled_after_release", { ...releasedEarly, orders: 1 });
  if (opened) {
    emitOperationalAlert("purchase_dispute_opened", { orderId, disputeId: current.id, evidenceDueBy: current.evidence_details?.due_by ?? null });
    await stageDisputeEvidence(current, { orderId });
  }
  logInfo("stripe.dispute.reconciled", { stripeEventId: event.id, orderId, providerStatus: current.status });
}

// PAY-057: a lost dispute returned only part of a payment under review, and it fences
// the refund of the rest, so a person has to send that.
export function alertPartReturned(purchase: { orderId: string } | { commerceOrderId: string }) {
  emitOperationalAlert("paid_but_unfulfilled_compensation_required", { ...purchase, reason: "dispute_lost_for_part" });
}

// Staff restore the tickets of a dispute Stripe closed in the society's favour.
export async function restoreDisputedTickets(input: { organisationId: string; orderId: string; actor: { id: string }; reason: string }) {
  const reason = input.reason.trim();
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId, input.organisationId))) throw new PurchaseReviewError("not_found", "Order was not found");
    const order = await tx.order.findFirst({ where: { id: input.orderId, event: { organisationId: input.organisationId } }, select: { disputeStatus: true, refundStatus: true } });
    if (!order) throw new PurchaseReviewError("not_found", "Order was not found");
    // EVT-012: a refund voids these tickets, so a stale page mustn't bring them back beside it.
    if (order.refundStatus) throw new PurchaseReviewError("not_allowed", "This order has a refund, so its tickets can't be restored");
    // PAY-073: a loss voided them and may have resold their places; a later win refunds the buyer instead.
    if (await tx.ticket.count({ where: { orderId: input.orderId, validity: "void", validityReason: "dispute_lost" } })) {
      throw new PurchaseReviewError("not_allowed", "These tickets were voided when the dispute was lost, so they can't be restored; the buyer is refunded instead");
    }
    // Every chargeback still on the order must have closed in the society's favour; all of them are resolved together.
    const disputes = await tx.purchaseDispute.findMany({ where: { orderId: input.orderId, resolvedAt: null }, select: { id: true, stripeDisputeId: true, providerStatus: true, caseType: true } });
    const chargebacks = disputes.filter((row) => !isInquiry(row.providerStatus));
    if (order.disputeStatus !== "won" || !chargebacks.length || worstOutcome(chargebacks) !== "won") {
      throw new PurchaseReviewError("not_allowed", "Tickets can be restored only after Stripe closes every dispute in the society's favour");
    }
    // PAY-077: a bank's inquiry still open on the charge stays live, so its escalation still counts.
    const settled = disputes.filter((row) => !isInquiry(row.providerStatus) || row.providerStatus === "warning_closed");
    await tx.purchaseDispute.updateMany({ where: { id: { in: settled.map((row) => row.id) } }, data: { resolvedAt: now, resolvedByUserId: input.actor.id, resolutionReason: reason } });
    const restored = await tx.ticket.updateMany({
      where: { orderId: input.orderId, validity: "refund_review", validityReason: "disputed" },
      data: { validity: "active", validityReason: null, validityChangedAt: now }
    });
    await tx.order.update({ where: { id: input.orderId }, data: { disputeStatus: null } });
    await appendOrderLifecycleEvent(tx, { orderId: input.orderId, type: "dispute_resolved", source: "staff_action", actorUserId: input.actor.id, reason, facts: { ticketCount: restored.count } });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.dispute_resolved", targetType: "Order", targetId: input.orderId,
      metadata: { disputeIds: settled.map((row) => row.stripeDisputeId), reason, ticketCount: restored.count }
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
  const { unreversed, feeKept } = await outsideRefundOwed(stripe, intentId);
  const orderId = payment.order.id;
  const now = new Date();
  const recorded = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event))) return false;
    // A full refund puts the places back on sale: event and ticket type before the order.
    await lockOrderInventory(tx, orderId);
    if (!(await lockOrder(tx, orderId))) return false;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, totalAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, requiresCompensationReview: true, event: { select: { organisationId: true } } }
    });
    if (outside === order.externalRefundedAmount && unreversed === order.externalUnreversedAmount) return false;
    // shortcut: a later drop (a refund that failed after succeeding) is recorded but voided tickets stay void; staff review it in Stripe.
    const refundedHere = await refundedSoFar(tx, { orderId, commerceOrderId: null });
    const full = outside + refundedHere >= order.totalAmount && (order.status === "paid" || order.requiresCompensationReview);
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
    await closeRepaidReview(tx, { orderId, commerceOrderId: null, organisationId: order.event.organisationId }, { source: "stripe_webhook", stripeEventId: event.id });
    return true;
  });
  if (recorded && (unreversed > 0 || feeKept !== 0)) alertOutsideRefundNotReversed({ orderId }, unreversed, feeKept);
}

// PAY-027: a refund made in Stripe's Dashboard that didn't reverse the transfer.
// Thunderstrux paid the buyer; the society's share stays held until Stripe shows it taken back.
// PAY-062: also a full one that kept Thunderstrux's fee (`feeKept`; null when Stripe wouldn't say).
export function alertOutsideRefundNotReversed(purchase: { orderId: string } | { commerceOrderId: string }, unreversed: number, feeKept: number | null) {
  const id = "orderId" in purchase ? purchase.orderId : purchase.commerceOrderId;
  emitOperationalAlert("outside_refund_not_reversed", { ...purchase, unreversed, feeKept, dedupeKey: `outside_refund_not_reversed:${id}:${unreversed}:${feeKept}` });
}

// Staff confirm they have looked at a partial refund made outside
// Thunderstrux, on a ticket order or (PAY-003) a membership or merchandise order,
// or (PAY-074) a dispute the bank won for part of a ticket order. On a ticket order
// they may name the tickets it covered (DEBT-002): those stop working and go back
// on sale; none picked keeps every ticket valid.
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
      select: { externalRefundedAmount: true, externalRefundReviewedAt: true, refundStatus: true, disputeStatus: true }
    });
    if (!order) throw new PurchaseReviewError("not_found", "Order was not found");
    if (order.externalRefundReviewedAt) return;
    const lostForPart = order.externalRefundedAmount === 0 && order.disputeStatus === "lost";
    if ((order.externalRefundedAmount === 0 && !lostForPart) || order.refundStatus === "refunded") {
      throw new PurchaseReviewError("not_allowed", "There is no partial refund to review on this order");
    }
    const now = new Date();
    if (picked.length) {
      const valid = await tx.ticket.findMany({ where: { orderId: input.orderId, id: { in: picked }, validity: "active" }, select: { id: true } });
      if (valid.length !== picked.length || picked.length !== (input.ticketIds ?? []).length) throw new PurchaseReviewError("not_allowed", "Pick tickets of this order that are still valid");
      await tx.ticket.updateMany({ where: { id: { in: picked } }, data: { validity: "void", validityReason: lostForPart ? "dispute_lost" : "refunded_outside", validityChangedAt: now } });
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
