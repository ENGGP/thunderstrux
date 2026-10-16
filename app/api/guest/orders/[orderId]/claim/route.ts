import { NextResponse } from "next/server";
import { apiError, forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { AccountVerificationError } from "@/lib/auth/account-lifecycle";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { guestSessionIdFrom } from "@/lib/guest/guest-access";
import { claimGuestOrder, GuestClaimError } from "@/lib/guest/guest-claim";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = { params: Promise<{ orderId: string }> };

// A signed-in member adds a guest order to their account. Needs the member's
// login (and its CSRF token) and the guest session that opens the order.
export async function POST(request: Request, context: RouteContext) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  try {
    const user = await requireAuthenticatedUser();
    const { orderId } = await context.params;
    const result = await claimGuestOrder({ userId: user.id, guestSessionId: guestSessionIdFrom(request), orderId });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return mapRouteError(error, {
      operation: "guest.order.claim",
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(AccountVerificationError, (failure) => forbidden(failure.message)),
        routeErrorRule(GuestClaimError, (failure) =>
          failure.kind === "unavailable" ? notFound(failure.message) : apiError("CONFLICT", failure.message, 409, [{ path: ["orderId"], message: failure.message, reason: failure.kind }])
        )
      ]
    });
  }
}
