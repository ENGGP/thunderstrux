import { NextResponse } from "next/server";
import {
  forbidden,
  internalError,
  notFound,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireCurrentOrganisationAccount,
  requireOrganisationFinanceAccess
} from "@/lib/auth/access";
import {
  OrganisationOrderAccessError,
  markOrganisationOrderManuallyRefunded
} from "@/lib/orders/order-detail";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function PATCH(_request: Request, context: RouteContext) {
  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationFinanceAccess(organisation.id);
    const order = await markOrganisationOrderManuallyRefunded(
      organisation.id,
      orderId
    );

    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationOrderAccessError) {
      return notFound(error.message);
    }

    console.error("Failed to mark order as manually refunded", { orderId, error });
    return internalError();
  }
}
