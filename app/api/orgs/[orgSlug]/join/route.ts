import { NextResponse } from "next/server";
import { AccountVerificationError } from "@/lib/auth/account-lifecycle";
import { forbidden } from "@/lib/api/errors";
import { requireAccountRole, requireVerifiedUser } from "@/lib/auth/access";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { setSocietyJoin } from "@/lib/organisations/join";
import { organisationError } from "@/lib/organisations/http";
export async function POST(
  request: Request,
  context: { params: Promise<{ orgSlug: string }> },
) {
  const denied = enforceTrustedMutationRequest(request);
  if (denied) return denied;
  try {
    const user = await requireAccountRole("member");
    await requireVerifiedUser();
    const { orgSlug } = await context.params;
    const limited = await enforceRateLimit({
      policy: "organisation_join_leave",
      request,
      keyParts: [user.id, orgSlug, "join"],
    });
    if (limited) return limited;
    return NextResponse.json({
      organisation: await setSocietyJoin(user, orgSlug, true),
    });
  } catch (error) {
    return error instanceof AccountVerificationError
      ? forbidden(error.message)
      : organisationError(error);
  }
}
