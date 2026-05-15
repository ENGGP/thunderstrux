import { prisma } from "@/lib/db";
import {
  parseStaleOrderCleanupCliOptions,
  processStaleOrderCleanupBatch
} from "@/lib/orders/stale-orders";

async function main() {
  const options = parseStaleOrderCleanupCliOptions(process.argv.slice(2));
  const result = await processStaleOrderCleanupBatch(options);

  console.log("staleOrders:", result);
}

main()
  .catch((error) => {
    console.error("Stale order cleanup batch failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
