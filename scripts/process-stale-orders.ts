import { prisma } from "@/lib/db";
import { logError, logInfo } from "@/lib/ops/logger";
import {
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";

async function main() {
  const options = parseStaleOrderCleanupCliOptions(process.argv.slice(2));
  const result = await processStaleOrderCleanupBatch(options);

  logInfo("stale_orders.worker.completed", result);
}

main()
  .catch((error) => {
    logError("stale_orders.worker.failed", { error });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
