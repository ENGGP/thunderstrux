import { runWorker } from "@/lib/ops/worker";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { deleteExpiredMfaGrants } from "@/lib/security/staff-mfa";
import { sweepPendingCheckouts } from "@/lib/payments/checkout-settlement";
import {
  expireStaleCommerceOrders,
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";

async function main() {
  const options = parseStaleOrderCleanupCliOptions(process.argv.slice(2));
  // PAY-046: holds that ended close first, because the sweep can take 45 s and an open
  // Stripe page past its grace is a buyer charged, then refunded. Nothing expires
  // unasked: each expiry checks with Stripe itself (mayExpireAfterStripeCheck, PAY-024).
  const result = await processStaleOrderCleanupBatch(options);
  const expiredMfaGrantsDeleted = await deleteExpiredMfaGrants(new Date(), 500, options.dryRun);
  // Membership and merchandise orders whose Stripe Session has expired (T21).
  const commerce = options.dryRun ? { expired: 0, considered: 0, stripeDeferred: 0 } : await expireStaleCommerceOrders();
  const stripeDeferred = result.stripeDeferred + commerce.stripeDeferred;
  if (stripeDeferred > 0) emitOperationalAlert("checkout_reconciliation_unavailable", { stage: "before_expiry", stripeDeferred });
  // PAY-024: then the early check, for pending checkouts Stripe already completed.
  const sweep = options.dryRun ? null : await sweepPendingCheckouts();

  return { ...result, expiredMfaGrantsDeleted, commerceOrdersExpired: commerce.expired, stripeDeferred, sweep };
}

// T42: one run at a time, pausable, with a timeout and an alert on failure.
void runWorker("stale-orders", main);
