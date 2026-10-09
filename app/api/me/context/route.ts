import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthenticationRequiredError, OrganisationAccessError, requireAuthenticatedUser, requireOrganisationPermission } from "@/lib/auth/access";
import { readAccountContext } from "@/lib/auth/context";
import { contextCookieName, encodeContext } from "@/lib/auth/context-cookie";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";
import { unauthorized, forbidden, internalError, validationError } from "@/lib/api/errors";

const schema = z.discriminatedUnion("mode", [z.object({ mode: z.literal("personal") }).strict(),
  z.object({ mode: z.literal("staff"), organisationId: z.string().min(1).max(100) }).strict()]);
function failure(error: unknown) {
  if (error instanceof AuthenticationRequiredError) return unauthorized();
  if (error instanceof OrganisationAccessError) return forbidden(error.message);
  return internalError();
}
export async function GET() {
  try { return NextResponse.json(await readAccountContext(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const denied = enforceTrustedMutationRequest(request); if (denied) return denied;
  const input = await validateJson(request, schema); if (!input.success) return validationError(input.details);
  try {
    const user = await requireAuthenticatedUser();
    if (!user.mfaSessionId) return forbidden("Sign out and sign in again before choosing a dashboard context");
    if (input.data.mode === "staff") await requireOrganisationPermission(input.data.organisationId, "events:read");
    const response = NextResponse.json({ selected: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(contextCookieName, encodeContext(input.data, user), {
      httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/"
    });
    return response;
  } catch (error) { return failure(error); }
}
