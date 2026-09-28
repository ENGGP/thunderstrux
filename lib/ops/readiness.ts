import { prisma } from "@/lib/db";
import { checkRateLimitReadiness } from "@/lib/security/rate-limit";
import { assertStaffMfaConfiguration } from "@/lib/security/staff-mfa";
import schemaContract from "@/config/schema-contract.json";
import { legacyOrganisationAccessMode } from "@/lib/auth/access";

const READINESS_TIMEOUT_MS = 2_000;

export async function checkDatabaseReadiness() {
  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${READINESS_TIMEOUT_MS - 250}ms'`
      );
      await transaction.$queryRawUnsafe(`SELECT 1 FROM "User" LIMIT 1`);
      const migrations = await transaction.$queryRaw<Array<{ migration_name: string }>>`
        SELECT migration_name
        FROM "_prisma_migrations"
        WHERE migration_name = ${schemaContract.requiredMigration}
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL
        LIMIT 1
      `;
      if (migrations.length !== 1) {
        throw new Error("Required application schema migration is not applied");
      }
    },
    {
      maxWait: READINESS_TIMEOUT_MS,
      timeout: READINESS_TIMEOUT_MS
    }
  );
}

export async function checkApplicationReadiness() {
  legacyOrganisationAccessMode();
  assertStaffMfaConfiguration();
  await Promise.all([checkDatabaseReadiness(), checkRateLimitReadiness()]);
}
