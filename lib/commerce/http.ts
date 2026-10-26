import type { CommerceKind } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, badRequest, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, unauthorized, validationError } from "@/lib/api/errors";
import { authenticationRule, staleSessionRule } from "@/lib/api/route-rules";
import { AccountVerificationError } from "@/lib/auth/account-lifecycle";
import { OrganisationAccessError, requireVerifiedUser } from "@/lib/auth/access";
import { getLiveSession } from "@/lib/auth/live-session";
import { CommerceCheckoutError, CommerceSelectionError, createCommerceCheckout } from "@/lib/commerce/checkout";
import { MembershipUnavailableError } from "@/lib/memberships/grants";
import { MerchandiseUnavailableError } from "@/lib/merchandise/sale";
import { GuestAccessError, guestSessionEndedMessage, guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { GUEST_CSRF_HEADER, verifyGuestCsrf } from "@/lib/guest/guest-csrf";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest, trustedRequestOrigin } from "@/lib/security/request-guard";
import { StripeConfigurationError } from "@/lib/stripe";
import { validateJson } from "@/lib/validators";

const schema = z.object({
  organisationId: z.string().trim().min(1),
  // Checked by the family's own schema once the family is known to be on sale.
  selection: z.unknown(),
  // The total the buyer was shown; a different locked total is a 409 quote change.
  expectedTotal: z.number().int().min(0),
  idempotencyKey: z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/)
}).strict();

// POST /api/payments/checkout/membership and /merchandise (T21). Same rules as
// ticket checkout: trusted origin, a signed-in verified member (or, for
// merchandise only, a guest's live checkout session with its CSRF token), and
// the checkout rate limit. 200 {kind: "stripe", url} or {kind: "fulfilled"};
// 202 while Stripe's answer is being confirmed.
export async function commerceCheckoutRoute(request: Request, family: CommerceKind) {
  const guard = enforceTrustedMutationRequest(request); if (guard) return guard;
  const body = await validateJson(request, schema);
  if (!body.success) return validationError(body.details);
  const input = { family, organisationId: body.data.organisationId, selection: body.data.selection, expectedTotal: body.data.expectedTotal, idempotencyKey: body.data.idempotencyKey, returnOrigin: trustedRequestOrigin(request) };
  try {
    const sessionId = guestSessionIdFrom(request);
    if (family === "merchandise" && sessionId && !(await getLiveSession())) {
      const guest = await readGuestSession(sessionId);
      if (!guest || guest.purpose !== "checkout") return unauthorized(guestSessionEndedMessage);
      if (!verifyGuestCsrf(sessionId, request.headers.get(GUEST_CSRF_HEADER))) return forbidden("Invalid CSRF token");
      const limit = await enforceRateLimit({ policy: "checkout_create", request, keyParts: ["guest", guest.guestIdentityId, family] });
      if (limit) return limit;
      return respond(await createCommerceCheckout({ ...input, buyer: { guest: { grantId: guest.grantId, guestIdentityId: guest.guestIdentityId } } }));
    }
    const user = await requireVerifiedUser();
    if (user.accountRole !== "member") return badRequest("Member account required", [{ path: ["accountRole"], message: "Only member accounts can buy" }]);
    const limit = await enforceRateLimit({ policy: "checkout_create", request, keyParts: [user.id, family] });
    if (limit) return limit;
    return respond(await createCommerceCheckout({ ...input, buyer: { userId: user.id } }));
  } catch (error) {
    return mapRouteError(error, {
      operation: `commerce.checkout.${family}`,
      request,
      rules: [
        authenticationRule,
        staleSessionRule,
        routeErrorRule(GuestAccessError, (failure) => unauthorized(failure.message)),
        routeErrorRule(OrganisationAccessError, (failure) => forbidden(failure.message)),
        routeErrorRule(AccountVerificationError, (failure) => forbidden(failure.message)),
        routeErrorRule(CommerceSelectionError, (failure) => validationError(failure.issues.map((issue) => ({ path: ["selection", ...issue.path.map(String)], message: issue.message })))),
        // Nothing charged: the plan left sale, the dates are already covered, or a checkout for them is open.
        routeErrorRule(MembershipUnavailableError, (failure) => apiError("CONFLICT", failure.message, 409, [{ path: ["selection"], message: failure.message, reason: failure.reason, ...(failure.orderId ? { id: failure.orderId } : {}) }])),
        routeErrorRule(MerchandiseUnavailableError, (failure) =>
          apiError("CONFLICT", failure.message, 409, [{ path: failure.variantId ? ["selection", "items", failure.variantId] : ["selection"], message: failure.message, reason: failure.reason, value: failure.available, ...(failure.orderId ? { id: failure.orderId } : {}) }])
        ),
        routeErrorRule(StripeConfigurationError, () => serviceUnavailable("Stripe is not configured.")),
        routeErrorRule(CommerceCheckoutError, (failure) =>
          failure.kind === "not_available"
            ? notFound(failure.message)
            : failure.kind === "quote_changed" || failure.kind === "idempotency_conflict" || failure.kind === "unavailable"
              ? apiError("CONFLICT", failure.message, 409, failure.details)
              : badRequest(failure.message, failure.details)
        )
      ]
    });
  }
}

function respond(result: Awaited<ReturnType<typeof createCommerceCheckout>>) {
  if (result.status === "fulfilled") return NextResponse.json({ kind: "fulfilled", commerceOrderId: result.commerceOrderId });
  return result.status === "redirect"
    ? NextResponse.json({ kind: "stripe", url: result.url })
    : NextResponse.json({ attemptId: result.attemptId, status: "processing" }, { status: 202 });
}
