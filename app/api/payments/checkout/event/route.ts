import { NextResponse } from "next/server";
import {
  badRequest,
  internalError,
  notFound,
  serviceUnavailable,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  requireAuthenticatedUser
} from "@/lib/auth/access";
import {
  CheckoutCreationError,
  createEventCheckout
} from "@/lib/payments/checkout-creation";
import { enforceRateLimit, getRateLimitClientIp } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { StripeConfigurationError } from "@/lib/stripe";
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
    const user = await requireAuthenticatedUser();

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

    return NextResponse.json(
      await createEventCheckout({
        userId: user.id,
        eventId: validation.data.eventId,
        ticketTypeId: validation.data.ticketTypeId,
        quantity: validation.data.quantity
      })
    );
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof CheckoutCreationError) {
      if (
        error.kind === "event_not_found" ||
        error.kind === "ticket_type_not_found"
      ) {
        return notFound(error.message);
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
