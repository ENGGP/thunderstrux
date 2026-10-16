import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { isDefiniteProviderFailure } from "@/lib/payments/checkout-attempts";
import {
  attachStripeSession,
  CheckoutCreationInternalError,
  failPendingOrder
} from "@/lib/payments/checkout-binding";
import { lockOrder } from "@/lib/payments/order-lifecycle";
import { getStripe } from "@/lib/stripe";

// Recovery for attempts whose Stripe outcome was never confirmed (T14b). Each
// due attempt replays its stored Session request with the same idempotency key:
// Stripe returns the original Session if it made one, so recovery never creates
// a second Session or charge. If Stripe never received the request, the stored
// expiry is by then too close and Stripe refuses it, which releases the hold.

// A claim hides the attempt from other workers for this long; a crashed worker's
// claim simply reappears. Every step after the claim is idempotent.
export const attemptRecoveryLeaseMs = 2 * 60 * 1000;
export const attemptRetryDelayMs = 2 * 60 * 1000;
// Stripe keeps idempotent results for 24 hours.
export const attemptReplayWindowMs = 24 * 60 * 60 * 1000;
const recoverableStates = ["created", "provider_uncertain"] as const;

type ClaimedAttempt = {
  id: string;
  orderId: string;
  providerOperationKey: string;
  providerRequest: Stripe.Checkout.SessionCreateParams | null;
  createdAt: Date;
};

export type AttemptRecoveryOutcome =
  | "attached"
  | "provider_refused"
  | "provider_never_called"
  | "order_closed"
  | "retry_scheduled"
  | "replay_window_passed";

async function claimNextAttempt(now: Date): Promise<ClaimedAttempt | null> {
  return prisma.$transaction(async (tx) => {
    const candidate = await tx.checkoutAttempt.findFirst({
      where: { state: { in: [...recoverableStates] }, reconcileDueAt: { lte: now }, orderId: { not: null } },
      orderBy: [{ reconcileDueAt: "asc" }, { id: "asc" }],
      select: { id: true, orderId: true, reconcileDueAt: true }
    });
    if (!candidate?.orderId || !(await lockOrder(tx, candidate.orderId))) return null;

    // Order, then attempt: the same order checkout's binding step uses.
    const claimed = await tx.checkoutAttempt.updateMany({
      where: { id: candidate.id, state: { in: [...recoverableStates] }, reconcileDueAt: candidate.reconcileDueAt },
      data: { reconcileDueAt: new Date(now.getTime() + attemptRecoveryLeaseMs) }
    });
    if (claimed.count !== 1) return null;

    const attempt = await tx.checkoutAttempt.findUniqueOrThrow({
      where: { id: candidate.id },
      select: { id: true, orderId: true, providerOperationKey: true, providerRequest: true, createdAt: true }
    });
    return {
      ...attempt,
      orderId: candidate.orderId,
      providerRequest: attempt.providerRequest as unknown as Stripe.Checkout.SessionCreateParams | null
    };
  });
}

async function closeAttempt(attemptId: string, outcome: string, session?: { id: string; url: string | null }) {
  await prisma.checkoutAttempt.updateMany({
    where: { id: attemptId, state: { in: [...recoverableStates] } },
    data: {
      state: "failed",
      reconcileDueAt: null,
      lastOutcome: outcome,
      ...(session ? { stripeSessionId: session.id, stripeSessionUrl: session.url } : {})
    }
  });
}

async function recoverAttempt(attempt: ClaimedAttempt, now: Date): Promise<AttemptRecoveryOutcome> {
  // The request is stored before Stripe is called, so without it Stripe never saw this attempt.
  if (!attempt.providerRequest) {
    await failPendingOrder(attempt.orderId, "Checkout stopped before Stripe was called", "checkout_recovery", "provider_never_called");
    await closeAttempt(attempt.id, "provider_never_called");
    return "provider_never_called";
  }

  if (now.getTime() - attempt.createdAt.getTime() > attemptReplayWindowMs) {
    await closeAttempt(attempt.id, "replay_window_passed");
    emitOperationalAlert("checkout_attempt_recovery_abandoned", { attemptId: attempt.id, orderId: attempt.orderId });
    return "replay_window_passed";
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.create(attempt.providerRequest, {
      idempotencyKey: attempt.providerOperationKey
    });
  } catch (error) {
    if (isDefiniteProviderFailure(error)) {
      await failPendingOrder(attempt.orderId, "Stripe refused the recovered checkout", "checkout_recovery", "provider_refused");
      await closeAttempt(attempt.id, "provider_refused");
      return "provider_refused";
    }
    await prisma.checkoutAttempt.updateMany({
      where: { id: attempt.id, state: { in: [...recoverableStates] } },
      data: { state: "provider_uncertain", lastOutcome: "replay_unknown", reconcileDueAt: new Date(now.getTime() + attemptRetryDelayMs) }
    });
    return "retry_scheduled";
  }

  if (!session.url) {
    await failPendingOrder(attempt.orderId, "Stripe Checkout Session did not include a redirect URL", "checkout_recovery", "missing_redirect_url");
    await closeAttempt(attempt.id, "missing_redirect_url", session);
    return "provider_refused";
  }

  try {
    await attachStripeSession(attempt.orderId, session.id, session.url, "checkout_recovery");
    return "attached";
  } catch (error) {
    if (!(error instanceof CheckoutCreationInternalError)) throw error;
    // The order closed first (its hold expired with the Session); binding
    // recorded the Session on the failed attempt. A payment on it still arrives
    // by webhook and goes to compensation review.
    return "order_closed";
  }
}

export async function processCheckoutAttemptRecoveryBatch({ limit = 25, now = new Date() }: { limit?: number; now?: Date } = {}) {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const outcomes: Record<AttemptRecoveryOutcome, number> = {
    attached: 0,
    provider_refused: 0,
    provider_never_called: 0,
    order_closed: 0,
    retry_scheduled: 0,
    replay_window_passed: 0
  };
  let processed = 0;

  for (let index = 0; index < boundedLimit; index += 1) {
    const attempt = await claimNextAttempt(now);
    if (!attempt) break;
    outcomes[await recoverAttempt(attempt, now)] += 1;
    processed += 1;
  }

  logInfo("checkout_attempt_recovery.batch.completed", { processed, ...outcomes });
  emitMetric("checkout_attempts_recovered_total", outcomes.attached, {});
  return { processed, ...outcomes };
}
