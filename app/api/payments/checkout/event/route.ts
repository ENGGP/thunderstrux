import { AccountVerificationError } from "@/lib/auth/account-lifecycle";
import { NextResponse } from "next/server";
import { apiError, badRequest, forbidden, mapRouteError, notFound, routeErrorRule, serviceUnavailable, unauthorized, validationError } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireVerifiedUser } from "@/lib/auth/access";
import {
  CheckoutCreationError,
  createEventCheckout
} from "@/lib/payments/checkout-creation";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest, trustedRequestOrigin } from "@/lib/security/request-guard";
import { StripeConfigurationError } from "@/lib/stripe";
import { GuestAccessError, guestSessionEndedMessage, guestSessionIdFrom, readGuestSession } from "@/lib/guest/guest-access";
import { GUEST_CSRF_HEADER, verifyGuestCsrf } from "@/lib/guest/guest-csrf";
import { getLiveSession } from "@/lib/auth/live-session";
import { validateJson } from "@/lib/validators";
import { createEventCheckoutSchema } from "@/lib/validators/payments";

export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const validation = await validateJson(request, createEventCheckoutSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    // A guest cookie and no login: the guest buys under their live checkout
    // session, which has its own CSRF token. A signed-in member always buys as the member.
    const sessionId = guestSessionIdFrom(request);
    if (sessionId && !(await getLiveSession())) {
      const guest = await readGuestSession(sessionId);
      if (!guest || guest.purpose !== "checkout") return unauthorized(guestSessionEndedMessage);
      if (!verifyGuestCsrf(sessionId, request.headers.get(GUEST_CSRF_HEADER))) return forbidden("Invalid CSRF token");
      const limit = await enforceRateLimit({ policy: "checkout_create", request, keyParts: ["guest", guest.guestIdentityId, validation.data.eventId] });
      if (limit) return limit;
      return checkoutResponse(await createEventCheckout({ ...validation.data, guest: { grantId: guest.grantId, guestIdentityId: guest.guestIdentityId }, returnOrigin: trustedRequestOrigin(request) }));
    }

    const user = await requireVerifiedUser();

    if (user.accountRole !== "member") {
      return badRequest("Member account required", [
        { path: ["accountRole"], message: "Only member accounts can buy tickets" }
      ]);
    }

    const limitResponse = await enforceRateLimit({
      policy: "checkout_create",
      request,
      keyParts: [user.id, validation.data.eventId]
    });

    if (limitResponse) {
      return limitResponse;
    }

    return checkoutResponse(await createEventCheckout({
      userId: user.id,
      eventId: validation.data.eventId,
      ticketTypeId: validation.data.ticketTypeId,
      quantity: validation.data.quantity,
      expectedUnitPrice: validation.data.expectedUnitPrice,
      idempotencyKey: validation.data.idempotencyKey,
      returnOrigin: trustedRequestOrigin(request)
    }));
  } catch (error) {
    return mapRouteError(error, {
      operation: "payments.checkout_event",
      request,
      rules: [
        routeErrorRule(GuestAccessError, (denied) => unauthorized(denied.message)),
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (denied) => forbidden(denied.message)),
        routeErrorRule(AccountVerificationError, (denied) => forbidden(denied.message)),
        routeErrorRule(CheckoutCreationError, (refused) =>
          refused.kind === "event_not_found" || refused.kind === "ticket_type_not_found"
            ? notFound(refused.message)
            : refused.kind === "quote_changed" || refused.kind === "idempotency_conflict" || refused.kind === "purchase_in_progress"
              ? apiError("CONFLICT", refused.message, 409, refused.details)
              : badRequest(refused.message, refused.details)
        ),
        // Buyers learn only that payments are unavailable, not how the server is set up.
        routeErrorRule(StripeConfigurationError, () => serviceUnavailable("Payments are unavailable right now. Try again later."))
      ]
    });
  }
}

// fulfilled: a free registration (or a replay of a finished checkout) has its
// tickets; stripe: go to the Session; 202: the Stripe outcome is not known yet
// and the buyer polls the attempt.
function checkoutResponse(result: Awaited<ReturnType<typeof createEventCheckout>>) {
  if (result.status === "fulfilled") return NextResponse.json({ kind: "fulfilled", orderId: result.orderId });
  return result.status === "redirect"
    ? NextResponse.json({ kind: "stripe", url: result.url })
    : NextResponse.json({ attemptId: result.attemptId, status: "processing" }, { status: 202 });
}
