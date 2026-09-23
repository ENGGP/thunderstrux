import { prisma } from "@/lib/db";
import { checkRateLimitReadiness } from "@/lib/security/rate-limit";
import { assertStaffMfaConfiguration } from "@/lib/security/staff-mfa";

const READINESS_TIMEOUT_MS = 2_000;

export async function checkDatabaseReadiness() {
  await prisma.$transaction(
    async (transaction) => {
      await transaction.$executeRawUnsafe(
        `SET LOCAL statement_timeout = '${READINESS_TIMEOUT_MS - 250}ms'`
      );
      await transaction.$queryRawUnsafe(`SELECT 1 FROM "User" LIMIT 1`);
    },
    {
      maxWait: READINESS_TIMEOUT_MS,
      timeout: READINESS_TIMEOUT_MS
    }
  );
}

export async function checkApplicationReadiness() {
  assertStaffMfaConfiguration();
  await Promise.all([checkDatabaseReadiness(), checkRateLimitReadiness()]);
}
