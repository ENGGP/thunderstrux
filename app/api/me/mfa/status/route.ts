import { NextResponse } from "next/server";
import { forbidden, mapRouteError, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { getStaffMfaStatus, MfaInputError } from "@/lib/security/staff-mfa";

export async function GET(request?: Request) {
  try {
    const user = await requireAuthenticatedUser();
    const status = await getStaffMfaStatus(user.id);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "mfa.status", request, rules: [
      authenticationRule,
      routeErrorRule(MfaInputError, failure => forbidden(failure.message))
    ] });
  }
}
