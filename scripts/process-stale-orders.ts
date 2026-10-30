import { runWorker } from "@/lib/ops/worker";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { deleteExpiredMfaGrants } from "@/lib/security/staff-mfa";
import { sweepPendingCheckouts } from "@/lib/payments/checkout-settlement";
import {
  expireStaleCommerceOrders,
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";

type Options = ReturnType<typeof parseStaleOrderCleanupCliOptions>;

async function expireEnded(options: Options) {
  const result = await processStaleOrderCleanupBatch(options);
  const expiredMfaGrantsDeleted = await deleteExpiredMfaGrants(new Date(), 500, options.dryRun);
  // Membership and merchandise orders whose Stripe Session has expired (T21).
  const commerce = options.dryRun ? { expired: 0, considered: 0, stripeDeferred: 0 } : await expireStaleCommerceOrders();
  const stripeDeferred = result.stripeDeferred + commerce.stripeDeferred;
  if (stripeDeferred > 0) emitOperationalAlert("checkout_reconciliation_unavailable", { stage: "before_expiry", stripeDeferred });

  return { ...result, expiredMfaGrantsDeleted, commerceOrdersExpired: commerce.expired, stripeDeferred };
}

async function main() {
  const options = parseStaleOrderCleanupCliOptions(process.argv.slice(2));
  // PAY-046: holds that ended close first, because the sweep can take 45 s and an open
  // Stripe page past its grace is a buyer charged, then refunded. Nothing expires
  // unasked: each expiry checks with Stripe itself (mayExpireAfterStripeCheck, PAY-024).
  const expiry = await expireEnded(options).catch((error: unknown) => ({ failure: error }));
  // PAY-024: then the early check, for pending checkouts Stripe already completed. It runs
  // even if expiry failed, so one bad order can't keep a paid buyer waiting for their tickets.
  const sweep = options.dryRun ? null : await sweepPendingCheckouts();
  if ("failure" in expiry) throw expiry.failure;

  return { ...expiry, sweep };
}

// T42: one run at a time, pausable, with a timeout and an alert on failure.
void runWorker("stale-orders", main);
