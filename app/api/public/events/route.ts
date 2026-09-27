import { NextResponse } from "next/server";
import {
  badRequest,
  mapRouteError,
  routeErrorRule
} from "@/lib/api/errors";
import { getPublishedEvents } from "@/lib/events/public-events";
import {
  PaginationError,
  parsePaginationOptions
} from "@/lib/pagination/cursor";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const pagination = parsePaginationOptions(searchParams);
    const result = await getPublishedEvents(pagination);

    return NextResponse.json({
      events: result.events,
      pageInfo: result.pageInfo
    });
  } catch (error) {
    return mapRouteError(error, {
      operation: "public_events.list",
      request,
      rules: [
        routeErrorRule(PaginationError, (paginationError) =>
          badRequest(paginationError.message)
        )
      ]
    });
  }
}
