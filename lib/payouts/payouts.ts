import type { SocietyPayoutStatus } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo, logWarn } from "@/lib/ops/logger";
import { heldMoney, type HeldMoney } from "@/lib/payouts/release";
import { getStripe } from "@/lib/stripe";

// PAY-005: connected accounts are on manual payouts, so money stays in the
// society's Stripe balance until this worker sends what the release rules no
// longer hold. A payout can never exceed the available balance, so a repeated
// or retried run can't overpay; the daily key makes a retry the same payout.

const checkEveryMs = 60 * 60 * 1000;
// Below this a payout waits for more money.
export const minPayout = 100;

// Manual payouts keep the money in Stripe until we send it; a negative balance
// (a refund after a payout) is taken from the society's bank, not left to us.
export const manualPayoutSettings = { payouts: { schedule: { interval: "manual" as const }, debit_negative_balances: true } };

async function ensureManualPayouts(stripe: Stripe, accountId: string) {
  const account = await stripe.accounts.retrieve(accountId);
  if (account.settings?.payouts?.schedule?.interval === "manual" && account.settings.payouts.debit_negative_balances) return;
  await stripe.accounts.update(accountId, { settings: manualPayoutSettings });
  logInfo("payouts.switched_to_manual", { stripeAccountId: accountId });
}

// While a society's money is held, its account stays on manual payouts. Also
// proves the account is still within this platform's reach.
export async function keepStripePayoutsManual(accountId: string) {
  await ensureManualPayouts(getStripe(), accountId);
}

// On disconnect: Stripe pays out what's left on its usual schedule, so no money
// waits for a worker that no longer looks at this account.
export async function restoreStripePayoutSchedule(accountId: string) {
  await getStripe().accounts.update(accountId, { settings: { payouts: { schedule: { interval: "daily" } } } });
  logInfo("payouts.switched_to_stripe_schedule", { stripeAccountId: accountId });
}

const statusOf = (payout: Stripe.Payout): SocietyPayoutStatus =>
  payout.status === "paid" ? "paid" : payout.status === "failed" || payout.status === "canceled" ? "failed" : "pending";

// `sentAt`: the worker's clock for a payout it sent, so the stored day is the key's day.
async function record(organisationId: string, accountId: string, payout: Stripe.Payout, sentAt?: Date) {
  const fields = {
    status: statusOf(payout),
    failureMessage: payout.failure_message ?? null,
    arrivalDate: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null
  };
  return prisma.societyPayout.upsert({
    where: { stripePayoutId: payout.id },
    create: { organisationId, stripeAccountId: accountId, stripePayoutId: payout.id, amount: payout.amount, currency: payout.currency, ...fields, ...(sentAt ? { createdAt: sentAt } : {}) },
    update: fields
  });
}

// One society: what Stripe has available, less what the rules still hold. At
// most one payout a UTC day (the key's day), like Eventbrite's batched payouts:
// a second call that day would reuse the key with another amount, which Stripe
// refuses (DEF-034). Money released later in the day goes out the next day.
async function payOut(stripe: Stripe, organisation: { id: string; stripeAccountId: string }, now: Date) {
  await ensureManualPayouts(stripe, organisation.stripeAccountId);
  const day = now.toISOString().slice(0, 10);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const paidToday = await prisma.societyPayout.findFirst({
    where: { stripeAccountId: organisation.stripeAccountId, createdAt: { gte: dayStart, lt: new Date(dayStart.getTime() + 86_400_000) } },
    select: { id: true }
  });
  if (paidToday) return { sent: 0 };
  const balance = await stripe.balance.retrieve({}, { stripeAccount: organisation.stripeAccountId });
  const available = balance.available.find((entry) => entry.currency === "aud")?.amount ?? 0;
  const held = await heldMoney(organisation.id, organisation.stripeAccountId, now);
  const amount = available - held.total;
  if (amount < minPayout) return { sent: 0 };
  const payout = await stripe.payouts.create(
    { amount, currency: "aud", metadata: { organisationId: organisation.id } },
    { stripeAccount: organisation.stripeAccountId, idempotencyKey: `payout:${organisation.stripeAccountId}:${day}` }
  );
  await record(organisation.id, organisation.stripeAccountId, payout, now);
  logInfo("payouts.sent", { organisationId: organisation.id, amount, available, held: held.total });
  return { sent: amount };
}

// Worker: each society that can be paid, at most once an hour.
export async function processPayoutBatch(limit = 25, now = new Date()) {
  const due = await prisma.organisation.findMany({
    where: { stripeAccountId: { not: null }, stripeAccountStatus: "READY", stripePayoutsEnabled: true, OR: [{ payoutCheckedAt: null }, { payoutCheckedAt: { lt: new Date(now.getTime() - checkEveryMs) } }] },
    orderBy: [{ payoutCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true, stripeAccountId: true, payoutCheckedAt: true }
  });
  if (due.length === 0) return { processed: 0, results: [] };
  const stripe = getStripe();
  const results: Array<{ organisationId: string; sent: number; error?: true }> = [];
  for (const organisation of due) {
    // The check time is the claim: a second worker skips a society already taken.
    const claimed = await prisma.organisation.updateMany({ where: { id: organisation.id, payoutCheckedAt: organisation.payoutCheckedAt }, data: { payoutCheckedAt: now } });
    if (claimed.count !== 1) continue;
    try {
      results.push({ organisationId: organisation.id, ...(await payOut(stripe, { id: organisation.id, stripeAccountId: organisation.stripeAccountId as string }, now)) });
    } catch (error) {
      // Tried again next hour; a payout Stripe made despite the error comes back through its webhook.
      logError("payouts.failed_to_send", { organisationId: organisation.id, error });
      results.push({ organisationId: organisation.id, sent: 0, error: true });
    }
  }
  logInfo("payouts.batch.completed", { processed: results.length });
  return { processed: results.length, results };
}

// payout.* from a connected account: Stripe's status is the truth. A payout the
// bank refused alerts, and the society sees it on Payments.
export async function reconcilePayoutEvent(event: Stripe.Event) {
  const payout = event.data.object as Stripe.Payout;
  const accountId = event.account;
  const organisation = accountId ? await prisma.organisation.findFirst({ where: { stripeAccountId: accountId }, select: { id: true } }) : null;
  const known = await prisma.societyPayout.findUnique({ where: { stripePayoutId: payout.id }, select: { organisationId: true, stripeAccountId: true, status: true } });
  const organisationId = known?.organisationId ?? organisation?.id;
  if (!organisationId || !accountId || (known && known.stripeAccountId !== accountId)) {
    logWarn("payouts.webhook.ignored", { stripeEventId: event.id, stripePayoutId: payout.id });
    return;
  }
  // Re-read so a late event can't undo a newer status.
  const current = await getStripe().payouts.retrieve(payout.id, {}, { stripeAccount: accountId });
  const saved = await record(organisationId, accountId, current);
  if (saved.status === "failed" && known?.status !== "failed") {
    emitOperationalAlert("society_payout_failed", { organisationId, stripePayoutId: current.id, amount: current.amount, failureCode: current.failure_code ?? null });
  }
}

export type PayoutSummary = {
  held: HeldMoney;
  onTheWay: { amount: number; sentAt: Date | null };
  recent: Array<{ id: string; amount: number; status: SocietyPayoutStatus; createdAt: Date; arrivalDate: Date | null }>;
  // The latest payout the bank refused, unless a later one went through.
  failed: { amount: number; createdAt: Date } | null;
};

// For the Payments page.
export async function payoutSummary(organisationId: string, stripeAccountId: string, now = new Date()): Promise<PayoutSummary> {
  const [held, recent, pending, lastPaid, lastFailed] = await Promise.all([
    heldMoney(organisationId, stripeAccountId, now),
    prisma.societyPayout.findMany({ where: { organisationId }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true, amount: true, status: true, createdAt: true, arrivalDate: true } }),
    prisma.societyPayout.aggregate({ where: { organisationId, status: "pending" }, _sum: { amount: true }, _max: { createdAt: true } }),
    prisma.societyPayout.findFirst({ where: { organisationId, status: "paid" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.societyPayout.findFirst({ where: { organisationId, status: "failed" }, orderBy: { createdAt: "desc" }, select: { amount: true, createdAt: true } })
  ]);
  return {
    held,
    onTheWay: { amount: pending._sum.amount ?? 0, sentAt: pending._max.createdAt },
    recent,
    failed: lastFailed && (!lastPaid || lastFailed.createdAt > lastPaid.createdAt) ? lastFailed : null
  };
}
