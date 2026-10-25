import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { requireOrganisationStripeConnectAccess, requireStripeConnectCapability } from "@/lib/auth/access";
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { connectRouteRules } from "@/lib/stripe/http";
import { validateJson } from "@/lib/validators";
import { createOrganisationDashboardLink } from "@/lib/stripe/connect";
import { stripeDisconnectSchema } from "@/lib/validators/stripe-connect";

// A fresh sign-in link to the society's own Stripe Express Dashboard, for staff
// who manage its payments. Links are single use, so one is made per click; it
// needs a fresh authenticator code when staff MFA is on.
export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  try {
    const user = await requireStripeConnectCapability();
    const validation = await validateJson(request, stripeDisconnectSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireOrganisationStripeConnectAccess(organisationId);
    const limitResponse = await enforceRateLimit({
      policy: "stripe_connect_mutation",
      request,
      keyParts: [organisationId, "dashboard"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    // Authenticator guesses share the staff verification limit.
    if (validation.data.mfaCode) {
      const codeLimit = await enforceRateLimit({ policy: "staff_mfa_verify", request, keyParts: [user.id] });
      if (codeLimit) return codeLimit;
    }

    const url = await createOrganisationDashboardLink(organisationId, { actor: user, mfaCode: validation.data.mfaCode });

    return NextResponse.json({ url });
  } catch (error) {
    return mapRouteError(error, { operation: "stripe_connect.dashboard", request, rules: connectRouteRules });
  }
}
