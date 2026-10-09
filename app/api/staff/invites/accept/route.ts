import { NextResponse } from "next/server";
import { requireVerifiedUser } from "@/lib/auth/access";
import { validationError } from "@/lib/api/errors";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { acceptOrganisationStaffInvite, hashStaffInviteToken } from "@/lib/staff/invites";
import { staffInviteFailure } from "@/lib/staff/invite-http";
import { validateJson } from "@/lib/validators";
import { acceptStaffInviteSchema } from "@/lib/validators/staff";

export async function POST(request: Request) {
  const denied = enforceTrustedMutationRequest(request); if (denied) return denied;
  const input = await validateJson(request, acceptStaffInviteSchema); if (!input.success) return validationError(input.details);
  const limited = await enforceRateLimit({ policy: "account_token_ip", request, keyParts: ["staff_invite", getRateLimitClientIp(request)], required: true }) ??
    await enforceRateLimit({ policy: "account_token_digest", request, keyParts: ["staff_invite", hashStaffInviteToken(input.data.token)], required: true });
  if (limited) return limited;
  try {
    const actor = await requireVerifiedUser();
    return NextResponse.json(await acceptOrganisationStaffInvite({ token: input.data.token, actor }), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return staffInviteFailure(error); }
}
