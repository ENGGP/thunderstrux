import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { stageDisputeEvidence } from "@/lib/payments/dispute-evidence";
import { queueDisputeReversal } from "@/lib/payments/dispute-reversals";
import { journal, journalled, outcomeOf, worstOutcome } from "@/lib/payments/purchase-disputes";
import { getStripe } from "@/lib/stripe";

// PAY-003: what Stripe reports about a membership or merchandise payment that
// Thunderstrux didn't do, and the refund of one it couldn't honour. Disputes
// and refunds made in the Stripe dashboard are projected from Stripe's state
// as re-read here (T18b's rules for tickets), so duplicate and out-of-order
// deliveries converge. Each handler answers false when the payment isn't a
// commerce order's, and the ticket handler takes it instead.

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

// charge.dispute.*: an open dispute pauses refunds and hand-over; a lost one
// ends memberships and cancels an uncollected pickup; a won one clears the
// order, which keeps the dispute in its history.
export async function reconcileCommerceDisputeEvent(event: Stripe.Event) {
  const dispute = event.data.object as Stripe.Dispute;
  const intentId = idOf(dispute.payment_intent);
  if (!intentId) return false;
  if (await journalled(event.id)) return true;
  const stripe = getStripe();
  const payment = await verifiedCommercePayment(stripe, intentId);
  if (!payment) return false;
  if (!payment.order || payment.chargeId !== idOf(dispute.charge) || dispute.currency !== payment.order.currency || dispute.amount > payment.order.totalAmount) {
    logWarn("commerce.dispute.unmatched", { stripeEventId: event.id, disputeId: dispute.id });
    emitOperationalAlert("purchase_dispute_unmatched", { stripeEventId: event.id, disputeId: dispute.id });
    return true;
  }
  const current = await stripe.disputes.retrieve(dispute.id);
  const outcome = outcomeOf(current.status);
  const { id: commerceOrderId, organisationId } = payment.order;
  const now = new Date();
  const opened = await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event)) || !(await lockCommerceOrderForFamily(tx, commerceOrderId))) return false;
    const existing = await tx.purchaseDispute.findUnique({ where: { stripeDisputeId: current.id } });
    const fields = {
      providerStatus: current.status, amount: current.amount, reason: current.reason,
      evidenceDueBy: current.evidence_details?.due_by ? new Date(current.evidence_details.due_by * 1000) : null,
      closedAt: outcome === "open" ? null : existing?.closedAt ?? now
    };
    await tx.purchaseDispute.upsert({
      where: { stripeDisputeId: current.id },
      create: { ...fields, commerceOrderId, organisationId, stripeDisputeId: current.id, stripeChargeId: payment.chargeId as string, currency: current.currency },
      update: fields
    });
    if (existing && outcomeOf(existing.providerStatus) === outcome) return false;
    const worst = worstOutcome((await tx.purchaseDispute.findMany({ where: { commerceOrderId }, select: { providerStatus: true } })).map((row) => row.providerStatus));
    await tx.commerceOrder.update({ where: { id: commerceOrderId }, data: { disputeStatus: worst === "won" ? null : worst, stripePaymentIntentId: intentId } });
    if (!existing) {
      await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "dispute_opened", source: "stripe_webhook", stripeEventId: event.id, reason: current.reason, facts: { amount: current.amount } });
    }
    const ended = outcome === "lost" ? await endMemberships(tx, commerceOrderId, "The buyer's bank returned the payment after a dispute", now) : 0;
    // PAY-004: the society bears a lost dispute; the refunds worker takes the money back.
    if (outcome === "lost") await queueDisputeReversal(tx, current.id, now);
    if (outcome !== "open") {
      await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "dispute_closed", source: "stripe_webhook", stripeEventId: event.id, reason: current.status, facts: { membershipsEnded: ended } });
    }
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: null, action: `commerce_order.dispute_${existing ? outcome : "opened"}`, targetType: "CommerceOrder", targetId: commerceOrderId,
      metadata: { disputeId: current.id, providerStatus: current.status, amount: current.amount }
    } });
    return !existing;
  });
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
  const { id: commerceOrderId, organisationId } = payment.order;
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (!(await journal(tx, event)) || !(await lockCommerceOrderForFamily(tx, commerceOrderId))) return;
    const order = await tx.commerceOrder.findUniqueOrThrow({
      where: { id: commerceOrderId },
      select: { status: true, totalAmount: true, externalRefundedAmount: true, requiresCompensationReview: true, refundStatus: true }
    });
    if (outside === order.externalRefundedAmount) return;
    // shortcut: a later drop (a refund that failed after succeeding) is recorded, but an ended membership stays ended; staff review it in Stripe.
    const full = outside >= order.totalAmount && (order.status === "paid" || order.requiresCompensationReview) && order.refundStatus !== "refunded";
    await tx.commerceOrder.update({
      where: { id: commerceOrderId },
      data: { externalRefundedAmount: outside, externalRefundReviewedAt: null, stripePaymentIntentId: intentId, ...(full ? { refundStatus: "refunded", requiresCompensationReview: false } : {}) }
    });
    const ended = full ? await endMemberships(tx, commerceOrderId, "Refunded in Stripe", now) : 0;
    await appendCommerceLifecycleEvent(tx, {
      commerceOrderId, type: "external_refund_recorded", source: "stripe_webhook", stripeEventId: event.id, reason: full ? "full" : "partial", facts: { amount: outside, membershipsEnded: ended }
    });
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: null, action: "commerce_order.external_refund_recorded", targetType: "CommerceOrder", targetId: commerceOrderId,
      metadata: { refundId: refund.id, refundedOutside: outside, totalAmount: order.totalAmount }
    } });
  });
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

// A payment Stripe took that the order couldn't honour is refunded in full,
// on the ordinary refund request, fence and worker (T23c). The worker checks
// the payment against the order before anything is sent; a mismatch fails the
// request and the order stays under review for staff.
export async function queueCommerceCompensationRefund(tx: Prisma.TransactionClient, commerceOrderId: string, reason: string) {
  const order = await tx.commerceOrder.findUniqueOrThrow({
    where: { id: commerceOrderId },
    select: { organisationId: true, totalAmount: true, currency: true, sellerStripeAccountId: true, paymentKind: true, refundStatus: true }
  });
  if (order.paymentKind !== "stripe" || order.totalAmount <= 0 || order.refundStatus) return;
  await tx.commerceOrder.update({ where: { id: commerceOrderId }, data: { refundStatus: "processing" } });
  await tx.refundRequest.create({
    data: {
      commerceOrderId, organisationId: order.organisationId, amount: order.totalAmount, currency: order.currency,
      reason: `Paid but couldn't be filled (${reason})`.slice(0, 500), actorUserId: null,
      operationKey: `commerce-compensation:${commerceOrderId}:${randomUUID()}`, destinationAccountId: order.sellerStripeAccountId
    }
  });
  await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "refund_requested", source: "stripe_webhook", reason: "compensation", facts: { amount: order.totalAmount } });
  await tx.auditLog.create({ data: {
    organisationId: order.organisationId, actorUserId: null, action: "commerce_order.compensation_refund_queued", targetType: "CommerceOrder", targetId: commerceOrderId,
    metadata: { amount: order.totalAmount, reason }
  } });
}

// An early fraud warning on a commerce order nobody has used yet (merchandise not
// collected): refunded in full on the ordinary request, fence and worker, as
// compensation is. The caller holds the family lock. Answers why not otherwise.
export async function queueCommerceFraudRefund(tx: Prisma.TransactionClient, commerceOrderId: string, reason: string) {
  const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: commerceOrderId } });
  if (order.disputeStatus) return "disputed";
  if (order.refundStatus) return order.refundStatus === "refunded" ? "already_refunded" : "in_progress";
  if (order.pickupStatus === "collected") return "used";
  const amount = order.totalAmount - order.externalRefundedAmount;
  if (
    order.paymentKind !== "stripe" || order.status !== "paid" || !order.fulfilledAt || order.requiresCompensationReview ||
    !order.stripeSessionId || !order.sellerStripeAccountId || amount <= 0
  ) {
    return "not_refundable";
  }
  await tx.commerceOrder.update({ where: { id: commerceOrderId }, data: { refundStatus: "processing" } });
  const created = await tx.refundRequest.create({
    data: {
      commerceOrderId, organisationId: order.organisationId, amount, currency: order.currency, reason, actorUserId: null,
      operationKey: `commerce-refund:${randomUUID()}`, destinationAccountId: order.sellerStripeAccountId
    }
  });
  await appendCommerceLifecycleEvent(tx, { commerceOrderId, type: "refund_requested", source: "stripe_webhook", reason, facts: { amount } });
  await tx.auditLog.create({ data: {
    organisationId: order.organisationId, actorUserId: null, action: "commerce_order.refund_requested", targetType: "CommerceOrder", targetId: commerceOrderId,
    metadata: { refundRequestId: created.id, amount, reason }
  } });
  return "refund_queued";
}
