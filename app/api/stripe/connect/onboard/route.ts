import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { requireOrganisationStripeConnectAccess, requireStripeConnectCapability } from "@/lib/auth/access";
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { connectRouteRules } from "@/lib/stripe/http";
import { validateJson } from "@/lib/validators";
import { startOrganisationStripeOnboarding } from "@/lib/stripe/connect";
import { organisationConnectSchema } from "@/lib/validators/stripe-connect";

// Creates the society's Express account if it has none, then returns Stripe's onboarding link.
export async function POST(request: Request) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  try {
    const user = await requireStripeConnectCapability();
    const validation = await validateJson(request, organisationConnectSchema);

    if (!validation.success) {
      return validationError(validation.details);
    }

    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireOrganisationStripeConnectAccess(organisationId);
    const limitResponse = await enforceRateLimit({
      policy: "stripe_connect_mutation",
      request,
      keyParts: [organisationId, "onboard"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    const url = await startOrganisationStripeOnboarding(organisationId, user.id);

    return NextResponse.json({ url });
  } catch (error) {
    return mapRouteError(error, { operation: "stripe_connect.onboard", request, rules: connectRouteRules });
  }
}
