import { NextResponse } from "next/server";
import { z } from "zod";
import { badRequest, internalError, validationError } from "@/lib/api/errors";
import { GuestAccessError, guestCookieName, guestCookieOptions, guestDigest, redeemGuestAccess } from "@/lib/guest/guest-access";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { validateJson } from "@/lib/validators";

// POST only: opening or prefetching the emailed link never redeems it.
export async function POST(request: Request) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const body = await validateJson(request, z.object({ token: z.string().min(1).max(100) }).strict());
  if (!body.success) return validationError(body.details);
  const limit = await enforceRateLimit({ policy: "guest_token_ip", request, keyParts: [getRateLimitClientIp(request)], required: true }) ??
    await enforceRateLimit({ policy: "guest_token_digest", request, keyParts: [guestDigest(body.data.token)], required: true });
  if (limit) return limit;
  try {
    const session = await redeemGuestAccess(body.data.token);
    const response = NextResponse.json({ callbackUrl: session.callbackUrl }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(guestCookieName, session.sessionId, guestCookieOptions(session.sessionExpiresAt));
    return response;
  } catch (error) { return error instanceof GuestAccessError ? badRequest(error.message) : internalError(); }
}
