import { NextResponse } from "next/server";
import {
  forbidden,
  internalError,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireCurrentOrganisationAccount,
  requireOrganisationFinanceAccess
} from "@/lib/auth/access";
import {
  OrganisationOrderEventAccessError,
  getGroupedOrganisationOrders,
  parseOrderStatusFilter
} from "@/lib/orders/grouped-orders";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationFinanceAccess(organisation.id);
    const status = parseOrderStatusFilter(searchParams.get("status"));
    const eventId = searchParams.get("eventId")?.trim() || undefined;
    const groups = await getGroupedOrganisationOrders(
      organisation.id,
      status,
      eventId
    );

    return NextResponse.json(groups);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationOrderEventAccessError) {
      return forbidden(error.message);
    }

    console.error(error);
    return internalError();
  }
}
