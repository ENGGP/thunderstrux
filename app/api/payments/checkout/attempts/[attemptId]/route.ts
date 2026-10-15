import { NextResponse } from "next/server";
import { mapRouteError, notFound } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { readUserCheckoutAttempt } from "@/lib/payments/checkout-attempts";

type RouteContext = { params: Promise<{ attemptId: string }> };

// The buyer polls this after a 202 from checkout. Only the attempt's own actor
// can read it; any other attempt is the same 404 as a missing one.
export async function GET(request: Request, context: RouteContext) {
  try {
    const user = await requireAuthenticatedUser();
    const { attemptId } = await context.params;
    const attempt = await readUserCheckoutAttempt(user.id, attemptId);

    if (!attempt) return notFound("Checkout was not found");
    return NextResponse.json(attempt, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, { operation: "checkout.attempt.read", request, rules: [authenticationRule, staleSessionRule] });
  }
}
