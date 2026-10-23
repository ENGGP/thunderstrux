import { runWorker } from "@/lib/ops/worker";
import { deleteExpiredMfaGrants } from "@/lib/security/staff-mfa";
import { expireStaleCommerceOrders } from "@/lib/commerce/reconciliation";
import {
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";

async function main() {
  const options = parseStaleOrderCleanupCliOptions(process.argv.slice(2));
  const result = await processStaleOrderCleanupBatch(options);
  const expiredMfaGrantsDeleted = await deleteExpiredMfaGrants(new Date(), 500, options.dryRun);
  // Membership and merchandise orders whose Stripe Session has expired (T21).
  const commerce = options.dryRun ? { expired: 0, considered: 0 } : await expireStaleCommerceOrders();

  return { ...result, expiredMfaGrantsDeleted, commerceOrdersExpired: commerce.expired };
}

// T42: one run at a time, pausable, with a timeout and an alert on failure.
void runWorker("stale-orders", main);
