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
    await requireOrganisationFinanceAccess(organisation.id);
    const order = await getOrganisationOrderDetail(organisation.id, orderId);
    const limitResponse = await enforceRateLimit({
      policy: "order_resend",
      request,
      keyParts: [organisation.id, order.id]
    });

    if (limitResponse) {
      return limitResponse;
    }

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
