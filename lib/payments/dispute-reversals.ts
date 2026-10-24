import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import { lockCommerceOrderForFamily } from "@/lib/commerce/binding";
import { appendCommerceLifecycleEvent } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo, logWarn } from "@/lib/ops/logger";
import { isDefiniteProviderFailure } from "@/lib/payments/checkout-attempts";
import { appendOrderLifecycleEvent, lockOrder } from "@/lib/payments/order-lifecycle";
import { getStripe } from "@/lib/stripe";

// PAY-004: on destination charges Stripe takes a lost dispute's amount and fee
// from the platform. Founder decision (2026-10-24, as Eventbrite does): the
// society bears the lost sale, so the transfer to it is reversed by the disputed
// amount; Thunderstrux keeps its fee and pays Stripe's dispute fee. Stripe's
// guidance is to reverse only once a dispute is lost.
//
// The reversal is queued on the dispute in the same transaction that records the
// loss, and sent by the refunds worker outside any transaction with a stable
// idempotency key. An unknown outcome looks for the dispute's reversal at Stripe
// before the key is sent again.

const leaseMs = 10 * 60 * 1000;
const pollMs = 60 * 1000;
const maxAttempts = 6;

const idOf = (value: string | { id: string } | null | undefined) => (typeof value === "string" ? value : value?.id ?? null);
const reversalKey = (stripeDisputeId: string) => `dispute-reversal:${stripeDisputeId}`;

// Called with the purchase locked, when Stripe has just closed the dispute as lost.
export async function queueDisputeReversal(tx: Prisma.TransactionClient, stripeDisputeId: string, now: Date) {
  await tx.purchaseDispute.updateMany({
    where: { stripeDisputeId, reversalStatus: null },
    data: { reversalStatus: "pending", reversalNextAttemptAt: now }
  });
}

type ReversalOutcome = "succeeded" | "failed" | "uncertain";

async function release(id: string, token: string, data: Prisma.PurchaseDisputeUpdateManyMutationInput) {
  await prisma.purchaseDispute.updateMany({ where: { id, reversalProcessingToken: token }, data: { reversalProcessingToken: null, reversalProcessingStartedAt: null, ...data } });
}

// Nothing will make this reversal possible: a person decides in Stripe's Dashboard.
async function fail(dispute: { id: string; stripeDisputeId: string; orderId: string | null; commerceOrderId: string | null }, token: string, reason: string): Promise<ReversalOutcome> {
  await release(dispute.id, token, { reversalStatus: "failed", reversalNextAttemptAt: null, reversalLastError: reason });
  logWarn("dispute_reversal.failed", { disputeId: dispute.stripeDisputeId, reason });
  emitOperationalAlert("dispute_reversal_unresolved", { disputeId: dispute.stripeDisputeId, orderId: dispute.orderId, commerceOrderId: dispute.commerceOrderId, reason });
  return "failed";
}

async function sendReversal(id: string, token: string, now: Date): Promise<ReversalOutcome> {
  const dispute = await prisma.purchaseDispute.findUniqueOrThrow({
    where: { id },
    select: {
      id: true, stripeDisputeId: true, stripeChargeId: true, amount: true, currency: true, orderId: true, commerceOrderId: true, reversalAttempts: true,
      order: { select: { sellerStripeAccountId: true } },
      commerceOrder: { select: { sellerStripeAccountId: true } }
    }
  });
  const seller = dispute.order?.sellerStripeAccountId ?? dispute.commerceOrder?.sellerStripeAccountId ?? null;
  const stripe = getStripe();
  let transfer: Stripe.Transfer;
  try {
    const charge = await stripe.charges.retrieve(dispute.stripeChargeId);
    const transferId = idOf(charge.transfer);
    if (!transferId) return fail(dispute, token, "no_transfer");
    transfer = await stripe.transfers.retrieve(transferId);
  } catch (error) {
    return retry(dispute, token, now, error);
  }
  // The money must go back from the account the order was sold to.
  if (!seller || idOf(transfer.destination) !== seller || transfer.currency !== dispute.currency) return fail(dispute, token, "destination_mismatch");

  let reversal: Stripe.TransferReversal | undefined;
  try {
    reversal = (await stripe.transfers.listReversals(transfer.id, { limit: 100 })).data.find((item) => item.metadata?.disputeId === dispute.stripeDisputeId);
    if (!reversal) {
      // A refund may already have reversed part of the transfer.
      const amount = Math.min(dispute.amount, transfer.amount - transfer.amount_reversed);
      if (amount <= 0) return fail(dispute, token, "nothing_to_reverse");
      const metadata: Record<string, string> = dispute.orderId
        ? { disputeId: dispute.stripeDisputeId, orderId: dispute.orderId }
        : { disputeId: dispute.stripeDisputeId, commerceOrderId: dispute.commerceOrderId as string };
      reversal = await stripe.transfers.createReversal(transfer.id, { amount, metadata }, { idempotencyKey: reversalKey(dispute.stripeDisputeId) });
    }
  } catch (error) {
    if (isDefiniteProviderFailure(error)) return fail(dispute, token, "provider_refused");
    return retry(dispute, token, now, error);
  }
  await record(dispute, token, reversal, now);
  return "succeeded";
}

async function retry(dispute: { id: string; stripeDisputeId: string; reversalAttempts: number }, token: string, now: Date, error: unknown): Promise<ReversalOutcome> {
  const delay = Math.min(30 * pollMs, pollMs * 2 ** Math.max(0, dispute.reversalAttempts - 1));
  await release(dispute.id, token, { reversalStatus: "uncertain", reversalNextAttemptAt: new Date(now.getTime() + delay), reversalLastError: "provider_unknown" });
  logWarn("dispute_reversal.uncertain", { disputeId: dispute.stripeDisputeId, error });
  return "uncertain";
}

async function record(
  dispute: { id: string; stripeDisputeId: string; orderId: string | null; commerceOrderId: string | null },
  token: string,
  reversal: Stripe.TransferReversal,
  now: Date
) {
  await prisma.$transaction(async (tx) => {
    const locked = dispute.orderId ? await lockOrder(tx, dispute.orderId) : await lockCommerceOrderForFamily(tx, dispute.commerceOrderId as string);
    if (!locked) return;
    const updated = await tx.purchaseDispute.updateMany({
      where: { id: dispute.id, reversalProcessingToken: token },
      data: {
        reversalStatus: "succeeded", reversalAmount: reversal.amount, stripeTransferReversalId: reversal.id, reversalNextAttemptAt: null,
        reversalProcessingToken: null, reversalProcessingStartedAt: null, reversalLastError: null
      }
    });
    if (updated.count !== 1) return;
    const facts = { amount: reversal.amount, transferReversalId: reversal.id };
    const { organisationId } = await tx.purchaseDispute.findUniqueOrThrow({ where: { id: dispute.id }, select: { organisationId: true } });
    if (dispute.orderId) {
      await appendOrderLifecycleEvent(tx, { orderId: dispute.orderId, type: "dispute_funds_recovered", source: "refund_worker", reason: dispute.stripeDisputeId, facts });
    } else {
      await appendCommerceLifecycleEvent(tx, { commerceOrderId: dispute.commerceOrderId as string, type: "dispute_funds_recovered", source: "refund_worker", reason: dispute.stripeDisputeId, facts });
    }
    await tx.auditLog.create({ data: {
      organisationId, actorUserId: null,
      action: dispute.orderId ? "order.dispute_funds_recovered" : "commerce_order.dispute_funds_recovered",
      targetType: dispute.orderId ? "Order" : "CommerceOrder", targetId: (dispute.orderId ?? dispute.commerceOrderId) as string,
      metadata: { disputeId: dispute.stripeDisputeId, amount: reversal.amount, transferReversalId: reversal.id, at: now.toISOString() }
    } });
  });
  logInfo("dispute_reversal.succeeded", { disputeId: dispute.stripeDisputeId, amount: reversal.amount });
}

// Worker: queued and uncertain reversals, and leases left by a crashed run.
export async function processDisputeReversalBatch(limit = 25, now = new Date()) {
  const stale = new Date(now.getTime() - leaseMs);
  const claimable = { reversalStatus: { in: ["pending", "uncertain"] }, OR: [{ reversalProcessingToken: null }, { reversalProcessingStartedAt: { lt: stale } }] } satisfies Prisma.PurchaseDisputeWhereInput;
  const due = await prisma.purchaseDispute.findMany({
    where: { ...claimable, reversalNextAttemptAt: { lte: now } },
    orderBy: { reversalNextAttemptAt: "asc" },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, stripeDisputeId: true, orderId: true, commerceOrderId: true, reversalAttempts: true }
  });
  const results: Array<{ disputeId: string; status: ReversalOutcome | "unresolved" }> = [];
  for (const candidate of due) {
    const token = randomUUID();
    const claimed = await prisma.purchaseDispute.updateMany({
      where: { id: candidate.id, ...claimable },
      data: { reversalProcessingToken: token, reversalProcessingStartedAt: now, reversalAttempts: { increment: 1 } }
    });
    if (claimed.count !== 1) continue;
    if (candidate.reversalAttempts >= maxAttempts) {
      // Still unknown after repeated tries: a person looks at it; the worker keeps checking hourly.
      await release(candidate.id, token, { reversalNextAttemptAt: new Date(now.getTime() + 60 * pollMs), reversalLastError: "provider_unresolved" });
      emitOperationalAlert("dispute_reversal_unresolved", { disputeId: candidate.stripeDisputeId, orderId: candidate.orderId, commerceOrderId: candidate.commerceOrderId, reason: "provider_unresolved" });
      results.push({ disputeId: candidate.stripeDisputeId, status: "unresolved" });
      continue;
    }
    results.push({ disputeId: candidate.stripeDisputeId, status: await sendReversal(candidate.id, token, now) });
  }
  logInfo("dispute_reversal.batch.completed", { processed: results.length });
  return { processed: results.length, results };
}
