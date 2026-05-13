import { NextResponse } from "next/server";
import {
  badRequest,
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
  getGroupedOrganisationOrdersWithContext,
  parseOrderStatusFilter
} from "@/lib/orders/grouped-orders";
import {
  PaginationError,
  parsePaginationOptions
} from "@/lib/pagination/cursor";

function parseDateParam(
  value: string | null,
  field: string,
  { endOfDay = false }: { endOfDay?: boolean } = {}
) {
  if (!value) {
    return { date: undefined };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      error: badRequest("Invalid date filter", [
        { path: [field], message: `${field} must be a valid date` }
      ])
    };
  }

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setUTCHours(23, 59, 59, 999);
  }

  return { date };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const organisation = await requireCurrentOrganisationAccount();
    await requireOrganisationFinanceAccess(organisation.id);
    const includeSystemOrders = searchParams.get("includeSystem") === "true";
    const status = parseOrderStatusFilter(searchParams.get("status"), {
      includeSystemOrders
    });
    const eventId = searchParams.get("eventId")?.trim() || undefined;
    const search = searchParams.get("search")?.trim() || undefined;
    const pagination = parsePaginationOptions(searchParams);
    const startDateResult = parseDateParam(searchParams.get("startDate"), "startDate");
    const endDateResult = parseDateParam(searchParams.get("endDate"), "endDate", {
      endOfDay: true
    });

    if (startDateResult.error) {
      return startDateResult.error;
    }

    if (endDateResult.error) {
      return endDateResult.error;
    }

    const result = await getGroupedOrganisationOrdersWithContext(
      organisation.id,
      status,
      eventId,
      {
        includeSystemOrders,
        search,
        startDate: startDateResult.date,
        endDate: endDateResult.date,
        ...pagination
      }
    );

    return NextResponse.json({
      groups: result.groups,
      pageInfo: result.pageInfo
    });
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

    if (error instanceof PaginationError) {
      return badRequest(error.message);
    }

    console.error(error);
    return internalError();
  }
}
