import { NextResponse } from "next/server";
import { mapRouteError, unauthorized } from "@/lib/api/errors";
import { guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";

// The live guest session and its CSRF token, for guest pages that write.
export async function GET(request: Request) {
  try {
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
  } catch (error) {
    return mapRouteError(error, { operation: "guest.session", request });
  }
}
