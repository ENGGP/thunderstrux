import { NextResponse } from "next/server";
import { unauthorized } from "@/lib/api/errors";
import { guestCsrfToken, guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";

// The live guest session and its CSRF token, for guest pages that write.
export async function GET(request: Request) {
  const sessionId = guestSessionIdFrom(request);
  const session = await readGuestSession(sessionId);
  if (!session || !sessionId) {
    const response = unauthorized("Your guest session has ended. Confirm your email again.");
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
  return NextResponse.json(
    { email: session.email, expiresAt: session.expiresAt, csrfToken: guestCsrfToken(sessionId) },
    { headers: { "Cache-Control": "no-store" } }
  );
}
