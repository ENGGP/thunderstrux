import { NextResponse } from "next/server";
import { badRequest, internalError } from "@/lib/api/errors";
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
    if (error instanceof PaginationError) {
      return badRequest(error.message);
    }

    console.error(error);
    return internalError();
  }
}
