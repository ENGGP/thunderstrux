import { randomUUID } from "node:crypto";
import type { Prisma, RefundRequestStatus } from "@prisma/client";
import type Stripe from "stripe";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { lockOrderInventory, returnTicketsToSale } from "@/lib/events/inventory";
import { formatMoney, orderReference, ticketReference } from "@/lib/format";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { isDefiniteProviderFailure } from "@/lib/payments/checkout-attempts";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";
import { getStripe } from "@/lib/stripe";

// Staff-initiated refunds (T18a; commerce orders since T23c; ticket by ticket
// since DEBT-002, as Humanitix: pick tickets, an amount up to their value,
// and whether they are cancelled and the buyer emailed). The
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
  | "invalid_selection"
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

export { orderReference };

type Actor = { id: string };

// DEBT-002, as Humanitix: the tickets, the amount (at most their value and what is
// left to refund; 0 cancels them without a refund), whether they stop working,
// and whether the buyer is emailed, with an optional note from the society.
export type TicketSelection = { ticketIds: string[]; amount: number; cancelTickets: boolean; notifyBuyer: boolean; buyerMessage?: string | null };
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

// What Thunderstrux has refunded on a purchase so far: its succeeded requests.
export async function refundedSoFar(db: Prisma.TransactionClient | typeof prisma, purchase: Purchase, except?: string) {
  const sum = await db.refundRequest.aggregate({
    where: { ...(purchase.commerceOrderId ? { commerceOrderId: purchase.commerceOrderId } : { orderId: purchase.orderId as string }), status: "succeeded", ...(except ? { id: { not: except } } : {}) },
    _sum: { amount: true }
  });
  return sum._sum.amount ?? 0;
}

// The tickets staff picked: this order's, still valid, each once.
async function pickedTickets(tx: Prisma.TransactionClient, orderId: string, ticketIds: string[]) {
  const unique = [...new Set(ticketIds)];
  const found = await tx.ticket.findMany({ where: { orderId, id: { in: unique }, validity: "active" }, orderBy: { issueSequence: "asc" }, select: { id: true } });
  if (unique.length === 0 || unique.length !== ticketIds.length || found.length !== unique.length) {
    throw new OrderRefundError("invalid_selection", "Pick tickets of this order that are still valid");
  }
  return found.map((ticket) => ticket.id);
}

export async function requestOrderRefund(input: {
  organisationId: string;
  orderId: string;
  actor: Actor;
  reason: string;
  confirmation: string;
  selection?: TicketSelection;
}) {
  // The caller has verified the staff member's authenticator code (see the route);
  // amount 0 goes to cancelOrderTickets, as nothing is refunded.
  const token = randomUUID();
  const request = await prisma.$transaction((tx) => openOrderRefund(tx, { ...input, processing: { token, now: new Date() } }));
  return sendRefund(request.id, token, "staff_action");
}

// Checks one ticket order under its lock, sets the refund fence and records the
// request. With `processing` the caller sends it at once under that lease;
// without it the refund worker sends it (an event cancellation queues one per
// order, EVT-004). `confirmation` is the order reference staff type back. A null
// actor is Thunderstrux itself, refunding on a Stripe event (an early fraud warning).
export async function openOrderRefund(tx: Prisma.TransactionClient, input: {
  organisationId: string;
  orderId: string;
  actor: Actor | null;
  reason: string;
  confirmation?: string;
  processing?: { token: string; now: Date };
  // Without one: every ticket still standing and all that is left (the whole order, or the rest).
  selection?: TicketSelection;
}) {
  const reason = input.reason.trim();
  if (!(await lockOrder(tx, input.orderId, input.organisationId))) throw new OrderRefundError("not_found", "Order was not found");
  const order = await tx.order.findFirst({
    where: { id: input.orderId, event: { organisationId: input.organisationId } },
    include: { compensationRefundJob: { select: { state: true } } }
  });
  if (!order) throw new OrderRefundError("not_found", "Order was not found");
  if (input.confirmation !== undefined && input.confirmation.trim().toUpperCase() !== orderReference(order.id)) {
    throw new OrderRefundError("confirmation_mismatch", `Type ${orderReference(order.id)} to confirm`);
  }
  if (order.refundStatus === "refunded") throw new OrderRefundError("already_refunded", "This order has already been refunded");
  if (order.refundStatus === "processing") throw new OrderRefundError("in_progress", "A refund for this order is already in progress");
  // PAY-036: only an open or lost dispute fences a refund; the society kept a won one.
  if (order.disputeStatus === "open" || order.disputeStatus === "lost") throw new OrderRefundError("disputed", "The buyer has disputed this payment, so it can't be refunded here");
  // What the buyer can still get back: the total less refunds made here or in Stripe.
  const left = order.totalAmount - (await refundedSoFar(tx, { orderId: order.id, commerceOrderId: null })) - order.externalRefundedAmount;
  // Refunded in full with tickets kept valid: refundStatus stays clear so they can still be cancelled.
  if (order.paymentKind === "stripe" && order.totalAmount > 0 && left <= 0) throw new OrderRefundError("already_refunded", "Everything paid for this order has been refunded");
  const { selection } = input;
  const tickets = selection
    ? await pickedTickets(tx, order.id, selection.ticketIds)
    : (await tx.ticket.findMany({ where: { orderId: order.id, validity: { not: "void" } }, orderBy: { issueSequence: "asc" }, select: { id: true } })).map((ticket) => ticket.id);
  const amount = selection ? selection.amount : left;
  const cap = Math.min(tickets.length * order.unitPrice, left);
  if (selection && (!Number.isInteger(amount) || amount < 1 || amount > cap)) {
    throw new OrderRefundError("invalid_selection", cap > 0 ? `Refund between $0.01 and ${formatMoney(cap)} for those tickets, or $0 to cancel them` : "Nothing is left to refund on this order");
  }
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
      actorUserId: input.actor?.id ?? null, operationKey: `order-refund:${randomUUID()}`, destinationAccountId: order.sellerStripeAccountId,
      ticketIds: tickets, cancelsTickets: selection?.cancelTickets ?? true, notifyBuyer: selection?.notifyBuyer ?? true, buyerMessage: selection?.buyerMessage?.trim() || null,
      ...(input.processing ? { attempts: 1, processingToken: input.processing.token, processingStartedAt: input.processing.now } : {})
    }
  });
  await appendOrderLifecycleEvent(tx, {
    orderId: order.id, type: "refund_requested", source: input.actor ? "staff_action" : "stripe_webhook", actorUserId: input.actor?.id ?? null, reason,
    facts: selection ? { amount, ticketCount: tickets.length, cancelsTickets: selection.cancelTickets } : { amount }
  });
  await tx.auditLog.create({ data: {
    organisationId: input.organisationId, actorUserId: input.actor?.id ?? null, action: "order.refund_requested", targetType: "Order", targetId: order.id,
    metadata: { refundRequestId: created.id, amount, reason, ...(selection ? { tickets: tickets.map(ticketReference), cancelsTickets: selection.cancelTickets, notifyBuyer: selection.notifyBuyer } : {}) }
  } });
  return created;
}

// The same whole-order refund for a membership or merchandise order (T23c).
// Since PAY-003 a dispute pauses it, and after a partial refund made in
// Stripe it refunds the rest.
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
    // PAY-036: only an open or lost dispute fences a refund; the society kept a won one.
    if (order.disputeStatus === "open" || order.disputeStatus === "lost") throw new OrderRefundError("disputed", "The buyer has disputed this payment, so it can't be refunded here");
    const amount = order.totalAmount - order.externalRefundedAmount;
    if (
      order.paymentKind !== "stripe" || order.status !== "paid" || !order.fulfilledAt || order.requiresCompensationReview ||
      !order.stripeSessionId || !order.sellerStripeAccountId || amount <= 0
    ) {
      throw new OrderRefundError("not_refundable", "This order can't be refunded here");
    }
    await tx.commerceOrder.update({ where: { id: order.id }, data: { refundStatus: "processing" } });
    const created = await tx.refundRequest.create({
      data: {
        commerceOrderId: order.id, organisationId: input.organisationId, amount, currency: order.currency, reason,
        actorUserId: input.actor.id, operationKey: `commerce-refund:${randomUUID()}`, destinationAccountId: order.sellerStripeAccountId,
        attempts: 1, processingToken: token, processingStartedAt: now
      }
    });
    await appendCommerceLifecycleEvent(tx, {
      commerceOrderId: order.id, type: "refund_requested", source: "staff_action", actorUserId: input.actor.id, reason, facts: { amount }
    });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "commerce_order.refund_requested", targetType: "CommerceOrder", targetId: order.id,
      metadata: { refundRequestId: created.id, amount, reason }
    } });
    return created;
  });

  return sendRefund(request.id, token, "staff_action");
}

// The charge this request refunds, checked against the purchase and the
// snapshot of who was paid; the request's own refund at Stripe, if one exists;
// what Stripe will still refund; and whether the payment's other refunds differ
// from those already recorded: earlier ones made here (DEBT-002) and those made in Stripe.
async function verifiedPayment(request: Purchase & { id: string; amount: number; currency: string; destinationAccountId: string | null }) {
  const select = { id: true, stripeSessionId: true, totalAmount: true, externalRefundedAmount: true } as const;
  const order = request.commerceOrderId
    ? await prisma.commerceOrder.findUniqueOrThrow({ where: { id: request.commerceOrderId }, select })
    : await prisma.order.findUniqueOrThrow({ where: { id: request.orderId as string }, select });
  const named = request.commerceOrderId ? "commerceOrderId" : "orderId";
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId as string, { expand: ["payment_intent", "payment_intent.latest_charge"] });
  const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
  const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
  // Not `charge.disputed`: Stripe keeps it true after a dispute closes, so a won
  // dispute would block every later refund. The order's `disputeStatus` fences an
  // open or lost dispute, and Stripe itself refuses a refund while one is open.
  if (
    session.payment_status !== "paid" || session.amount_total !== order.totalAmount || session.currency?.toLowerCase() !== request.currency ||
    session.metadata?.[named] !== order.id || !intent || intent.amount_received !== order.totalAmount ||
    intent.transfer_data?.destination !== request.destinationAccountId || !charge
  ) {
    throw new RefundVerificationError("provider_identity_not_eligible");
  }
  const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
  const own = refunds.data.find((refund) => refund.metadata?.refundRequestId === request.id);
  const elsewhere = refunds.data
    .filter((refund) => refund !== own && refund.status !== "failed" && refund.status !== "canceled")
    .reduce((sum, refund) => sum + refund.amount, 0);
  const recorded = (await refundedSoFar(prisma, request, request.id)) + order.externalRefundedAmount;
  return { stripe, intent, own: own ?? null, left: charge.amount - charge.amount_refunded, unrecorded: elsewhere !== recorded };
}

// A refund made in Stripe got there first, so the request has nothing left to send.
const refundedElsewhere = "refunded_elsewhere";

// Sends (or finds) the request's refund while holding its processing lease.
async function sendRefund(requestId: string, token: string, source: "staff_action" | "refund_worker") {
  const request = await prisma.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
  // An earlier attempt recorded the intent before creating, so this request's refund
  // may already exist: a failed read proves nothing, and only Stripe's outcome settles it (SEC-011).
  const mayExist = request.stripePaymentIntentId !== null;
  try {
    const { stripe, intent, own, left, unrecorded } = await verifiedPayment(request);
    // PAY-049: a refund made in Stripe after this one was queued leaves less to send. The buyer
    // was promised this one and nobody is watching, so it sends what is left, or closes if that
    // is nothing. Staff on screen confirmed their amount, so they review what Stripe has instead.
    const short = !own && !mayExist && left < request.amount;
    if (short ? source === "staff_action" : !own && unrecorded) throw new RefundVerificationError("existing_refund_requires_review");
    if (short && left === 0) {
      await fail(request.id, token, refundedElsewhere, source);
      return { refundRequestId: request.id, status: "failed" as const };
    }
    // Stripe refuses a key sent again with another amount, so a lower amount needs its own.
    const send = short ? { amount: left, operationKey: `${request.commerceOrderId ? "commerce" : "order"}-refund:${randomUUID()}` } : { amount: request.amount, operationKey: request.operationKey };
    const held = await prisma.refundRequest.updateMany({ where: { id: request.id, processingToken: token }, data: { stripePaymentIntentId: intent.id, ...send } });
    if (held.count !== 1) return { refundRequestId: request.id, status: "pending" as const };
    if (short) logInfo("order_refund.amount_lowered", { refundRequestId: request.id, orderId: request.orderId, commerceOrderId: request.commerceOrderId, requested: request.amount, sending: left });
    if (request.commerceOrderId) await prisma.commerceOrder.update({ where: { id: request.commerceOrderId }, data: { stripePaymentIntentId: intent.id } });
    else await prisma.order.update({ where: { id: request.orderId as string }, data: { stripePaymentIntentId: intent.id } });
    const refund = own ?? await stripe.refunds.create({
      payment_intent: intent.id,
      amount: send.amount,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: refundMetadata(request.id, request)
    }, { idempotencyKey: send.operationKey });
    const status = await applyOutcome(request.id, refund, { source, token });
    return { refundRequestId: request.id, status };
  } catch (error) {
    if (!mayExist && error instanceof RefundVerificationError) {
      await fail(request.id, token, error.code, source);
      throw new OrderRefundError("verification_failed", "Stripe's record of this payment doesn't match the order, so nothing was refunded");
    }
    if (!mayExist && isDefiniteProviderFailure(error)) {
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
  // A buyer already repaid in Stripe has nothing to hear, and nobody needs to act.
  const tell = source !== "staff_action" && code !== refundedElsewhere;
  const failed = await prisma.$transaction(async (tx) => {
    const request = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    if (!(await lockPurchase(tx, request))) return null;
    const updated = await tx.refundRequest.updateMany({
      where: { id: requestId, status: { in: ["pending", "uncertain"] }, ...(token ? { processingToken: token } : {}) },
      data: { status: "failed", processingToken: null, processingStartedAt: null, lastErrorCode: code, resolvedAt: new Date() }
    });
    if (updated.count !== 1) return null;
    await liftFence(tx, request);
    await appendHistory(tx, request, { type: "refund_failed", source, reason: code });
    const target = auditTarget(request);
    await tx.auditLog.create({ data: {
      organisationId: request.organisationId, actorUserId: null, action: `${target.action}.refund_failed`, targetType: target.targetType, targetId: target.targetId,
      metadata: { refundRequestId: requestId, reason: code }
    } });
    if (tell) await queueRefundTroubleNotice(tx, request, "failed");
    return request;
  });
  if (failed && tell) alertRefundFailed(failed, code);
}

// PAY-026: staff see their own refund fail on screen; any other failure (the
// worker's, an event cancellation's, a fraud warning's, or Stripe's later answer)
// reaches a person.
type RefundAlert = { request: { id: string; orderId: string | null; commerceOrderId: string | null }; reason: string; code?: string | null };
function alertRefundFailed(request: RefundAlert["request"], reason: string, code?: string | null) {
  emitOperationalAlert("refund_failed", {
    refundRequestId: request.id, orderId: request.orderId, commerceOrderId: request.commerceOrderId, reason, code: code ?? null, dedupeKey: `refund_failed:${request.id}:${reason}`
  });
}

// PAY-025, PAY-026: the buyer was told money is coming that now isn't. A refund
// that came back from the bank was promised by the refund email; a failed one by
// the event-cancelled email (EVT-004), so only a cancelled event's buyers hear of that.
async function queueRefundTroubleNotice(
  tx: Prisma.TransactionClient,
  request: { id: string; orderId: string | null; commerceOrderId: string | null; organisationId: string; amount: number },
  trouble: "returned" | "failed"
) {
  const order = request.commerceOrderId
    ? await tx.commerceOrder.findUniqueOrThrow({ where: { id: request.commerceOrderId }, select: { buyerEmailSnapshot: true, sellerName: true } })
    : await tx.order.findUniqueOrThrow({ where: { id: request.orderId as string }, select: { buyerEmailSnapshot: true, event: { select: { title: true, cancelledAt: true } } } });
  const event = "event" in order ? order.event : null;
  if (!order.buyerEmailSnapshot || (trouble === "failed" && !event?.cancelledAt)) return;
  const purchase = event ? `your order for ${event.title}` : `your order from ${"sellerName" in order ? order.sellerName : "the society"}`;
  const message = trouble === "returned"
    ? `The refund of ${formatMoney(request.amount)} for ${purchase} came back from your bank, so it hasn't reached you. Thunderstrux will contact you to return it another way.`
    : `We couldn't refund ${purchase} automatically, so the refund hasn't started. Thunderstrux has been told and will contact you to sort it out.`;
  await enqueueNotification(tx, {
    eventKey: `refund-${trouble}/${request.id}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: request.organisationId,
    payload: { subject: trouble === "returned" ? "Your refund came back" : "Your refund hasn't started", message }
  });
}

type TicketRefund = { id: string; orderId: string; organisationId: string; amount: number; ticketIds: string[]; cancelsTickets: boolean; notifyBuyer: boolean; buyerMessage: string | null };

// A confirmed ticket refund voids the tickets it is for (attendance is kept)
// unless staff kept them valid, puts their places back on sale and, if asked,
// emails the buyer. An empty list is every ticket, as whole-order refunds were.
// The order reads Refunded once none of its tickets is left (DEBT-002).
async function refundTickets(tx: Prisma.TransactionClient, request: TicketRefund, now: Date) {
  const cancelled = request.cancelsTickets
    ? await tx.ticket.findMany({
        where: { orderId: request.orderId, validity: { not: "void" }, ...(request.ticketIds.length ? { id: { in: request.ticketIds } } : {}) },
        orderBy: { issueSequence: "asc" },
        select: { id: true }
      })
    : [];
  if (cancelled.length) {
    await tx.ticket.updateMany({ where: { id: { in: cancelled.map((ticket) => ticket.id) } }, data: { validity: "void", validityReason: "refunded", validityChangedAt: now } });
    await returnTicketsToSale(tx, request.orderId, cancelled.length);
  }
  const standing = await tx.ticket.count({ where: { orderId: request.orderId, validity: { not: "void" } } });
  const order = await tx.order.update({
    where: { id: request.orderId },
    data: { refundStatus: standing === 0 ? "refunded" : null },
    select: { buyerEmailSnapshot: true, sellerName: true, event: { select: { title: true, organisation: { select: { name: true } } } } }
  });
  if (!order.buyerEmailSnapshot || !request.notifyBuyer) return;
  const money = formatMoney(request.amount);
  const references = cancelled.map((ticket) => ticketReference(ticket.id)).join(", ");
  const note = request.buyerMessage ? ` A note from ${order.sellerName ?? order.event.organisation.name}: "${request.buyerMessage}"` : "";
  const message = standing === 0
    ? `Your order for ${order.event.title} has been refunded: ${money} is on its way back to your card. Banks usually take 5 to 10 business days. Your tickets are no longer valid.${note}`
    : `We've refunded ${money} of your order for ${order.event.title}; it's on its way back to your card. Banks usually take 5 to 10 business days.${
        cancelled.length
          ? ` ${cancelled.length === 1 ? `Ticket ${references} no longer works` : `Tickets ${references} no longer work`}; your other ${standing === 1 ? "ticket still works" : `${standing} tickets still work`}.`
          : " Your tickets still work."
      }${note}`;
  await enqueueNotification(tx, {
    eventKey: `refund/${request.id}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: request.organisationId,
    payload: { message }
  });
}

// Amount 0 (as Humanitix): the picked tickets of a paid order stop working and go
// back on sale with no refund and nothing sent to Stripe; the buyer is emailed if asked.
export async function cancelOrderTickets(input: { organisationId: string; orderId: string; actor: Actor; reason: string; confirmation: string; selection: TicketSelection }) {
  const reason = input.reason.trim();
  if (!input.selection.cancelTickets) throw new OrderRefundError("invalid_selection", "Refund an amount, or cancel the tickets");
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    // The places go back on sale: event and ticket type before the order, as a refund's outcome takes them.
    await lockOrderInventory(tx, input.orderId);
    if (!(await lockOrder(tx, input.orderId, input.organisationId))) throw new OrderRefundError("not_found", "Order was not found");
    const order = await tx.order.findFirst({
      where: { id: input.orderId, event: { organisationId: input.organisationId } },
      select: { id: true, status: true, paymentKind: true, refundStatus: true, disputeStatus: true, buyerEmailSnapshot: true, sellerName: true, event: { select: { title: true, organisation: { select: { name: true } } } } }
    });
    if (!order) throw new OrderRefundError("not_found", "Order was not found");
    if (input.confirmation.trim().toUpperCase() !== orderReference(order.id)) throw new OrderRefundError("confirmation_mismatch", `Type ${orderReference(order.id)} to confirm`);
    if (order.refundStatus === "processing") throw new OrderRefundError("in_progress", "A refund for this order is already in progress");
    if (order.disputeStatus === "open" || order.disputeStatus === "lost") throw new OrderRefundError("disputed", "The buyer has disputed this payment, so it can't be refunded here");
    if (order.paymentKind !== "stripe" || order.status !== "paid") throw new OrderRefundError("not_refundable", "This order's tickets can't be cancelled here");
    const tickets = await pickedTickets(tx, order.id, input.selection.ticketIds);
    await tx.ticket.updateMany({ where: { id: { in: tickets } }, data: { validity: "void", validityReason: "cancelled", validityChangedAt: now } });
    await returnTicketsToSale(tx, order.id, tickets.length);
    const references = tickets.map(ticketReference);
    await appendOrderLifecycleEvent(tx, { orderId: order.id, type: "tickets_cancelled", source: "staff_action", actorUserId: input.actor.id, reason, facts: { ticketCount: tickets.length } });
    await tx.auditLog.create({ data: {
      organisationId: input.organisationId, actorUserId: input.actor.id, action: "order.tickets_cancelled", targetType: "Order", targetId: order.id,
      metadata: { reason, tickets: references, notifyBuyer: input.selection.notifyBuyer }
    } });
    if (!order.buyerEmailSnapshot || !input.selection.notifyBuyer) return;
    const seller = order.sellerName ?? order.event.organisation.name;
    const standing = await tx.ticket.count({ where: { orderId: order.id, validity: { not: "void" } } });
    const note = input.selection.buyerMessage?.trim() ? ` Their note: "${input.selection.buyerMessage.trim()}"` : "";
    await enqueueNotification(tx, {
      eventKey: `tickets-cancelled/${order.id}/${randomUUID()}`, recipient: order.buyerEmailSnapshot, template: "business_notice", organisationId: input.organisationId,
      payload: {
        subject: `Tickets cancelled: ${order.event.title}`,
        message: `${seller} cancelled ${tickets.length === 1 ? `ticket ${references[0]}` : `tickets ${references.join(", ")}`} for ${order.event.title}, so ${tickets.length === 1 ? "it no longer works" : "they no longer work"}. No refund was made.${standing ? ` Your other ${standing === 1 ? "ticket still works" : `${standing} tickets still work`}.` : ""}${note}`
      }
    });
  });
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
    // A payment refunded because it couldn't be filled leaves review once Stripe confirms (PAY-003).
    data: { refundStatus: "refunded", requiresCompensationReview: false },
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
      message: `Your ${items} from ${order.sellerName} has been refunded: ${formatMoney(request.amount)} is on its way back to your card. Banks usually take 5 to 10 business days.${ended.count ? " Your membership has ended." : ""}${order.kind === "merchandise" && order.pickupStatus && order.pickupStatus !== "collected" ? " The pickup is cancelled, so there's nothing to collect." : ""}`
    }
  });
  return ended.count;
}

// Projects Stripe's answer for this request's refund.
async function applyOutcome(
  requestId: string,
  refund: Stripe.Refund,
  { source, token, webhook }: { source: RefundSource; token?: string; webhook?: { stripeEventId: string; eventType: string; eventCreatedAt: Date } }
): Promise<RefundRequestStatus> {
  const status = providerStatus(refund);
  const now = new Date();
  const { stripeEventId, eventCreatedAt } = webhook ?? {};
  // Raised after commit, so an alert never names a change that rolled back.
  let alert = null as RefundAlert | null;
  const result = await prisma.$transaction(async (tx) => {
    const request = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    // A confirmed ticket refund puts the places back on sale: event and ticket type first.
    if (request.orderId) await lockOrderInventory(tx, request.orderId);
    if (!(await lockPurchase(tx, request))) return request.status;
    if (webhook) {
      // Journalled with the outcome, so a delivery that fails to apply is
      // applied by Stripe's retry instead of dropped as a duplicate (PAY-014).
      const journal = await tx.stripeRefundWebhookEvent.createMany({ data: [{ ...webhook, refundRequestId: requestId }], skipDuplicates: true });
      if (journal.count === 0) return request.status;
    }
    const current = await tx.refundRequest.findUniqueOrThrow({ where: { id: requestId } });
    // PAY-025: a refund that succeeded can still come back from the bank. Stripe
    // returns the money to Thunderstrux's balance, so the order stays refunded
    // (the society's share was taken back) and a person repays the buyer another way.
    if (current.status === "succeeded" && status === "failed" && current.stripeRefundId === refund.id) {
      if (current.lastErrorCode === "provider_refund_returned") return current.status;
      await tx.refundRequest.update({
        where: { id: requestId },
        data: { providerStatus: refund.status, lastProviderEventAt: eventCreatedAt ?? current.lastProviderEventAt, lastErrorCode: "provider_refund_returned" }
      });
      await appendHistory(tx, request, { type: "refund_failed", source, stripeEventId, reason: "returned_by_bank" });
      await queueRefundTroubleNotice(tx, request, "returned");
      alert = { request, reason: "returned_by_bank", code: refund.failure_reason };
      return current.status;
    }
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
      if (source !== "staff_action") {
        await queueRefundTroubleNotice(tx, request, "failed");
        alert = { request, reason: "provider_refund_failed", code: refund.failure_reason };
      }
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
  if (alert) alertRefundFailed(alert.request, alert.reason, alert.code);
  return result;
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
    let result: { refundRequestId: string; status: string };
    try {
      result = await sendRefund(candidate.id, token, "refund_worker");
    } catch (error) {
      result = { refundRequestId: candidate.id, status: error instanceof OrderRefundError ? "failed" : "error" };
    }
    results.push(result);
    if (candidate.attempts >= maxAttempts && (result.status === "pending" || result.status === "uncertain")) {
      // Still unresolved after repeated checks: a person is alerted and the fence
      // stays, and Stripe is still asked hourly, so a late answer settles it (PAY-013).
      await prisma.refundRequest.updateMany({ where: { id: candidate.id, status: { in: ["pending", "uncertain"] }, processingToken: null }, data: { nextAttemptAt: new Date(now.getTime() + 60 * pollMs), lastErrorCode: "provider_unresolved" } });
      emitOperationalAlert("order_refund_unresolved", { refundRequestId: candidate.id, orderId: candidate.orderId, commerceOrderId: candidate.commerceOrderId });
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
  await applyOutcome(request.id, refund, { source: "stripe_webhook", webhook: { stripeEventId: event.id, eventType: event.type, eventCreatedAt } });
}

// For order detail: the latest request, to show processing, refunded or failed.
// Refunds made earlier on the same order are summed by refundedSoFar.
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
