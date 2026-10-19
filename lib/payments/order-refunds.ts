import { randomUUID } from "node:crypto";
import type { Prisma, RefundRequestStatus } from "@prisma/client";
import type Stripe from "stripe";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatMoney } from "@/lib/format";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { isDefiniteProviderFailure } from "@/lib/payments/checkout-attempts";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";
import { getStripe } from "@/lib/stripe";

// Staff-initiated whole-order refunds (T18a; commerce orders since T23c). The
// purchase's refundStatus is the financial fence: it is set under the
// purchase's lock before Stripe is called, and compensation refunds never
// start while it is set. Stripe is called outside the transaction with the
// request's operationKey; an unknown outcome is looked up at Stripe (the
// request's own refund) before that key is sent again. A request refunds a
// ticket order or a commerce order, never both; everything below that differs
// between them goes through the small helpers just after the types.

const leaseMs = 10 * 60 * 1000;
const pollMs = 60 * 1000;
const maxAttempts = 6;

export type RefundFailureKind =
  | "not_found"
  | "not_refundable"
  | "in_progress"
  | "already_refunded"
  | "disputed"
  | "confirmation_mismatch"
  | "verification_failed"
  | "provider_refused";

export class OrderRefundError extends Error {
  constructor(readonly kind: RefundFailureKind, message: string) {
    super(message);
    this.name = "OrderRefundError";
  }
}

class RefundVerificationError extends Error {
  constructor(readonly code: string) { super(code); }
}

// The short order reference staff type to confirm, as shown in the dashboard.
export const orderReference = (orderId: string) => orderId.slice(-6).toUpperCase();

type Actor = { id: string };
type RefundSource = "staff_action" | "refund_worker" | "stripe_webhook";
type Purchase = { orderId: string | null; commerceOrderId: string | null };
type HistoryEntry = {
  type: "refund_requested" | "refund_pending" | "refunded" | "refund_failed";
  source: RefundSource;
  actorUserId?: string | null;
  stripeEventId?: string;
  reason?: string;
  facts?: Prisma.InputJsonObject;
};

// A commerce purchase locks its family's resources first (member, society), then the order.
async function lockPurchase(tx: Prisma.TransactionClient, purchase: Purchase) {
  return purchase.commerceOrderId ? (await lockCommerceOrderForFamily(tx, purchase.commerceOrderId)) !== null : lockOrder(tx, purchase.orderId as string);
}

function appendHistory(tx: Prisma.TransactionClient, purchase: Purchase, entry: HistoryEntry) {
  return purchase.commerceOrderId
    ? appendCommerceLifecycleEvent(tx, { commerceOrderId: purchase.commerceOrderId, ...entry })
    : appendOrderLifecycleEvent(tx, { orderId: purchase.orderId as string, ...entry });
}

function liftFence(tx: Prisma.TransactionClient, purchase: Purchase) {
  return purchase.commerceOrderId
    ? tx.commerceOrder.updateMany({ where: { id: purchase.commerceOrderId, refundStatus: "processing" }, data: { refundStatus: null } })
    : tx.order.updateMany({ where: { id: purchase.orderId as string, refundStatus: "processing" }, data: { refundStatus: null } });
}

const auditTarget = (purchase: Purchase) =>
  purchase.commerceOrderId
    ? { action: "commerce_order", targetType: "CommerceOrder", targetId: purchase.commerceOrderId }
    : { action: "order", targetType: "Order", targetId: purchase.orderId as string };

// What the refund names in Stripe's metadata, and the webhook checks.
const refundMetadata = (requestId: string, purchase: Purchase): Record<string, string> =>
  purchase.commerceOrderId ? { refundRequestId: requestId, commerceOrderId: purchase.commerceOrderId } : { refundRequestId: requestId, orderId: purchase.orderId as string };

function providerStatus(refund: Stripe.Refund): RefundRequestStatus {
  if (refund.status === "succeeded") return "succeeded";
  if (refund.status === "failed" || refund.status === "canceled") return "failed";
  return "pending";
}

const paymentIntentOf = (refund: Stripe.Refund) =>
  typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? null;

export async function requestOrderRefund(input: {
  organisationId: string;
  orderId: string;
  actor: Actor;
  reason: string;
  confirmation: string;
}) {
  // The caller has verified the staff member's authenticator code (see the route).
  const reason = input.reason.trim();
  const token = randomUUID();
  const now = new Date();

  const request = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, input.orderId))) throw new OrderRefundError("not_found", "Order was not found");
    const order = await tx.order.findFirst({
      where: { id: input.orderId, event: { organisationId: input.organisationId } },
      include: { compensationRefundJob: { select: { state: true } } }
    });
    if (!order) throw new OrderRefundError("not_found", "Order was not found");
    if (input.confirmation.trim().toUpperCase() !== orderReference(order.id)) {
      throw new OrderRefundError("confirmation_mismatch", `Type ${orderReference(order.id)} to confirm`);
    }
    if (order.refundStatus === "refunded") throw new OrderRefundError("already_refunded", "This order has already been refunded");
    if (order.refundStatus === "processing") throw new OrderRefundError("in_progress", "A refund for this order is already in progress");
    if (order.disputeStatus) throw new OrderRefundError("disputed", "The buyer has disputed this payment, so it can't be refunded here");
    // After a partial refund made in Stripe, this refunds the rest.
    const amount = order.totalAmount - order.externalRefundedAmount;
    if (
      order.paymentKind !== "stripe" || order.status !== "paid" || order.requiresCompensationReview || order.isManuallyRefunded ||
      !order.stripeSessionId || !order.sellerStripeAccountId || (order.compensationRefundJob && order.compensationRefundJob.state !== "recovered") || amount <= 0
    ) {
      throw new OrderRefundError("not_refundable", "This order can't be refunded here");
    }
    await tx.order.update({ where: { id: order.id }, data: { refundStatus: "processing" } });
    const created = await tx.refundRequest.create({
      data: {
        orderId: order.id, organisationId: input.organisationId, amount, currency: order.currency, reason,
        actorUserId: input.actor.id, operationKey: `order-refund:${randomUUID()}`, destinationAccountId: order.sellerStripeAccountId,
        attempts: 1, processingToken: token, processingStartedAt: now
      }
    });
    await appendOrderLifecycleEvent(tx, {
      orderId: order.id, type: "refund_requested", source: "staff_action", actorUserId: input.actor.id, reason, facts: { amount }
    });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.refund_requested", targetType: "Order", targetId: order.id,
      metadata: { refundRequestId: created.id, amount, reason }
    } });
    return created;
  });

  return sendRefund(request.id, token, "staff_action");
}

// The same whole-order refund for a membership or merchandise order (T23c).
// A commerce order has no disputes or outside refunds projected yet, so it is
// refunded only while Stripe shows no other refund of the payment.
export async function requestCommerceRefund(input: {
  organisationId: string;
  commerceOrderId: string;
  actor: Actor;
  reason: string;
  confirmation: string;
}) {
  // The caller has verified the staff member's authenticator code (see the route).
  const reason = input.reason.trim();
  const token = randomUUID();
  const now = new Date();

  const request = await prisma.$transaction(async (tx) => {
    const found = await tx.commerceOrder.findFirst({ where: { id: input.commerceOrderId, organisationId: input.organisationId }, select: { id: true } });
    if (!found || !(await lockCommerceOrderForFamily(tx, found.id))) throw new OrderRefundError("not_found", "Order was not found");
    const order = await tx.commerceOrder.findUniqueOrThrow({ where: { id: found.id } });
    if (input.confirmation.trim().toUpperCase() !== orderReference(order.id)) {
      throw new OrderRefundError("confirmation_mismatch", `Type ${orderReference(order.id)} to confirm`);
    }
    if (order.refundStatus === "refunded") throw new OrderRefundError("already_refunded", "This order has already been refunded");
    if (order.refundStatus === "processing") throw new OrderRefundError("in_progress", "A refund for this order is already in progress");
    if (
      order.paymentKind !== "stripe" || order.status !== "paid" || !order.fulfilledAt || order.requiresCompensationReview ||
      !order.stripeSessionId || !order.sellerStripeAccountId || order.totalAmount <= 0
    ) {
      throw new OrderRefundError("not_refundable", "This order can't be refunded here");
    }
    await tx.commerceOrder.update({ where: { id: order.id }, data: { refundStatus: "processing" } });
    const created = await tx.refundRequest.create({
      data: {
        commerceOrderId: order.id, organisationId: input.organisationId, amount: order.totalAmount, currency: order.currency, reason,
        actorUserId: input.actor.id, operationKey: `commerce-refund:${randomUUID()}`, destinationAccountId: order.sellerStripeAccountId,
        attempts: 1, processingToken: token, processingStartedAt: now
      }
    });
    await appendCommerceLifecycleEvent(tx, {
      commerceOrderId: order.id, type: "refund_requested", source: "staff_action", actorUserId: input.actor.id, reason, facts: { amount: order.totalAmount }
    });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "commerce_order.refund_requested", targetType: "CommerceOrder", targetId: order.id,
      metadata: { refundRequestId: created.id, amount: order.totalAmount, reason }
    } });
    return created;
  });

  return sendRefund(request.id, token, "staff_action");
}

// The charge this request refunds, checked against the purchase and the
// snapshot of who was paid; and the request's own refund at Stripe, if one
// exists. Refunds made elsewhere must be exactly the part this one leaves out.
async function verifiedPayment(request: Purchase & { id: string; amount: number; currency: string; destinationAccountId: string | null }) {
  const order = request.commerceOrderId
    ? await prisma.commerceOrder.findUniqueOrThrow({ where: { id: request.commerceOrderId }, select: { id: true, stripeSessionId: true, totalAmount: true } })
    : await prisma.order.findUniqueOrThrow({ where: { id: request.orderId as string }, select: { id: true, stripeSessionId: true, totalAmount: true } });
  const named = request.commerceOrderId ? "commerceOrderId" : "orderId";
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId as string, { expand: ["payment_intent", "payment_intent.latest_charge"] });
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  if (
    session.payment_status !== "paid" || session.amount_total !== order.totalAmount || session.currency?.toLowerCase() !== request.currency ||
    session.metadata?.[named] !== order.id || !intent || intent.amount_received !== order.totalAmount ||
    intent.transfer_data?.destination !== request.destinationAccountId || !charge || charge.disputed !== false
  ) {
    throw new RefundVerificationError("provider_identity_not_eligible");
  }
  const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
  const own = refunds.data.find((refund) => refund.metadata?.refundRequestId === request.id);
  const elsewhere = refunds.data
    .filter((refund) => refund !== own && refund.status !== "failed" && refund.status !== "canceled")
    .reduce((sum, refund) => sum + refund.amount, 0);
  if (!own && elsewhere !== order.totalAmount - request.amount) {
    throw new RefundVerificationError("existing_refund_requires_review");
  }
  return { stripe, intent, own: own ?? null };
}

// Sends (or finds) the request's refund while holding its processing lease.
async function sendRefund(requestId: string, token: string, source: "staff_action" | "refund_worker") {
  const request = await prisma.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
  try {
    const { stripe, intent, own } = await verifiedPayment(request);
    const held = await prisma.refundRequest.updateMany({ where: { id: request.id, processingToken: token }, data: { stripePaymentIntentId: intent.id } });
    if (held.count !== 1) return { refundRequestId: request.id, status: "pending" as const };
    if (request.commerceOrderId) await prisma.commerceOrder.update({ where: { id: request.commerceOrderId }, data: { stripePaymentIntentId: intent.id } });
    else await prisma.order.update({ where: { id: request.orderId as string }, data: { stripePaymentIntentId: intent.id } });
    const refund = own ?? await stripe.refunds.create({
      payment_intent: intent.id,
      amount: request.amount,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: refundMetadata(request.id, request)
    }, { idempotencyKey: request.operationKey });
    const status = await applyOutcome(request.id, refund, { source, token });
    return { refundRequestId: request.id, status };
  } catch (error) {
    if (error instanceof RefundVerificationError) {
      await fail(request.id, token, error.code, source);
      throw new OrderRefundError("verification_failed", "Stripe's record of this payment doesn't match the order, so nothing was refunded");
    }
    if (isDefiniteProviderFailure(error)) {
      await fail(request.id, token, "provider_refused", source);
      throw new OrderRefundError("provider_refused", request.commerceOrderId ? "Stripe refused the refund. Nothing was refunded and the order is unchanged." : "Stripe refused the refund. The tickets are still valid.");
    }
    // No answer: the refund may exist. Look it up before anything is sent again.
    logError("order_refund.provider_uncertain", { refundRequestId: request.id, orderId: request.orderId, commerceOrderId: request.commerceOrderId, error });
    await prisma.refundRequest.updateMany({
      where: { id: request.id, processingToken: token },
      data: { status: "uncertain", processingToken: null, processingStartedAt: null, nextAttemptAt: new Date(Date.now() + pollMs), lastErrorCode: "provider_uncertain" }
    });
    return { refundRequestId: request.id, status: "uncertain" as const };
  }
}

// A refund that will not happen: the fence is lifted and nothing is voided or revoked.
async function fail(requestId: string, token: string | null, code: string, source: "staff_action" | "refund_worker" = "staff_action") {
  await prisma.$transaction(async (tx) => {
    const request = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!(await lockPurchase(tx, request))) return;
    const updated = await tx.refundRequest.updateMany({
      where: { id: requestId, status: { in: ["pending", "uncertain"] }, ...(token ? { processingToken: token } : {}) },
      data: { status: "failed", processingToken: null, processingStartedAt: null, lastErrorCode: code, resolvedAt: new Date() }
    });
    if (updated.count !== 1) return;
    await liftFence(tx, request);
    await appendHistory(tx, request, { type: "refund_failed", source, reason: code });
    const target = auditTarget(request);
    await tx.auditLog.create({ data: {
      organisationId: request.organisationId, actorUserId: null, action: `${target.action}.refund_failed`, targetType: target.targetType, targetId: target.targetId,
      metadata: { refundRequestId: requestId, reason: code }
    } });
  });
}

// A confirmed ticket refund voids the tickets (attendance is kept, stock is
// not restored) and emails the buyer.
async function refundTickets(tx: Prisma.TransactionClient, request: { id: string; orderId: string; organisationId: string; amount: number }, now: Date) {
  const order = await tx.order.update({
    where: { id: request.orderId },
    data: { refundStatus: "refunded" },
    select: { buyerEmailSnapshot: true, event: { select: { title: true } } }
  });
  await tx.ticket.updateMany({
    where: { orderId: request.orderId, validity: { not: "void" } },
    data: { validity: "void", validityReason: "refunded", validityChangedAt: now }
  });
  if (order.buyerEmailSnapshot) {
    await enqueueNotification(tx, {
      eventKey: `refund/${request.id}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: request.organisationId,
      payload: { message: `Your order for ${order.event.title} has been refunded: ${formatMoney(request.amount)} is on its way back to your card. Banks usually take 5 to 10 business days. Your tickets are no longer valid.` }
    });
  }
}

// A confirmed commerce refund ends the memberships it bought (T23c), takes a
// merchandise order not yet collected off the Pickups tab (the refund status
// does that; T28b), and emails the buyer. Stock comes back only through a return.
async function refundCommerce(
  tx: Prisma.TransactionClient,
  request: { id: string; commerceOrderId: string; organisationId: string; amount: number; reason: string; actorUserId: string | null },
  now: Date
) {
  const order = await tx.commerceOrder.update({
    where: { id: request.commerceOrderId },
    data: { refundStatus: "refunded" },
    select: { kind: true, pickupStatus: true, buyerEmailSnapshot: true, sellerName: true, lines: { select: { nameSnapshot: true }, orderBy: { lineNumber: "asc" } } }
  });
  const ended = await tx.membershipGrant.updateMany({
    where: { line: { orderId: request.commerceOrderId }, revokedAt: null },
    data: { revokedAt: now, revokedByUserId: request.actorUserId, revocationReason: `Refunded: ${request.reason}` }
  });
  const items = order.lines.map((line) => line.nameSnapshot).join(", ");
  await enqueueNotification(tx, {
    eventKey: `refund/${request.id}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: request.organisationId,
    payload: {
      message: `Your ${items} from ${order.sellerName} has been refunded: ${formatMoney(request.amount)} is on its way back to your card. Banks usually take 5 to 10 business days.${ended.count ? " Your membership has ended." : ""}${order.kind === "merchandise" && order.pickupStatus !== "collected" ? " The pickup is cancelled, so there's nothing to collect." : ""}`
    }
  });
  return ended.count;
}

// Projects Stripe's answer for this request's refund.
async function applyOutcome(
  requestId: string,
  refund: Stripe.Refund,
  { source, token, stripeEventId, eventCreatedAt }: { source: RefundSource; token?: string; stripeEventId?: string; eventCreatedAt?: Date }
): Promise<RefundRequestStatus> {
  const status = providerStatus(refund);
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const request = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!(await lockPurchase(tx, request))) return request.status;
    const current = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (current.status === "succeeded" || current.status === "failed") return current.status;
    if (eventCreatedAt && current.lastProviderEventAt && current.lastProviderEventAt > eventCreatedAt) return current.status;
    const updated = await tx.refundRequest.updateMany({
      where: { id: requestId, status: { in: ["pending", "uncertain"] }, ...(token ? { processingToken: token } : {}) },
      data: {
        status, stripeRefundId: refund.id, providerStatus: refund.status, processingToken: null, processingStartedAt: null,
        lastProviderEventAt: eventCreatedAt ?? current.lastProviderEventAt, nextAttemptAt: new Date(now.getTime() + pollMs),
        resolvedAt: status === "pending" ? null : now, lastErrorCode: status === "failed" ? "provider_refund_failed" : null
      }
    });
    if (updated.count !== 1) return current.status;
    if (status === "pending") {
      if (current.status !== "pending" || !current.stripeRefundId) {
        await appendHistory(tx, request, { type: "refund_pending", source, stripeEventId });
      }
      return status;
    }
    if (status === "failed") {
      await liftFence(tx, request);
      await appendHistory(tx, request, { type: "refund_failed", source, stripeEventId, reason: "provider_refund_failed" });
    } else if (request.commerceOrderId) {
      const memberships = await refundCommerce(tx, { ...request, commerceOrderId: request.commerceOrderId }, now);
      await appendHistory(tx, request, { type: "refunded", source, stripeEventId, facts: { amount: request.amount, membershipsEnded: memberships } });
    } else {
      await refundTickets(tx, { ...request, orderId: request.orderId as string }, now);
      await appendHistory(tx, request, { type: "refunded", source, stripeEventId, facts: { amount: request.amount } });
    }
    const target = auditTarget(request);
    await tx.auditLog.create({ data: {
      organisationId: request.organisationId, actorUserId: null, action: `${target.action}.refund_${status}`, targetType: target.targetType, targetId: target.targetId,
      metadata: { refundRequestId: requestId, refundId: refund.id, providerStatus: refund.status }
    } });
    return status;
  });
}

// Worker: pending and uncertain requests, and leases left by a crashed request.
// Each is looked up at Stripe first; only if Stripe has no refund for it is the
// same operation key sent again.
export async function processOrderRefundBatch(limit = 25, now = new Date()) {
  const stale = new Date(now.getTime() - leaseMs);
  const due = await prisma.refundRequest.findMany({
    where: { status: { in: ["pending", "uncertain"] }, nextAttemptAt: { lte: now }, OR: [{ processingToken: null }, { processingStartedAt: { lt: stale } }] },
    orderBy: { nextAttemptAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, attempts: true, orderId: true, commerceOrderId: true }
  });
  const results: Array<{ refundRequestId: string; status: string }> = [];
  for (const candidate of due) {
    const token = randomUUID();
    const claimed = await prisma.refundRequest.updateMany({
      where: { id: candidate.id, status: { in: ["pending", "uncertain"] }, OR: [{ processingToken: null }, { processingStartedAt: { lt: stale } }] },
      data: { processingToken: token, processingStartedAt: now, attempts: { increment: 1 } }
    });
    if (claimed.count !== 1) continue;
    if (candidate.attempts >= maxAttempts) {
      // Still unresolved after repeated checks: a person looks at it; the fence stays.
      await prisma.refundRequest.updateMany({ where: { id: candidate.id, processingToken: token }, data: { processingToken: null, processingStartedAt: null, nextAttemptAt: new Date(now.getTime() + 60 * pollMs), lastErrorCode: "provider_unresolved" } });
      emitOperationalAlert("order_refund_unresolved", { refundRequestId: candidate.id, orderId: candidate.orderId, commerceOrderId: candidate.commerceOrderId });
      continue;
    }
    try {
      results.push(await sendRefund(candidate.id, token, "refund_worker"));
    } catch (error) {
      results.push({ refundRequestId: candidate.id, status: error instanceof OrderRefundError ? "failed" : "error" });
    }
  }
  logInfo("order_refund.batch.completed", { processed: results.length });
  return { processed: results.length, results };
}

// Signed refund webhooks for ordinary refunds: matched by the request id in the
// refund's metadata and confirmed against the purchase and payment the request recorded.
export async function reconcileOrderRefundEvent(event: Stripe.Event) {
  const refund = event.data.object as Stripe.Refund;
  const requestId = refund.metadata?.refundRequestId;
  if (!requestId) return;
  const eventCreatedAt = new Date(event.created * 1000);
  const request = await prisma.refundRequest.findUnique({ where: { id: requestId } });
  const purchaseMatches = request && (request.commerceOrderId
    ? refund.metadata?.commerceOrderId === request.commerceOrderId && !refund.metadata?.orderId
    : refund.metadata?.orderId === request.orderId && !refund.metadata?.commerceOrderId);
  if (
    !request || !purchaseMatches || refund.amount !== request.amount ||
    refund.currency.toLowerCase() !== request.currency || !request.stripePaymentIntentId || paymentIntentOf(refund) !== request.stripePaymentIntentId
  ) {
    logWarn("order_refund.webhook_identity_rejected", { stripeEventId: event.id, refundId: refund.id });
    return;
  }
  try {
    await prisma.stripeRefundWebhookEvent.create({ data: { stripeEventId: event.id, refundRequestId: request.id, eventType: event.type, eventCreatedAt } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code: string }).code === "P2002") return;
    throw error;
  }
  await applyOutcome(request.id, refund, { source: "stripe_webhook", stripeEventId: event.id, eventCreatedAt });
}

// For order detail: the latest request, to show processing, refunded or failed.
export function latestRefundRequest(db: Prisma.TransactionClient | typeof prisma, orderId: string) {
  return db.refundRequest.findFirst({
    where: { orderId },
    orderBy: { createdAt: "desc" },
    select: { status: true, amount: true, reason: true, lastErrorCode: true, createdAt: true, resolvedAt: true, actor: { select: { firstName: true, lastName: true, email: true } } }
  });
}

// For the member page: the latest refund request of a commerce order.
export function latestCommerceRefundRequest(commerceOrderId: string) {
  return prisma.refundRequest.findFirst({
    where: { commerceOrderId },
    orderBy: { createdAt: "desc" },
    select: { status: true, amount: true, lastErrorCode: true, createdAt: true, resolvedAt: true }
  });
}
