import { prisma } from "@/lib/db";
import { runDatabaseIntegrityAudit } from "@/lib/ops/integrity-audit";

async function main() {
  const results = await runDatabaseIntegrityAudit();
  const totalViolations = results.reduce((total, result) => total + result.count, 0);
  // Explained legacy rows are reported but don't fail the audit (T41).
  const unexplained = results.reduce((total, result) => total + (result.legacy ? 0 : result.count), 0);

  console.log("Thunderstrux database integrity audit");
  console.log(`checks=${results.length} totalViolations=${totalViolations} unexplained=${unexplained}`);

  for (const result of results) {
    console.log("");
    console.log(`check=${result.name}`);
    console.log(`class=${result.classification}`);
    console.log(`violations=${result.count}`);
    console.log(`sampleIds=${result.sampleIds.length > 0 ? result.sampleIds.join(",") : "none"}`);
    console.log(`recommendation=${result.recommendation}`);
    if (result.legacy && result.count > 0) console.log(`legacy=${result.legacy}`);
  }

  if (unexplained > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Database integrity audit failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
