import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { requireOrganisationStripeConnectAccess, requireStripeConnectCapability } from "@/lib/auth/access";
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { connectRouteRules } from "@/lib/stripe/http";
import { validateJson } from "@/lib/validators";
import { createOrganisationDashboardLink } from "@/lib/stripe/connect";
import { organisationConnectSchema } from "@/lib/validators/stripe-connect";

// A fresh sign-in link to the society's own Stripe Express Dashboard, for staff
// who manage its payments. Links are single use, so one is made per click.
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
      keyParts: [organisationId, "dashboard"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    const url = await createOrganisationDashboardLink(organisationId, user.id);

    return NextResponse.json({ url });
  } catch (error) {
    return mapRouteError(error, { operation: "stripe_connect.dashboard", request, rules: connectRouteRules });
  }
}
