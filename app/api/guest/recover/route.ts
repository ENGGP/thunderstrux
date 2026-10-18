import { NextResponse } from "next/server";
import { z } from "zod";
import { internalError, validationError } from "@/lib/api/errors";
import { requestGuestRecovery } from "@/lib/guest/guest-access";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

const schema = z.object({ email: z.string().trim().toLowerCase().email().max(320) }).strict();

// Find your purchase: the same 202 whether or not the address has purchases;
// limits fail closed, so no link is sent while request protection is down.
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const ipLimit = await enforceRateLimit({ policy: "guest_email_ip", request, keyParts: ["recover", getRateLimitClientIp(request)], required: true });
  if (ipLimit) return ipLimit;
  const body = await validateJson(request, schema); if (!body.success) return validationError(body.details);
  const emailLimit = await enforceRateLimit({ policy: "guest_email_address", request, keyParts: ["recover", body.data.email], required: true });
  if (emailLimit) return emailLimit;
  try {
    await requestGuestRecovery(body.data.email);
    return NextResponse.json({ accepted: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch { return internalError(); }
}
