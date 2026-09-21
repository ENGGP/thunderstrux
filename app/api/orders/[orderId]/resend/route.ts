import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireAuthenticatedUser,
  requireCurrentOrganisationAccount,
  requireOrganisationPermission
} from "@/lib/auth/access";
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
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationOrderAccessError) {
      return notFound(error.message);
    }

    if (error instanceof OrganisationOrderOperationError) {
      return badRequest(error.message);
    }

    console.error("Failed to resend tickets", { orderId, error });
    return internalError();
  }
}
