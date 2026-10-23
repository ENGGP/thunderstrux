import type { CommerceKind, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { failPendingCommerceOrder, lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { commerceFamilies, type CommerceOrderForHooks } from "@/lib/commerce/families";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { queueCommerceCompensationRefund } from "@/lib/commerce/payment-recovery";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { queueCommerceReviewNotice } from "@/lib/payments/compensation-notices";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { getStripe } from "@/lib/stripe";

// Signed Checkout Session webhooks for membership and merchandise orders
// (T21). A Session is routed here only by its `family` metadata; the order is
// then found by its unique Session (or, before the Session is bound, by the
// order id the attempt recorded) and must agree with that family and society.
// Anything that disagrees is ignored with an alert, never sent to another
// family. A paid Session is verified (amount, currency, destination) before
// the family's fulfilment runs under its locks; a payment that can't be
// honoured becomes a durable compensation review on the order.

const families = new Set<string>(["membership", "merchandise"]);

export type CommerceReconciliationResult =
  | { status: "fulfilled" | "already_fulfilled" | "failed" | "expired" | "compensation_required"; commerceOrderId: string }
  | { status: "ignored"; reason: string; commerceOrderId?: string };

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);

function ignored(reason: string, details: Record<string, unknown>, alert = true): CommerceReconciliationResult {
  logWarn("commerce.webhook.ignored", { reason, ...details });
  if (alert) emitOperationalAlert("commerce_webhook_identity_mismatch", { reason, ...details });
  return { status: "ignored", reason, commerceOrderId: details.commerceOrderId as string | undefined };
}

// The order a Session belongs to, checked against its metadata.
async function resolveOrder(session: Stripe.Checkout.Session, stripeEventId?: string) {
  const details = { stripeEventId, stripeSessionId: session.id, family: session.metadata?.family, commerceOrderId: session.metadata?.commerceOrderId };
  const family = session.metadata?.family;
  if (!family || !families.has(family)) return { error: ignored("unknown_family", details) };
  const select = { id: true, kind: true, organisationId: true, stripeSessionId: true } as const;
  const [bySession, byId] = await Promise.all([
    prisma.commerceOrder.findUnique({ where: { stripeSessionId: session.id }, select }),
    session.metadata?.commerceOrderId ? prisma.commerceOrder.findUnique({ where: { id: session.metadata.commerceOrderId }, select }) : null
  ]);
  if (bySession && byId && bySession.id !== byId.id) return { error: ignored("ambiguous_order", details) };
  const order = bySession ?? byId;
  if (!order) {
    const ticket = await prisma.order.findUnique({ where: { stripeSessionId: session.id }, select: { id: true } });
    return { error: ignored(ticket ? "ticket_session_with_family" : "order_not_found", details, Boolean(ticket)) };
  }
  if (order.kind !== (family as CommerceKind) || order.organisationId !== session.metadata?.organisationId) return { error: ignored("family_or_society_mismatch", details) };
  if (order.stripeSessionId && order.stripeSessionId !== session.id) return { error: ignored("session_mismatch", details) };
  return { order };
}

// Where the money went, read from Stripe before any lock.
async function paymentDestination(session: Stripe.Checkout.Session) {
  const intent = session.payment_intent;
  if (!intent) return { intentId: null, destination: null };
  const paymentIntent = typeof intent === "string" ? await getStripe().paymentIntents.retrieve(intent) : intent;
  return { intentId: paymentIntent.id, destination: idOf(paymentIntent.transfer_data?.destination) };
}

async function requireCompensation(
  tx: Prisma.TransactionClient,
  order: CommerceOrderForHooks,
  reason: string,
  facts: { stripeSessionId: string; stripePaymentIntentId: string | null; stripeEventId?: string; fromStatus: "pending" | "failed" | "expired"; holdOpen: boolean }
) {
  if (facts.holdOpen) await commerceFamilies[order.kind]?.release(tx, order, reason);
  const now = new Date();
  await tx.commerceOrder.update({
    where: { id: order.id },
    data: {
      status: "failed", requiresCompensationReview: true, reviewReason: reason, paidAt: now, failedAt: now, failureReason: reason,
      stripeSessionId: facts.stripeSessionId, stripePaymentIntentId: facts.stripePaymentIntentId, expiresAt: null
    }
  });
  await tx.checkoutAttempt.updateMany({ where: { commerceOrderId: order.id }, data: { reconcileDueAt: null, lastOutcome: "compensation_required" } });
  await appendCommerceLifecycleEvent(tx, {
    commerceOrderId: order.id, type: "compensation_required", source: "stripe_webhook", stripeEventId: facts.stripeEventId, reason, fromStatus: facts.fromStatus, toStatus: "failed"
  });
  await queueCommerceReviewNotice(tx, order.id);
  // PAY-003: refunded in full automatically, as a ticketing platform does with an order it can't complete.
  await queueCommerceCompensationRefund(tx, order.id, reason);
}

export async function reconcileCommerceCheckoutSession(
  session: Stripe.Checkout.Session,
  { stripeEventId }: { stripeEventId?: string } = {}
): Promise<CommerceReconciliationResult> {
  const resolved = await resolveOrder(session, stripeEventId);
  if ("error" in resolved) return resolved.error as CommerceReconciliationResult;
  const paid = session.payment_status === "paid";
  const { intentId, destination } = paid ? await paymentDestination(session) : { intentId: null, destination: null };
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    const order = await lockCommerceOrderForFamily(tx, resolved.order.id);
    if (!order) return { status: "ignored" as const, reason: "order_not_found" };
    const current = await tx.commerceOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { status: true, requiresCompensationReview: true, totalAmount: true, currency: true, sellerStripeAccountId: true, stripeSessionId: true }
    });
    // A replay, or a payment already under review: nothing more to do.
    if (current.status === "paid") return { status: "already_fulfilled" as const };
    if (current.requiresCompensationReview) return { status: "compensation_required" as const, alreadyRecorded: true };
    if (!paid) {
      return current.status === "pending" ? { status: "unpaid" as const } : { status: "ignored" as const, reason: "order_closed_unpaid" };
    }
    const facts = { stripeSessionId: session.id, stripePaymentIntentId: intentId, stripeEventId, fromStatus: current.status as "pending" | "failed" | "expired", holdOpen: current.status === "pending" };
    const mismatch =
      session.amount_total !== current.totalAmount ? "amount_mismatch"
        : session.currency?.toLowerCase() !== current.currency ? "currency_mismatch"
          : destination !== current.sellerStripeAccountId ? "destination_mismatch"
            : current.status !== "pending" ? "paid_after_order_closed"
              : null;
    if (mismatch) {
      await requireCompensation(tx, order, mismatch, facts);
      return { status: "compensation_required" as const, reason: mismatch };
    }
    const adapter = commerceFamilies[order.kind];
    const result = adapter ? await adapter.fulfil(tx, order, now) : { fulfilled: false as const, reason: "family_unavailable" };
    if (!result.fulfilled) {
      await requireCompensation(tx, order, result.reason, facts);
      return { status: "compensation_required" as const, reason: result.reason };
    }
    await tx.commerceOrder.update({
      where: { id: order.id },
      data: { status: "paid", paidAt: now, fulfilledAt: now, stripeSessionId: session.id, stripePaymentIntentId: intentId, expiresAt: null }
    });
    await tx.checkoutAttempt.updateMany({ where: { commerceOrderId: order.id }, data: { reconcileDueAt: null, lastOutcome: "fulfilled" } });
    await appendCommerceLifecycleEvent(tx, { commerceOrderId: order.id, type: "payment_fulfilled", source: "stripe_webhook", stripeEventId, fromStatus: "pending", toStatus: "paid" });
    return { status: "fulfilled" as const };
  });

  const commerceOrderId = resolved.order.id;
  if (outcome.status === "unpaid") {
    // A completed Session that isn't paid: no payment to honour, so the order fails.
    await failPendingCommerceOrder(commerceOrderId, "session_not_paid", "stripe_webhook", { stripeEventId });
    return { status: "failed", commerceOrderId };
  }
  if (outcome.status === "compensation_required" && !("alreadyRecorded" in outcome)) {
    emitOperationalAlert("paid_but_unfulfilled_compensation_required", { commerceOrderId, stripeSessionId: session.id, reason: outcome.reason, family: resolved.order.kind });
  }
  if (outcome.status === "ignored") return { status: "ignored", reason: outcome.reason, commerceOrderId };
  logInfo("commerce.webhook.reconciled", { commerceOrderId, stripeEventId, status: outcome.status });
  return { status: outcome.status, commerceOrderId };
}

export async function reconcileExpiredCommerceSession(session: Stripe.Checkout.Session, { stripeEventId }: { stripeEventId?: string } = {}): Promise<CommerceReconciliationResult> {
  const resolved = await resolveOrder(session, stripeEventId);
  if ("error" in resolved) return resolved.error as CommerceReconciliationResult;
  const expired = await failPendingCommerceOrder(resolved.order.id, "checkout_expired", "stripe_webhook", { status: "expired", stripeEventId });
  return expired ? { status: "expired", commerceOrderId: resolved.order.id } : { status: "ignored", reason: "order_not_pending", commerceOrderId: resolved.order.id };
}

// A Session with no family is a ticket Session. If it is in fact a commerce
// order's, it is not handed to ticket reconciliation.
export async function isCommerceSession(stripeSessionId: string) {
  return Boolean(await prisma.commerceOrder.findUnique({ where: { stripeSessionId }, select: { id: true } }));
}

// Stale-order worker: a pending paid order whose Stripe Session has expired
// (with a margin for a late webhook) is expired and its hold released.
export async function expireStaleCommerceOrders({ now = new Date(), limit = 100, graceMs = 5 * 60 * 1000 } = {}) {
  const stale = await prisma.commerceOrder.findMany({
    where: { status: "pending", paymentKind: "stripe", expiresAt: { lt: new Date(now.getTime() - graceMs) } },
    orderBy: { expiresAt: "asc" },
    take: Math.max(1, Math.min(limit, 500)),
    select: { id: true }
  });
  let expired = 0;
  for (const order of stale) if (await failPendingCommerceOrder(order.id, "hold_expired", "stale_cleanup", { status: "expired" })) expired += 1;
  logInfo("commerce.stale_orders.expired", { expired, considered: stale.length });
  return { expired, considered: stale.length };
}
