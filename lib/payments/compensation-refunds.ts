import { randomUUID } from "node:crypto";
import { Prisma, type CompensationRefundState } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { queueCompensationRefundNotice, queueCompensationRefundReturnedNotice } from "@/lib/payments/compensation-notices";
import { unreversedRefundAmount } from "@/lib/payments/dispute-reversals";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";
import { getStripe } from "@/lib/stripe";

const expectedCurrency = "aud";
const processingLeaseMs = 10 * 60 * 1000;
const pendingPollMs = 60 * 1000;
const maxAttempts = 5;

type ClaimedRefund = {
  id: string;
  orderId: string;
  token: string;
  attempts: number;
  amount: number;
  currency: string;
  stripeSessionId: string;
  organisationId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  stripeAccountId: string;
};

export class CompensationRefundVerificationError extends Error {
  constructor(readonly code: string, message = "Refund details could not be verified for this compensation order") {
    super(message);
    this.name = "CompensationRefundVerificationError";
  }
}

// PAY-026: a compensation refund that stopped for a person (runbook in Payment
// Lifecycle Refunds and Disputes). Raised after the state change commits.
export function alertNeedsReview(job: { id: string; orderId: string }, state: CompensationRefundState, reason: string) {
  emitOperationalAlert("compensation_refund_needs_review", {
    compensationRefundJobId: job.id, orderId: job.orderId, state, reason, dedupeKey: `compensation_refund_needs_review:${job.id}:${state}:${reason}`
  });
}

export class CompensationRefundNotFoundError extends Error {
  constructor() {
    super("Compensation refund was not found");
    this.name = "CompensationRefundNotFoundError";
  }
}

export class CompensationRefundConflictError extends Error {
  constructor(message = "Compensation refund is no longer reviewable") {
    super(message);
    this.name = "CompensationRefundConflictError";
  }
}

function paymentIntentId(refund: Stripe.Refund) {
  return typeof refund.payment_intent === "string"
    ? refund.payment_intent
    : refund.payment_intent?.id ?? null;
}

function refundState(refund: Stripe.Refund): CompensationRefundState {
  if (refund.status === "succeeded") return "refunded";
  if (refund.status === "failed" || refund.status === "canceled") {
    return "refund_failed";
  }
  return "refund_pending";
}

async function claimNextRefund(now = new Date()): Promise<ClaimedRefund | null> {
  const staleBefore = new Date(now.getTime() - processingLeaseMs);
  let ineligible = null as { id: string; orderId: string } | null;
  const claimed = await prisma.$transaction(async (tx) => {
    const candidate = await tx.compensationRefundJob.findFirst({
      where: {
        nextAttemptAt: { lte: now },
        OR: [
          { state: "auto_queued" },
          { state: "refund_pending" },
          { state: "auto_processing", processingStartedAt: { lt: staleBefore } }
        ]
      },
      orderBy: [{ nextAttemptAt: "asc" }, { createdAt: "asc" }],
      select: { id: true, orderId: true, state: true, attempts: true }
    });
    if (!candidate || !(await lockOrder(tx, candidate.orderId))) return null;

    const token = randomUUID();
    const claimed = await tx.compensationRefundJob.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { state: "auto_queued" },
          { state: "refund_pending" },
          { state: "auto_processing", processingStartedAt: { lt: staleBefore } }
        ]
      },
      data: {
        state: "auto_processing",
        processingToken: token,
        processingStartedAt: now,
        attempts: { increment: 1 },
        lastErrorCode: null,
        lastErrorAt: null
      }
    });
    if (claimed.count !== 1) return null;

    const job = await tx.compensationRefundJob.findUniqueOrThrow({
      where: { id: candidate.id },
      include: {
        order: {
          include: {
            tickets: { select: { id: true } },
            event: {
              select: {
                organisationId: true,
                organisation: { select: { stripeAccountId: true } }
              }
            }
          }
        }
      }
    });
    const order = job.order;
    // The account the order was paid to (DEBT-002), not whichever the society has now;
    // orders from before seller snapshots fall back to the society's.
    const account = order.sellerStripeAccountId ?? order.event.organisation.stripeAccountId;
    if (
      order.status !== "failed" ||
      !order.requiresCompensationReview ||
      order.isManuallyRefunded ||
      order.refundStatus !== null ||
      // PAY-036: the society kept a won dispute, which a ticket order keeps until staff restore it.
      order.disputeStatus === "open" ||
      order.disputeStatus === "lost" ||
      order.compensationRefundModeSnapshot !== "automatic_full" ||
      order.tickets.length !== 0 ||
      !order.stripeSessionId ||
      !account
    ) {
      await tx.compensationRefundJob.update({
        where: { id: job.id },
        data: {
          state: "review_required",
          processingToken: null,
          processingStartedAt: null,
          lastErrorCode: "local_state_not_eligible",
          lastErrorAt: now
        }
      });
      ineligible = job;
      return null;
    }

    await appendOrderLifecycleEvent(tx, {
      orderId: order.id,
      type: "compensation_refund_started",
      source: "refund_worker",
      fromOrderStatus: order.status,
      toOrderStatus: order.status,
      facts: { compensationReview: true }
    });
    await tx.auditLog.create({
      data: {
        organisationId: order.event.organisationId,
        actorUserId: null,
        action: "order.compensation_refund_started",
        targetType: "Order",
        targetId: order.id,
        metadata: { attempt: job.attempts }
      }
    });
    return {
      id: job.id,
      orderId: order.id,
      token,
      attempts: job.attempts,
      amount: job.amount,
      currency: job.currency,
      stripeSessionId: order.stripeSessionId,
      organisationId: order.event.organisationId,
      eventId: order.eventId,
      ticketTypeId: order.ticketTypeId,
      quantity: order.quantity,
      stripeAccountId: account
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (ineligible) alertNeedsReview(ineligible, "review_required", "local_state_not_eligible");
  return claimed;
}

async function moveToReview(job: ClaimedRefund, code: string) {
  const moved = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, job.orderId))) return false;
    const updated = await tx.compensationRefundJob.updateMany({
      where: { id: job.id, state: "auto_processing", processingToken: job.token },
      data: {
        state: "review_required",
        processingToken: null,
        processingStartedAt: null,
        lastErrorCode: code,
        lastErrorAt: new Date()
      }
    });
    if (updated.count === 1) {
      await tx.auditLog.create({ data: {
        organisationId: job.organisationId,
        actorUserId: null,
        action: "order.compensation_refund_review_required",
        targetType: "Order",
        targetId: job.orderId,
        metadata: { reason: code }
      } });
    }
    return updated.count === 1;
  });
  if (moved) alertNeedsReview(job, "review_required", code);
}

async function scheduleRetry(job: ClaimedRefund, code: string) {
  const exhausted = job.attempts >= maxAttempts;
  const delayMinutes = Math.min(2 ** Math.max(job.attempts - 1, 0), 30);
  const failed = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, job.orderId))) return false;
    const updated = await tx.compensationRefundJob.updateMany({
      where: { id: job.id, state: "auto_processing", processingToken: job.token },
      data: {
        state: exhausted ? "refund_failed" : "auto_queued",
        processingToken: null,
        processingStartedAt: null,
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
        lastErrorCode: code,
        lastErrorAt: new Date()
      }
    });
    if (updated.count === 1 && exhausted) {
      await appendOrderLifecycleEvent(tx, {
        orderId: job.orderId,
        type: "compensation_refund_failed",
        source: "refund_worker",
        reason: code,
        facts: { compensationReview: true }
      });
    }
    return updated.count === 1 && exhausted;
  });
  if (failed) alertNeedsReview(job, "refund_failed", code);
}

async function persistRefund(job: ClaimedRefund, refund: Stripe.Refund) {
  const providerState = refundState(refund);
  const pendingNeedsReview =
    providerState === "refund_pending" && job.attempts >= maxAttempts;
  const state: CompensationRefundState = pendingNeedsReview
    ? "review_required"
    : providerState;
  const now = new Date();
  const applied = await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, job.orderId))) return false;
    const updated = await tx.compensationRefundJob.updateMany({
      where: {
        id: job.id,
        state: "auto_processing",
        processingToken: job.token
      },
      data: {
        state,
        stripeRefundId: refund.id,
        stripePaymentIntentId: paymentIntentId(refund),
        providerStatus: refund.status,
        processingToken: null,
        processingStartedAt: null,
        resolvedAt: state === "refunded" ? now : null,
        nextAttemptAt: providerState === "refund_pending"
          ? new Date(now.getTime() + pendingPollMs)
          : now,
        lastErrorCode: state === "refund_failed"
          ? "provider_refund_failed"
          : pendingNeedsReview
            ? "provider_refund_pending_review"
            : null,
        lastErrorAt: state === "refund_failed" || pendingNeedsReview ? now : null
      }
    });
    if (updated.count !== 1) return false;
    if (state === "refunded") {
      await tx.order.update({
        where: { id: job.orderId },
        data: { requiresCompensationReview: false, isManuallyRefunded: true }
      });
      await queueCompensationRefundNotice(tx, job);
    }
    await appendOrderLifecycleEvent(tx, {
      orderId: job.orderId,
      type: state === "refunded"
        ? "compensation_refunded"
        : state === "refund_failed"
          ? "compensation_refund_failed"
          : "compensation_refund_pending",
      source: "refund_worker",
      reason: state === "refund_failed"
        ? "provider_refund_failed"
        : pendingNeedsReview
          ? "provider_refund_pending_review"
          : null,
      facts: { compensationReview: state !== "refunded" }
    });
    await tx.auditLog.create({ data: {
      organisationId: job.organisationId,
      actorUserId: null,
      action: `order.compensation_${state}`,
      targetType: "Order",
      targetId: job.orderId,
      metadata: { refundId: refund.id, providerStatus: refund.status }
    } });
    return true;
  });
  if (applied && (state === "refund_failed" || state === "review_required")) {
    alertNeedsReview(job, state, state === "refund_failed" ? "provider_refund_failed" : "provider_refund_pending_review");
  }
  return state;
}

async function recordVerifiedPaymentIntent(job: ClaimedRefund, paymentIntentId: string) {
  const updated = await prisma.compensationRefundJob.updateMany({
    where: {
      id: job.id,
      state: "auto_processing",
      processingToken: job.token
    },
    data: { stripePaymentIntentId: paymentIntentId }
  });
  if (updated.count !== 1) {
    throw new CompensationRefundConflictError(
      "Compensation refund claim changed before the provider request"
    );
  }
}

async function retrieveEligiblePayment(job: ClaimedRefund) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(job.stripeSessionId, {
    expand: ["payment_intent", "payment_intent.latest_charge"]
  });
  const intent = typeof session.payment_intent === "object"
    ? session.payment_intent
    : null;
  const destination = intent?.transfer_data?.destination;
  const latestCharge = intent && typeof intent.latest_charge === "object"
    ? intent.latest_charge
    : null;
  if (
    session.payment_status !== "paid" ||
    session.amount_total !== job.amount ||
    session.currency?.toLowerCase() !== expectedCurrency ||
    session.metadata?.orderId !== job.orderId ||
    session.metadata?.eventId !== job.eventId ||
    session.metadata?.organisationId !== job.organisationId ||
    session.metadata?.ticketTypeId !== job.ticketTypeId ||
    session.metadata?.quantity !== String(job.quantity) ||
    !intent ||
    intent.amount_received !== job.amount ||
    intent.currency.toLowerCase() !== expectedCurrency ||
    intent.metadata.orderId !== job.orderId ||
    destination !== job.stripeAccountId ||
    // Not `disputed`, which stays true after a dispute closes; the claim already refuses an open or lost one.
    !latestCharge
  ) {
    throw new CompensationRefundVerificationError("provider_identity_not_eligible");
  }
  const refunds = await stripe.refunds.list({ payment_intent: intent.id, limit: 100 });
  const owned = refunds.data.find((refund) =>
    refund.metadata?.compensationRefundJobId === job.id &&
    refund.metadata?.orderId === job.orderId &&
    refund.amount === job.amount &&
    refund.currency.toLowerCase() === job.currency &&
    paymentIntentId(refund) === intent.id
  );
  if (owned) return { stripe, intent, existing: owned };
  if (refunds.data.length > 0) {
    throw new CompensationRefundVerificationError("existing_refund_requires_review");
  }
  return { stripe, intent, existing: null };
}

export async function processCompensationRefund(job: ClaimedRefund) {
  try {
    const { stripe, intent, existing } = await retrieveEligiblePayment(job);
    // Persist the verified provider identity before creating the refund so an
    // immediately delivered webhook can be correlated without trusting metadata alone.
    await recordVerifiedPaymentIntent(job, intent.id);
    const refund = existing ?? await stripe.refunds.create({
      payment_intent: intent.id,
      amount: job.amount,
      reverse_transfer: true,
      refund_application_fee: true,
      metadata: {
        compensationRefundJobId: job.id,
        orderId: job.orderId
      }
    }, { idempotencyKey: `compensation-refund:${job.orderId}` });
    const state = await persistRefund(job, refund);
    return { jobId: job.id, state };
  } catch (error) {
    if (error instanceof CompensationRefundVerificationError) {
      await moveToReview(job, error.code);
      return { jobId: job.id, state: "review_required" as const };
    }
    logError("compensation_refund.worker_attempt_failed", {
      orderId: job.orderId,
      attempt: job.attempts,
      error
    });
    await scheduleRetry(job, "provider_request_failed");
    return {
      jobId: job.id,
      state: job.attempts >= maxAttempts ? "refund_failed" as const : "auto_queued" as const
    };
  }
}

// PAY-056: the last dispute holding this order's refund went the society's way, so
// Stripe takes it now. A job the claim stopped (a code only automatic jobs get) goes
// back to the worker, which checks the order and payment again. Any other stopped job
// is a person's: it is returned for the caller to alert once this commits, as nothing
// has told them it can be refunded, and disputes run for weeks.
export async function resumeCompensationRefund(tx: Prisma.TransactionClient, order: { id: string; organisationId: string }, stripeEventId: string) {
  const job = await tx.compensationRefundJob.findUnique({ where: { orderId: order.id }, select: { id: true, orderId: true, state: true, lastErrorCode: true } });
  if (job?.state !== "review_required") return null;
  if (job.lastErrorCode !== "local_state_not_eligible") return job;
  await tx.compensationRefundJob.update({ where: { id: job.id }, data: { state: "auto_queued", attempts: 0, lastErrorCode: null, lastErrorAt: null } });
  await appendOrderLifecycleEvent(tx, { orderId: order.id, type: "compensation_refund_queued", source: "stripe_webhook", stripeEventId, reason: "dispute_won", facts: { compensationReview: true } });
  await tx.auditLog.create({ data: {
    organisationId: order.organisationId, actorUserId: null, action: "order.compensation_refund_queued", targetType: "Order", targetId: order.id, metadata: { reason: "dispute_won" }
  } });
  return null;
}

export async function processCompensationRefundBatch(limit = 25) {
  const boundedLimit = Math.max(1, Math.min(limit, 100));
  const results = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const claimed = await claimNextRefund();
    if (!claimed) break;
    results.push(await processCompensationRefund(claimed));
  }
  logInfo("compensation_refund.batch.completed", { processed: results.length });
  return { processed: results.length, results };
}

export async function reconcileRefundEvent(event: Stripe.Event) {
  const refund = event.data.object as Stripe.Refund;
  const eventCreatedAt = new Date(event.created * 1000);
  let review = null as { job: { id: string; orderId: string }; state: CompensationRefundState; reason: string } | null;
  await prisma.$transaction(async (tx) => {
    if (await tx.stripeRefundWebhookEvent.findUnique({ where: { stripeEventId: event.id } })) {
      return;
    }
    const refundJobId = refund.metadata?.compensationRefundJobId;
    const refundOrderId = refund.metadata?.orderId;
    if (!refundJobId || !refundOrderId) return;

    const candidate = await tx.compensationRefundJob.findUnique({
      where: { id: refundJobId },
      select: { orderId: true }
    });
    if (!candidate || candidate.orderId !== refundOrderId) return;
    if (!(await lockOrder(tx, candidate.orderId))) return;

    // Re-read after the order lock. A worker or earlier webhook may have
    // completed while this delivery was waiting for the lock.
    const job = await tx.compensationRefundJob.findUnique({
      where: { id: refundJobId },
      include: { order: { include: { event: { select: { organisationId: true } } } } }
    });
    const refundPaymentIntentId = paymentIntentId(refund);
    if (
      !job ||
      job.orderId !== refundOrderId ||
      refund.amount !== job.amount ||
      refund.currency.toLowerCase() !== job.currency ||
      !refundPaymentIntentId ||
      refundPaymentIntentId !== job.stripePaymentIntentId
    ) {
      logWarn("compensation_refund.webhook_identity_rejected", {
        stripeEventId: event.id,
        refundId: refund.id,
        reason: "refund_identity_mismatch"
      });
      return;
    }
    await tx.stripeRefundWebhookEvent.create({
      data: {
        stripeEventId: event.id,
        refundJobId: job.id,
        eventType: event.type,
        eventCreatedAt
      }
    });
    // PAY-025: the refund came back from the bank after succeeding. Stripe returns
    // the money to Thunderstrux's balance; the job stays refunded and a person
    // repays the buyer another way.
    if (job.state === "refunded" && refundState(refund) === "refund_failed" && job.stripeRefundId === refund.id) {
      if (job.lastErrorCode === "provider_refund_returned") return;
      await tx.compensationRefundJob.update({
        where: { id: job.id },
        data: { providerStatus: refund.status, lastProviderEventAt: eventCreatedAt, lastErrorCode: "provider_refund_returned", lastErrorAt: new Date() }
      });
      await appendOrderLifecycleEvent(tx, {
        orderId: job.orderId, type: "compensation_refund_failed", source: "stripe_webhook", stripeEventId: event.id, reason: "returned_by_bank"
      });
      await queueCompensationRefundReturnedNotice(tx, job);
      review = { job, state: "refunded", reason: "returned_by_bank" };
      return;
    }
    if (
      job.state === "recovered" ||
      job.state === "refunded" ||
      job.state === "refund_failed" ||
      (job.lastProviderEventAt && job.lastProviderEventAt > eventCreatedAt) ||
      (job.lastProviderEventAt?.getTime() === eventCreatedAt.getTime() &&
        refundState(refund) === "refund_pending")
    ) return;

    const state = refundState(refund);
    const updated = await tx.compensationRefundJob.updateMany({
      where: {
        id: job.id,
        state: { notIn: ["recovered", "refunded", "refund_failed"] }
      },
      data: {
        state,
        stripeRefundId: refund.id,
        stripePaymentIntentId: paymentIntentId(refund),
        providerStatus: refund.status,
        lastProviderEventAt: eventCreatedAt,
        processingToken: null,
        processingStartedAt: null,
        resolvedAt: state === "refunded" ? new Date() : null,
        lastErrorCode: state === "refund_failed" ? "provider_refund_failed" : null,
        lastErrorAt: state === "refund_failed" ? new Date() : null
      }
    });
    if (updated.count !== 1) return;
    if (state === "refunded") {
      await tx.order.update({
        where: { id: job.orderId },
        data: { requiresCompensationReview: false, isManuallyRefunded: true }
      });
      await queueCompensationRefundNotice(tx, job);
    }
    await appendOrderLifecycleEvent(tx, {
      orderId: job.orderId,
      type: state === "refunded"
        ? "compensation_refunded"
        : state === "refund_failed"
          ? "compensation_refund_failed"
          : "compensation_refund_pending",
      source: "stripe_webhook",
      stripeEventId: event.id,
      reason: state === "refund_failed" ? "provider_refund_failed" : null,
      facts: { compensationReview: state !== "refunded" }
    });
    await tx.auditLog.create({ data: {
      organisationId: job.order.event.organisationId,
      actorUserId: null,
      action: `order.compensation_${state}`,
      targetType: "Order",
      targetId: job.orderId,
      metadata: { refundId: refund.id, providerStatus: refund.status }
    } });
    if (state === "refund_failed") review = { job, state, reason: "provider_refund_failed" };
  });
  if (review) alertNeedsReview(review.job, review.state, review.reason);
}

export async function confirmCompensationRefund(
  organisationId: string,
  orderId: string,
  refundId: string,
  actorUserId: string
) {
  const existing = await prisma.compensationRefundJob.findFirst({
    where: { orderId, order: { event: { is: { organisationId } } } },
    include: {
      order: {
        include: {
          event: {
            include: { organisation: { select: { stripeAccountId: true } } }
          }
        }
      }
    }
  });
  if (!existing || !existing.order.stripeSessionId) {
    throw new CompensationRefundNotFoundError();
  }
  const stripe = getStripe();
  const [refund, session] = await Promise.all([
    stripe.refunds.retrieve(refundId),
    stripe.checkout.sessions.retrieve(existing.order.stripeSessionId, {
      expand: ["payment_intent", "payment_intent.latest_charge"]
    })
  ]);
  const expectedPaymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  const paymentIntent = typeof session.payment_intent === "object"
    ? session.payment_intent
    : null;
  const destination = paymentIntent?.transfer_data?.destination;
  const latestCharge = paymentIntent && typeof paymentIntent.latest_charge === "object"
    ? paymentIntent.latest_charge
    : null;
  if (
    refund.status !== "succeeded" ||
    refund.amount !== existing.amount ||
    refund.currency.toLowerCase() !== existing.currency ||
    !expectedPaymentIntentId ||
    paymentIntentId(refund) !== expectedPaymentIntentId ||
    session.payment_status !== "paid" ||
    session.metadata?.orderId !== orderId ||
    session.amount_total !== existing.amount ||
    session.currency?.toLowerCase() !== existing.currency ||
    destination !== (existing.order.sellerStripeAccountId ?? existing.order.event.organisation.stripeAccountId) ||
    !latestCharge ||
    (refund.metadata?.orderId !== undefined && refund.metadata.orderId !== orderId)
  ) throw new CompensationRefundVerificationError("manual_refund_verification_failed");
  // PAY-027: a Dashboard refund is only settled once the society's transfer and
  // Thunderstrux's fee came back with it, as they do with the refunds Thunderstrux sends.
  const fee = latestCharge.application_fee
    ? typeof latestCharge.application_fee === "string" ? await stripe.applicationFees.retrieve(latestCharge.application_fee) : latestCharge.application_fee
    : null;
  if ((await unreversedRefundAmount(stripe, latestCharge)) > 0 || (fee && fee.amount_refunded < fee.amount)) {
    throw new CompensationRefundVerificationError(
      "manual_refund_not_reversed",
      "Stripe shows the refund, but the society's transfer wasn't reversed or the Thunderstrux fee wasn't refunded. Reverse the transfer and refund the application fee in Stripe, then confirm again."
    );
  }

  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) throw new CompensationRefundNotFoundError();
    const updated = await tx.compensationRefundJob.updateMany({
      where: {
        id: existing.id,
        state: { in: ["review_required", "refund_pending", "refund_failed"] }
      },
      data: {
        state: "refunded",
        stripeRefundId: refund.id,
        stripePaymentIntentId: paymentIntentId(refund),
        providerStatus: refund.status,
        resolvedAt: new Date(),
        processingToken: null,
        processingStartedAt: null
      }
    });
    if (updated.count !== 1) throw new CompensationRefundConflictError();
    await tx.order.update({
      where: { id: orderId },
      data: { requiresCompensationReview: false, isManuallyRefunded: true }
    });
    await queueCompensationRefundNotice(tx, existing);
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "compensation_refunded",
      source: "staff_action",
      actorUserId,
      facts: { compensationReview: false }
    });
    await tx.auditLog.create({ data: {
      organisationId,
      actorUserId,
      action: "order.compensation_refund_confirmed",
      targetType: "Order",
      targetId: orderId,
      metadata: { refundId: refund.id }
    } });
  });
}
