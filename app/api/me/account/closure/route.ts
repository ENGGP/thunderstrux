import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSecurityMutation, currentPasswordSchema } from "@/lib/auth/account-security-http";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { AccountClosureError, closeAccount, closureAcknowledgement, readAccountClosureEligibility } from "@/lib/auth/account-closure";
import { badRequest, conflict, unauthorized, internalError } from "@/lib/api/errors";
export async function GET() {
  try { return NextResponse.json(await readAccountClosureEligibility(await requireAuthenticatedUser()), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) return unauthorized();
    return internalError();
  }
}
export async function POST(request: Request) {
  return accountSecurityMutation(request, z.object({ currentPassword: currentPasswordSchema, acknowledgement: z.literal(closureAcknowledgement) }).strict(), async (actor, body) => {
    try { await closeAccount(actor, body.currentPassword, body.acknowledgement); return NextResponse.json({ closed: true, signInRequired: true }); }
    catch (error) {
      if (error instanceof AccountClosureError) return error.kind === "blocked" ? conflict(error.message) : badRequest(error.message);
      throw error;
    }
  });
}
