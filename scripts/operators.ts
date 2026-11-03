import { hostname, userInfo } from "node:os";
import { prisma } from "@/lib/db";
import { flushOperationalAlerts } from "@/lib/ops/alerts";
import { grantPlatformOperator, listPlatformOperators, PlatformOperatorError, revokePlatformOperator } from "@/lib/platform/operators";

// T54: platform operators are granted only here, by someone with database
// access on the host (Q7). The web can only revoke.
//   list
//   grant <email> --role=support|admin --note="why"
//   revoke <email> --reason="why"
const flag = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const [command, email] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  const by = `cli:${userInfo().username}@${hostname()}`;
  if (command === "list") {
    const rows = await listPlatformOperators();
    console.log(JSON.stringify(rows.map((row) => ({
      email: row.user.email, role: row.role, status: row.status, grantedAt: row.grantedAt, grantedBy: row.grantedBy,
      authenticator: Boolean(row.user.mfa?.enabledAt), lastSignInAt: row.user.lastSignInAt, revokedAt: row.revokedAt
    })), null, 2));
    return;
  }
  if (!email) throw new PlatformOperatorError("Usage: operators list | grant <email> --role=support|admin --note=... | revoke <email> --reason=...");
  if (command === "grant") {
    const result = await grantPlatformOperator({ email, role: flag("role") ?? "", note: flag("note"), by });
    if (!result.changed) {
      console.log(`${result.email} is already an active ${result.role} operator. Nothing changed.`);
      return;
    }
    console.log(`✓ ${result.email} is now ${result.role === "admin" ? "an admin" : "a support"} operator. Recorded and alerted.`);
    console.log("  Next:\n  1. pnpm ops:admin -- --project <ops-…> --env-file <file>   (dev: http://127.0.0.1:3080/admin)");
    console.log(`  2. Sign in as ${result.email}\n  3. Set up the authenticator when asked`);
    return;
  }
  if (command === "revoke") {
    await revokePlatformOperator({ email, reason: flag("reason"), by });
    console.log(`✓ ${email} is no longer an operator. Recorded and alerted.`);
    return;
  }
  throw new PlatformOperatorError("Use list, grant or revoke");
}

main()
  .catch((error) => {
    // A refusal says why; anything else prints only its class, never a stack with data.
    console.error(error instanceof PlatformOperatorError ? `✗ Refused: ${error.message}` : `✗ Operators command failed (${error instanceof Error ? error.name : "error"})`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await flushOperationalAlerts();
    await prisma.$disconnect();
  });
