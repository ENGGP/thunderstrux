import { NextResponse } from "next/server";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { readAccountSettings } from "@/lib/auth/account-settings";
import { mapRouteError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
export async function GET(request?: Request) {
  try { return NextResponse.json(await readAccountSettings(await requireAuthenticatedUser()), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return mapRouteError(error, { operation: "account.read", request, rules: [authenticationRule, staleSessionRule] }); }
}
