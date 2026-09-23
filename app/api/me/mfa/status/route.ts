import { NextResponse } from "next/server";
import { internalError, unauthorized, forbidden } from "@/lib/api/errors";
import { AuthenticationRequiredError, requireAuthenticatedUser } from "@/lib/auth/access";
import { getStaffMfaStatus, MfaInputError } from "@/lib/security/staff-mfa";

export async function GET() {
  try {
    const user = await requireAuthenticatedUser();
    const status = await getStaffMfaStatus(user.id);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) return unauthorized();
    if (error instanceof MfaInputError) return forbidden(error.message);
    console.error("Failed to read MFA status", error);
    return internalError();
  }
}
