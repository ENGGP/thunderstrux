import { NextResponse } from "next/server";
import { mapRouteError, notFound } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { readCheckoutAttempt } from "@/lib/payments/checkout-attempts";
import { guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { getLiveSession } from "@/lib/auth/live-session";

type RouteContext = { params: Promise<{ attemptId: string }> };

// The buyer polls this after a 202 from checkout. Only the attempt's own actor
// can read it; any other attempt is the same 404 as a missing one.
export async function GET(request: Request, context: RouteContext) {
  try {
    const { attemptId } = await context.params;
    // A guest reads only the attempts of their own checkout session.
    const guestSessionId = guestSessionIdFrom(request);
    const guest = guestSessionId && !(await getLiveSession()) ? await readGuestSession(guestSessionId) : null;
    const actor = guest ? { kind: "guest" as const, id: guest.grantId } : { kind: "user" as const, id: (await requireAuthenticatedUser()).id };
    const attempt = await readCheckoutAttempt(actor, attemptId);

    if (!attempt) return notFound("Checkout was not found");
    return NextResponse.json(attempt, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "checkout.attempt.read", request, rules: [authenticationRule, staleSessionRule] });
  }
}
