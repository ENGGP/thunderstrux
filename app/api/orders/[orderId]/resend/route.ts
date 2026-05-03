import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  serviceUnavailable,
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
  getOrganisationOrderDetail
} from "@/lib/orders/order-detail";
import {
  isTicketEmailConfigurationError,
  isTicketEmailRecipientError,
  isTicketEmailOrderStateError,
  sendTicketDeliveryEmail
} from "@/lib/email/ticket-delivery";

type RouteContext = {
  params: Promise<{
    orderId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  const { orderId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationFinanceAccess(organisation.id);
    const order = await getOrganisationOrderDetail(organisation.id, orderId);

    if (order.status !== "paid") {
      return badRequest("Ticket email can only be resent for paid orders");
    }

    await sendTicketDeliveryEmail({
      orderId: order.id,
      mode: "manual"
    });

    return NextResponse.json({ success: true });
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

    if (isTicketEmailConfigurationError(error)) {
      return serviceUnavailable(error.message);
    }

    if (isTicketEmailRecipientError(error) || isTicketEmailOrderStateError(error)) {
      return badRequest(error.message);
    }

    console.error("Failed to resend tickets", { orderId, error });
    return internalError();
  }
}
