import { prisma } from "@/lib/db";
import { logError, logInfo } from "@/lib/ops/logger";
import { deleteExpiredMfaGrants } from "@/lib/security/staff-mfa";
import {
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";

async function main() {
  const options = parseStaleOrderCleanupCliOptions(process.argv.slice(2));
  const result = await processStaleOrderCleanupBatch(options);
  const expiredMfaGrantsDeleted = await deleteExpiredMfaGrants(new Date(), 500, options.dryRun);

  logInfo("stale_orders.worker.completed", { ...result, expiredMfaGrantsDeleted });
}

main()
  .catch((error) => {
    logError("stale_orders.worker.failed", { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
