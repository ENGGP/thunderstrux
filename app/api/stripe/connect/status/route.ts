import { NextResponse } from "next/server";
import { mapRouteError } from "@/lib/api/errors";
import { requireOrganisationStripeConnectAccess, requireStripeConnectCapability } from "@/lib/auth/access";
import { requireOrganisationId } from "@/lib/db/organisation-scope";
import { getOrganisationStripeConnectStatus } from "@/lib/stripe/connect";
import { connectRouteRules } from "@/lib/stripe/http";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  try {
    await requireStripeConnectCapability();
    const organisationId = requireOrganisationId(searchParams.get("organisationId"));
    await requireOrganisationStripeConnectAccess(organisationId);

    return NextResponse.json(await getOrganisationStripeConnectStatus(organisationId));
  } catch (error) {
    return mapRouteError(error, { operation: "stripe_connect.status", request, rules: connectRouteRules });
  }
}
