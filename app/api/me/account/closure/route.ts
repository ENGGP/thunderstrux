import { NextResponse } from "next/server";
import { z } from "zod";
import { accountSecurityMutation, currentPasswordSchema } from "@/lib/auth/account-security-http";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { AccountClosureError, closeAccount, closureAcknowledgement, readAccountClosureEligibility } from "@/lib/auth/account-closure";
import { badRequest, conflict, mapRouteError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
export async function GET(request?: Request) {
  try { return NextResponse.json(await readAccountClosureEligibility(await requireAuthenticatedUser()), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return mapRouteError(error, { operation: "account.closure_eligibility", request, rules: [authenticationRule, staleSessionRule] }); }
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
