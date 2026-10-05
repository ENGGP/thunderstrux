import { NextResponse } from "next/server";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { readAccountSettings } from "@/lib/auth/account-settings";
import { AccountSecurityError } from "@/lib/auth/account-lifecycle";
import { unauthorized, internalError } from "@/lib/api/errors";
export async function GET() {
  try { return NextResponse.json(await readAccountSettings(await requireAuthenticatedUser()), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) {
    if (error instanceof AuthenticationRequiredError || (error instanceof AccountSecurityError && error.kind === "stale_session")) return unauthorized();
    return internalError();
  }
}
