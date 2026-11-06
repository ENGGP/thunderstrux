import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { stageDisputeEvidence } from "@/lib/payments/dispute-evidence";
import { outsideRefundOwed, queueDisputeReversal } from "@/lib/payments/dispute-reversals";
import { closeRepaidReview, openCommerceCompensation, refundedSoFar, reopenRepaidReview } from "@/lib/payments/order-refunds";
import { caseTypeOf, outcomeOf } from "@/lib/payments/dispute-outcome";
import { alertDisputeReview, alertDisputeUnmatched, alertOutsideRefundNotReversed, alertPartReturned, cancelQueuedReversals, journal, journalled, recordDispute, type DisputeReview } from "@/lib/payments/purchase-disputes";
import { getStripe } from "@/lib/stripe";

// PAY-003: what Stripe reports about a membership or merchandise payment that
// Thunderstrux didn't do. Disputes and refunds made in the Stripe dashboard are
// projected from Stripe's state as re-read here (T18b's rules for tickets), so
// duplicate and out-of-order deliveries converge. Each handler answers false when
// the payment isn't a commerce order's, and the ticket handler takes it instead.

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);

// The commerce order a PaymentIntent paid for: its Session names the order and
// family, and the money went to the account the order was sold for.
export async function verifiedCommercePayment(stripe: Stripe, paymentIntentId: string) {
  let commerceOrderId = (await prisma.commerceOrder.findFirst({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } }))?.id;
  if (!commerceOrderId) {
    const session = (await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 })).data[0];
    if (!session?.metadata?.family) return null;
    commerceOrderId = session.metadata.commerceOrderId;
  }
  const order = commerceOrderId
    ? await prisma.commerceOrder.findUnique({ where: { id: commerceOrderId }, select: { id: true, kind: true, organisationId: true, stripeSessionId: true, paymentKind: true, currency: true, totalAmount: true, sellerStripeAccountId: true } })
    : null;
  if (!order?.stripeSessionId || order.paymentKind !== "stripe") return { order: null };
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId, { expand: ["payment_intent"] });
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  if (
    session.metadata?.commerceOrderId !== order.id || session.metadata?.family !== order.kind || !intent || intent.id !== paymentIntentId ||
    intent.currency !== order.currency || idOf(intent.transfer_data?.destination) !== order.sellerStripeAccountId
  ) {
    return { order: null };
  }
  return { order, chargeId: idOf(intent.latest_charge) };
}

// A lost dispute or a full outside refund ends the memberships the order bought.
async function endMemberships(tx: Prisma.TransactionClient, commerceOrderId: string, reason: string, now: Date) {
  return (await tx.membershipGrant.updateMany({ where: { line: { orderId: commerceOrderId }, revokedAt: null }, data: { revokedAt: now, revocationReason: reason } })).count;
}

// charge.dispute.*: an open dispute pauses refunds and hand-over. A loss of the
// whole payment ends memberships, cancels an uncollected pickup and closes a review
// it repaid; a loss of part keeps them and alerts (PAY-074). A win clears the order,
// which keeps the dispute in its history, and opens a held compensation refund; a
// win after a loss cancels the reversal still owed and alerts, since a membership
// may be ended or merchandise collected (PAY-072, PAY-073).
export async function reconcileCommerceDisputeEvent(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  const intentId = idOf(dispute.payment_intent);
  if (!intentId) return false;
  if (await journalled(event.id)) return true;
  const stripe = getStripe();
  const payment = await verifiedCommercePayment(stripe, intentId);
  if (!payment) return false;
  // PAY-078: no amount check. A currency conversion can make a verified dispute larger than its order.
  if (!payment.order) { alertDisputeUnmatched(event, dispute, "no_order"); return true; }
  if (payment.chargeId !== idOf(dispute.charge)) { alertDisputeUnmatched(event, dispute, "other_charge"); return true; }
  if (dispute.currency !== payment.order.currency) { alertDisputeUnmatched(event, dispute, "currency"); return true; }
  // Read before Stripe answers, so a slower read of an older state loses (PAY-076).
  const readAt = new Date();
  const current = await stripe.disputes.retrieve(dispute.id);
  const outcome = outcomeOf(current.status, caseTypeOf(current));
  const { id: commerceOrderId, organisationId } = payment.order;
  const now = new Date();
  let partReturned = false as boolean;
  let review = null as DisputeReview | null;
  const opened = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event)) || !(await lockCommerceOrderForFamily(tx, commerceOrderId))) return false;
    const record = await recordDispute(tx, { current, readAt, now, chargeId: payment.chargeId as string, organisationId, scope: { commerceOrderId } });
    if (!record) return false;
    const { existing, worst } = record;
    review = record.review;
    const order = await tx.commerceOrder.update({
      where: { id: commerceOrderId }, data: { disputeStatus: worst === "won" ? null : worst, stripePaymentIntentId: intentId },
      select: { requiresCompensationReview: true, reviewReason: true, refundStatus: true, totalAmount: true, externalRefundedAmount: true }
    });
    if (!existing) {
      await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "dispute_opened", source: "stripe_webhook", stripeEventId: event.id, reason: current.reason, facts: { amount: current.amount } });
    }
    let ended = 0;
    if (outcome === "lost") {
      // PAY-004: the society bears a lost dispute; the refunds worker takes the money back.
      await queueDisputeReversal(tx, current.id, now);
      const refundedHere = await refundedSoFar(tx, { orderId: null, commerceOrderId });
      if (record.lostAmount + refundedHere + order.externalRefundedAmount >= order.totalAmount) {
        ended = await endMemberships(tx, commerceOrderId, "The buyer's bank returned the payment after a dispute", now);
      } else if (!order.requiresCompensationReview) review = "lost_for_part";
    }
    if (outcome !== "open") {
      await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "dispute_closed", source: "stripe_webhook", stripeEventId: event.id, reason: current.status, facts: { membershipsEnded: ended } });
    }
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: null, action: `commerce_order.dispute_${existing ? outcome : "opened"}`, targetType: "CommerceOrder", targetId: commerceOrderId,
      metadata: { disputeId: current.id, providerStatus: current.status, amount: current.amount }
    } });
    if (worst === "won" && record.anyLost) {
      await cancelQueuedReversals(tx, { commerceOrderId });
      review = "won_after_loss";
    } else if (outcome === "won" && record.wasLost && worst !== "won") {
      // PAY-092: won after its own loss while another chargeback is open or lost; only its own reversal is cancelled.
      await cancelQueuedReversals(tx, { stripeDisputeId: current.id });
      review = "won_after_loss";
    }
    // PAY-056: the last dispute holding this order's compensation refund went the society's way.
    if (worst === "won" && ((await reopenRepaidReview(tx, { orderId: null, commerceOrderId }, event.id)) || order.requiresCompensationReview)) {
      await openCommerceCompensation(tx, { id: commerceOrderId, organisationId }, order.reviewReason ?? "compensation_review_required");
    }
    if (outcome === "lost") partReturned = !(await closeRepaidReview(tx, { orderId: null, commerceOrderId, organisationId }, { source: "stripe_webhook", stripeEventId: event.id })) && order.requiresCompensationReview && order.refundStatus !== "processing";
    return !existing;
  });
  if (partReturned) alertPartReturned({ commerceOrderId });
  if (review) alertDisputeReview({ commerceOrderId }, current, review);
  if (opened) {
    emitOperationalAlert("purchase_dispute_opened", { commerceOrderId, disputeId: current.id, evidenceDueBy: current.evidence_details?.due_by ?? null });
    await stageDisputeEvidence(current, { commerceOrderId });
  }
  logInfo("commerce.dispute.reconciled", { stripeEventId: event.id, commerceOrderId, providerStatus: current.status });
  return true;
}

// refund.* naming no Thunderstrux refund: a refund made in the Stripe
// dashboard. The order records Stripe's total outside refund; a full one ends
// the order like a refund here (also settling a payment under review), a
// partial one is flagged until staff review it or refund the rest.
export async function reconcileCommerceExternalRefundEvent(event: Stripe.Event) {
  const refund = event.data.object as Stripe.Refund;
  const intentId = idOf(refund.payment_intent);
  if (!intentId) return false;
  if (await journalled(event.id)) return true;
  const stripe = getStripe();
  const payment = await verifiedCommercePayment(stripe, intentId);
  if (!payment) return false;
  if (!payment.order) {
    logWarn("commerce.refund.unmatched", { stripeEventId: event.id, refundId: refund.id });
    return true;
  }
  const refunds = await stripe.refunds.list({ payment_intent: intentId, limit: 100 });
  const outside = refunds.data
    .filter((item) => item.status === "succeeded" && !item.metadata?.refundRequestId)
    .reduce((sum, item) => sum + item.amount, 0);
  // PAY-027: payouts hold what a refund didn't take back from the society.
  const { unreversed, feeKept } = await outsideRefundOwed(stripe, intentId);
  const { id: commerceOrderId, organisationId } = payment.order;
  const now = new Date();
  const recorded = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event)) || !(await lockCommerceOrderForFamily(tx, commerceOrderId))) return false;
    const order = await tx.commerceOrder.findUniqueOrThrow({
      where: { id: commerceOrderId },
      select: { status: true, totalAmount: true, externalRefundedAmount: true, externalUnreversedAmount: true, requiresCompensationReview: true, refundStatus: true }
    });
    if (outside === order.externalRefundedAmount && unreversed === order.externalUnreversedAmount) return false;
    // shortcut: a later drop (a refund that failed after succeeding) is recorded, but an ended membership stays ended; staff review it in Stripe.
    const full = outside >= order.totalAmount && (order.status === "paid" || order.requiresCompensationReview) && order.refundStatus !== "refunded";
    await tx.commerceOrder.update({
      where: { id: commerceOrderId },
      data: { externalRefundedAmount: outside, externalUnreversedAmount: unreversed, externalRefundReviewedAt: null, stripePaymentIntentId: intentId, ...(full ? { refundStatus: "refunded" } : {}) }
    });
    const ended = full ? await endMemberships(tx, commerceOrderId, "Refunded in Stripe", now) : 0;
    await appendCommerceLifecycleEvent(tx, {
      commerceOrderId, type: "external_refund_recorded", source: "stripe_webhook", stripeEventId: event.id, reason: full ? "full" : "partial", facts: { amount: outside, membershipsEnded: ended }
    });
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: null, action: "commerce_order.external_refund_recorded", targetType: "CommerceOrder", targetId: commerceOrderId,
      metadata: { refundId: refund.id, refundedOutside: outside, totalAmount: order.totalAmount, notReversed: unreversed }
    } });
    await closeRepaidReview(tx, { orderId: null, commerceOrderId, organisationId }, { source: "stripe_webhook", stripeEventId: event.id });
    return true;
  });
  if (recorded && (unreversed > 0 || feeKept !== 0)) alertOutsideRefundNotReversed({ commerceOrderId }, unreversed, feeKept);
  return true;
}

// Staff confirm they have looked at a partial refund made in Stripe.
export async function markCommerceExternalRefundReviewed(tx: Prisma.TransactionClient, input: { organisationId: string; commerceOrderId: string; actor: { id: string } }) {
  const order = await tx.commerceOrder.findUniqueOrThrow({
    where: { id: input.commerceOrderId },
    select: { externalRefundedAmount: true, externalRefundReviewedAt: true, refundStatus: true }
  });
  if (order.externalRefundReviewedAt) return "already";
  if (order.externalRefundedAmount === 0 || order.refundStatus === "refunded") return "nothing";
  await tx.commerceOrder.update({ where: { id: input.commerceOrderId }, data: { externalRefundReviewedAt: new Date() } });
  await appendCommerceLifecycleEvent(tx, {
    commerceOrderId: input.commerceOrderId, type: "external_refund_reviewed", source: "staff_action", actorUserId: input.actor.id, facts: { amount: order.externalRefundedAmount }
  });
  await tx.auditLog.create({ data: {
    organisationId: input.organisationId, actorUserId: input.actor.id, action: "commerce_order.external_refund_reviewed", targetType: "CommerceOrder", targetId: input.commerceOrderId,
    metadata: { refundedOutside: order.externalRefundedAmount }
  } });
  return "reviewed";
}
