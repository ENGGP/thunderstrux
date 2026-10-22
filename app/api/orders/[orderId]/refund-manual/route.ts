import { NextResponse } from "next/server";
import { conflict, forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireAuthenticatedUser, requireCurrentOrganisationAccount, requireOrganisationPermission } from "@/lib/auth/access";
import {
  OrganisationOrderAccessError,
  OrganisationOrderOperationError,
  markOrganisationOrderManuallyRefunded
} from "@/lib/orders/order-detail";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationPermission(organisation.id, "orders:refund_mark");
    const actor = await requireAuthenticatedUser();
    const order = await markOrganisationOrderManuallyRefunded(
      organisation.id,
      orderId,
      actor.id
    );

    return NextResponse.json({ order });
  } catch (error) {
    return mapRouteError(error, {
      operation: "orders.refund_manual",
      request,
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message)),
        routeErrorRule(OrganisationOrderAccessError, (error) => notFound(error.message)),
        routeErrorRule(OrganisationOrderOperationError, (error) => conflict(error.message))
      ]
    });
  }
}
