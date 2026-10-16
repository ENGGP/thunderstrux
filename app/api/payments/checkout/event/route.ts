import { AccountVerificationError } from "@/lib/auth/account-lifecycle";
import { NextResponse } from "next/server";
import {
  apiError,
  badRequest,
  forbidden,
  internalError,
  notFound,
  serviceUnavailable,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireVerifiedUser
} from "@/lib/auth/access";
import {
  CheckoutCreationError,
  createEventCheckout
} from "@/lib/payments/checkout-creation";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { StripeConfigurationError } from "@/lib/stripe";
import { GUEST_CSRF_HEADER, GuestAccessError, guestSessionEndedMessage, guestSessionIdFrom, readGuestSession, verifyGuestCsrf } from "@/lib/guest/guest-access";
import { hasAuthSessionCookie } from "@/lib/security/csrf";
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
    // No login: a guest buys under their live checkout session, which has its own CSRF token.
    if (!hasAuthSessionCookie(request)) {
      const sessionId = guestSessionIdFrom(request);
      const guest = await readGuestSession(sessionId);
      if (!guest || !sessionId || guest.purpose !== "checkout") return unauthorized(guestSessionEndedMessage);
      if (!verifyGuestCsrf(sessionId, request.headers.get(GUEST_CSRF_HEADER))) return forbidden("Invalid CSRF token");
      const limit = await enforceRateLimit({ policy: "checkout_create", request, keyParts: ["guest", guest.grantId, validation.data.eventId, getRateLimitClientIp(request)] });
      if (limit) return limit;
      return checkoutResponse(await createEventCheckout({ ...validation.data, guest: { grantId: guest.grantId, guestIdentityId: guest.guestIdentityId } }));
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
      keyParts: [user.id, validation.data.eventId, getRateLimitClientIp(request)]
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
      idempotencyKey: validation.data.idempotencyKey
    }));
  } catch (error) {
    if (error instanceof GuestAccessError) return unauthorized(error.message);
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError || error instanceof AccountVerificationError) return forbidden(error.message);

    if (error instanceof CheckoutCreationError) {
      if (
        error.kind === "event_not_found" ||
        error.kind === "ticket_type_not_found"
      ) {
        return notFound(error.message);
      }

      if (error.kind === "quote_changed" || error.kind === "idempotency_conflict") {
        return apiError("CONFLICT", error.message, 409, error.details);
      }

      return badRequest(error.message, error.details);
    }

    if (error instanceof StripeConfigurationError) {
      return serviceUnavailable(
        "Stripe is not configured. Check STRIPE_SECRET_KEY in the app container environment."
      );
    }

    return internalError();
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
