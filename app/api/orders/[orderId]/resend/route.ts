import { NextResponse } from "next/server";
import { badRequest, forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import {
  OrganisationOrderAccessError,
  OrganisationOrderOperationError,
  enqueueOrganisationOrderTicketEmail,
  getOrganisationOrderResendTarget
} from "@/lib/orders/order-detail";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:email_resend");
    const order = await getOrganisationOrderResendTarget(
      organisation.id,
      orderId
    );
    const limitResponse = await enforceRateLimit({
      policy: "order_resend",
      request,
      keyParts: [organisation.id, order.id]
    });

    if (limitResponse) {
      return limitResponse;
    }

    const actor = await requireAuthenticatedUser();
    await enqueueOrganisationOrderTicketEmail(
      organisation.id,
      order.id,
      actor.id
    );

    return NextResponse.json({ queued: true });
  } catch (error) {
    return mapRouteError(error, {
      operation: "orders.resend",
      request,
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message)),
        routeErrorRule(OrganisationOrderAccessError, (error) => notFound(error.message)),
        routeErrorRule(OrganisationOrderOperationError, (error) => badRequest(error.message))
      ]
    });
  }
}
