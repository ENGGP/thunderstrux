import { NextResponse } from "next/server";
import { forbidden, mapRouteError, notFound, routeErrorRule } from "@/lib/api/errors";
import { authenticationRule } from "@/lib/api/route-rules";
import { OrganisationAccessError, requireCurrentOrganisationAccount, requireOrganisationFinanceAccess } from "@/lib/auth/access";
import {
  OrganisationOrderAccessError,
  getOrganisationOrderDetail
} from "@/lib/orders/order-detail";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationFinanceAccess(organisation.id);
    const order = await getOrganisationOrderDetail(organisation.id, orderId);

    return NextResponse.json({ order });
  } catch (error) {
    return mapRouteError(error, {
      operation: "orders.read",
      rules: [
        authenticationRule,
        routeErrorRule(OrganisationAccessError, (error) => forbidden(error.message)),
        routeErrorRule(OrganisationOrderAccessError, (error) => notFound(error.message))
      ]
    });
  }
}
