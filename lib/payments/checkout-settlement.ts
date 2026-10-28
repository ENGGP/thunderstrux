import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import {
  isCommerceSession,
  reconcileCommerceCheckoutSession,
  reconcileExpiredCommerceSession,
  type CommerceReconciliationResult
} from "@/lib/commerce/reconciliation";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import { reconcileExpiredCheckoutSession, type CheckoutReconciliationResult } from "@/lib/payments/checkout-reconciliation";
import { getStripe } from "@/lib/stripe";

// PAY-024, Stripe's fulfil-checkout pattern: one way from a Checkout Session to
// its order, used by the signed webhook and by the reconciliation sweep. The
// family reconcilers it routes to verify the payment and are idempotent under
// their locks, so a webhook and the sweep may apply the same Session in any
// order, even at once. The webhook stays the main path; the sweep asks Stripe
// about pending orders so a lost webhook never strands a paid buyer, and an
// order is never expired without checking whether it was paid.

export type SettlementSource = "webhook" | "reconciliation_sweep";
export type Settlement =
  | { family: "ticket"; result: CheckoutReconciliationResult }
  | { family: "commerce"; result: CommerceReconciliationResult };

export async function settleCheckoutSession(
  session: Stripe.Checkout.Session,
  { completed, stripeEventId, source }: { completed: boolean; stripeEventId?: string; source: SettlementSource }
): Promise<Settlement> {
  const lifecycle = source === "webhook" ? "stripe_webhook" : "reconciliation_sweep";
  // A Session with a family is a membership or merchandise purchase (T21); one
  // without is a ticket purchase, unless it is in fact a commerce order's.
  if (session.metadata?.family !== undefined) {
    const options = { stripeEventId, source: lifecycle } as const;
    const result = completed ? await reconcileCommerceCheckoutSession(session, options) : await reconcileExpiredCommerceSession(session, options);
    return { family: "commerce", result };
  }
  if (await isCommerceSession(session.id)) {
    const details = { reason: "commerce_session_without_family", stripeEventId, stripeSessionId: session.id };
    logWarn("commerce.webhook.ignored", details);
    emitOperationalAlert("commerce_webhook_identity_mismatch", details);
    return { family: "commerce", result: { status: "ignored", reason: "commerce_session_without_family" } };
  }
  const result = completed
    ? await reconcileCompletedCheckoutSessionWithSideEffects(session, { stripeEventId, source })
    : await reconcileExpiredCheckoutSession(session, { stripeEventId, source: lifecycle });
  return { family: "ticket", result };
}

// A pending order is first checked this long after it was created (a webhook
// normally lands within seconds), then at most this often.
export const sweepFirstCheckAfterMs = 2 * 60_000;
export const sweepRecheckEveryMs = 2 * 60_000;
// Stripe reads per family per run; the stale-order batch adds its own.
export const sweepBatchLimit = 25;

type Family = "ticket" | "commerce";
type PendingCheckout = { family: Family; id: string; stripeSessionId: string; createdAt: Date };
// What one look at Stripe did: applied the Session; found it still open; Stripe
// has no such Session; couldn't ask (Stripe failed); or Stripe isn't configured here.
type Look = "settled" | "open" | "missing" | "unavailable" | "unconfigured";

const isConfigurationError = (error: unknown) =>
  error instanceof Error && (error.name === "StripeConfigurationError" || error.constructor?.name === "StripeConfigurationError");

async function markChecked(order: PendingCheckout, now: Date) {
  const where = { id: order.id, status: "pending" as const };
  const data = { stripeCheckedAt: now };
  if (order.family === "ticket") await prisma.order.updateMany({ where, data });
  else await prisma.commerceOrder.updateMany({ where, data });
}

function failedLook(order: PendingCheckout, error: unknown): Look {
  if (isConfigurationError(error)) return "unconfigured";
  if ((error as { code?: string } | null)?.code === "resource_missing") return "missing";
  logWarn("checkout.sweep.stripe_unavailable", { family: order.family, orderId: order.id, stripeSessionId: order.stripeSessionId, error });
  return "unavailable";
}

// Ask Stripe about one pending order and apply what it says. `closeIfOpen` is
// for an order whose hold has ended: its page is closed first, so nothing can
// be paid on it after it expires here.
async function lookUp(order: PendingCheckout, { now, closeIfOpen }: { now: Date; closeIfOpen: boolean }): Promise<Look> {
  try {
    let session = await getStripe().checkout.sessions.retrieve(order.stripeSessionId, { expand: ["payment_intent"] });
    if (session.status === "open") {
      if (!closeIfOpen) {
        await markChecked(order, now);
        return "open";
      }
      session = await getStripe().checkout.sessions.expire(session.id);
    }
    const settled = await settleCheckoutSession(session, { completed: session.status === "complete", source: "reconciliation_sweep" });
    const outcome = settled.result.status;
    if (session.status === "complete" && session.payment_status === "paid" && (outcome === "fulfilled" || outcome === "compensation_required")) {
      // Only a webhook that never arrived leaves a paid Session for the sweep to find.
      emitOperationalAlert("stripe_webhook_missed", {
        family: order.family,
        orderId: order.id,
        stripeSessionId: session.id,
        outcome,
        minutesSinceCheckout: Math.round((now.getTime() - order.createdAt.getTime()) / 60_000)
      });
    }
    // Still pending only if the reconciler refused the Session (an identity mismatch it alerted on).
    await markChecked(order, now);
    return "settled";
  } catch (error) {
    return failedLook(order, error);
  }
}

const pendingSelect = { id: true, stripeSessionId: true, createdAt: true } as const;
const asPending = (family: Family) => (order: { id: string; stripeSessionId: string | null; createdAt: Date }): PendingCheckout => ({
  family,
  id: order.id,
  stripeSessionId: order.stripeSessionId as string,
  createdAt: order.createdAt
});

// The early check: pending Stripe orders past their first-check age and not
// asked about recently, least recently asked first.
export async function sweepPendingCheckouts({ now = new Date(), limit = sweepBatchLimit }: { now?: Date; limit?: number } = {}) {
  const counts = { checked: 0, settled: 0, open: 0, missing: 0, unavailable: 0 };
  try {
    getStripe();
  } catch (error) {
    if (!isConfigurationError(error)) throw error;
    logInfo("checkout.sweep.skipped", { reason: "stripe_unconfigured" });
    return { ...counts, skipped: "stripe_unconfigured" as const };
  }
  const where = {
    status: "pending" as const,
    paymentKind: "stripe" as const,
    stripeSessionId: { not: null },
    createdAt: { lt: new Date(now.getTime() - sweepFirstCheckAfterMs) },
    OR: [{ stripeCheckedAt: null }, { stripeCheckedAt: { lt: new Date(now.getTime() - sweepRecheckEveryMs) } }]
  };
  const orderBy = [{ stripeCheckedAt: { sort: "asc" as const, nulls: "first" as const } }, { createdAt: "asc" as const }];
  const [tickets, commerce] = await Promise.all([
    prisma.order.findMany({ where, orderBy, take: limit, select: pendingSelect }),
    prisma.commerceOrder.findMany({ where, orderBy, take: limit, select: pendingSelect })
  ]);
  for (const order of [...tickets.map(asPending("ticket")), ...commerce.map(asPending("commerce"))]) {
    const look = await lookUp(order, { now, closeIfOpen: false });
    counts.checked += 1;
    if (look === "settled" || look === "open" || look === "missing" || look === "unavailable") counts[look] += 1;
  }
  logInfo("checkout.sweep.processed", counts);
  emitMetric("checkout_sweep_settled_total", counts.settled);
  if (counts.unavailable > 0) emitOperationalAlert("checkout_reconciliation_unavailable", { stage: "early_check", ...counts });
  return counts;
}

// Called by the stale-order jobs before they expire a pending order. True when
// it may expire: it has no Stripe Session, Stripe settled or closed it (the
// expiry then finds it no longer pending if it was paid), or Stripe has no such
// Session. False defers it to the next run because Stripe couldn't be asked;
// in production a worker without Stripe never expires a Stripe order.
export async function mayExpireAfterStripeCheck(family: Family, id: string, now = new Date()) {
  const order =
    family === "ticket"
      ? await prisma.order.findUnique({ where: { id }, select: { ...pendingSelect, status: true } })
      : await prisma.commerceOrder.findUnique({ where: { id }, select: { ...pendingSelect, status: true } });
  if (!order?.stripeSessionId || order.status !== "pending") return true;
  const look = await lookUp(asPending(family)(order), { now, closeIfOpen: true });
  if (look === "unavailable") return false;
  if (look === "unconfigured") return process.env.NODE_ENV !== "production";
  return true;
}
