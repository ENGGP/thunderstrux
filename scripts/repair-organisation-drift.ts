import { prisma } from "@/lib/db";
import { repairOrganisationDrift } from "@/lib/db/organisation-drift";

async function main() {
  const apply = process.argv.includes("--apply");
  const result = await repairOrganisationDrift({ apply });
  for (const row of result) {
    console.log(`${row.table}: ${row.found} mismatched rows; repaired ${row.repaired}`);
  }
  if (!apply) console.log("Dry run only. After a verified backup, pass --apply to repair.");
}

main()
  .catch((error) => {
    console.error("Organisation drift repair failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
