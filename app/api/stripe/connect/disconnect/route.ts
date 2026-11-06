import { NextResponse } from "next/server";
import { mapRouteError, validationError } from "@/lib/api/errors";
import { requireOrganisationStripeConnectAccess, requireStripeConnectCapability } from "@/lib/auth/access";
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";
import { connectRouteRules } from "@/lib/stripe/http";
import { validateJson } from "@/lib/validators";
import { disconnectAccount, notConnectedStatus } from "@/lib/stripe/connect";
import { stripeDisconnectSchema } from "@/lib/validators/stripe-connect";

// Refused while orders still depend on the account.
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
      keyParts: [organisationId, "disconnect"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    await disconnectAccount(organisationId, { actor: user });

    return NextResponse.json({
      disconnected: true,
      status: notConnectedStatus()
    });
  } catch (error) {
    return mapRouteError(error, { operation: "stripe_connect.disconnect", request, rules: connectRouteRules });
  }
}
