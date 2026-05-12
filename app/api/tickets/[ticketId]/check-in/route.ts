import { NextResponse } from "next/server";
import {
  conflict,
  forbidden,
  internalError,
  notFound,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireCurrentOrganisationAccount,
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  OrganisationTicketAccessError,
  TicketAlreadyCheckedInError,
  checkInOrganisationTicket
} from "@/lib/tickets/check-in";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { enforceTrustedMutationRequest } from "@/lib/security/request-guard";

type RouteContext = {
  params: Promise<{
    ticketId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  const trustedOriginError = enforceTrustedMutationRequest(request);

  if (trustedOriginError) {
    return trustedOriginError;
  }

  const { ticketId } = await context.params;

  try {
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
    const limitResponse = await enforceRateLimit({
      policy: "ticket_check_in_out",
      request,
      keyParts: [organisation.id, "check-in"]
    });

    if (limitResponse) {
      return limitResponse;
    }

    const ticket = await checkInOrganisationTicket(organisation.id, ticketId);

    return NextResponse.json({ ticket });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationTicketAccessError) {
      return notFound(error.message);
    }

    if (error instanceof TicketAlreadyCheckedInError) {
      return conflict(error.message);
    }

    console.error("Failed to check in ticket", { ticketId, error });
    return internalError();
  }
}
