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
  requireOrganisationEventManagementAccess
} from "@/lib/auth/access";
import {
  OrganisationEventTicketsAccessError,
  TicketPaginationError,
  getOrganisationEventTickets,
  parseTicketPaginationOptions
} from "@/lib/tickets/check-in";
import { badRequest } from "@/lib/api/errors";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const { searchParams } = new URL(request.url);
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationEventManagementAccess(organisation.id);
    const pagination = parseTicketPaginationOptions(searchParams);
    const payload = await getOrganisationEventTickets(
      organisation.id,
      eventId,
      pagination
    );

    return NextResponse.json(payload);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationEventTicketsAccessError) {
      return notFound(error.message);
    }

    if (error instanceof TicketPaginationError) {
      return badRequest(error.message);
    }

    console.error("Failed to fetch event tickets", { eventId, error });
    return internalError();
  }
}
