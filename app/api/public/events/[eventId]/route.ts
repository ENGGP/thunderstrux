import { NextResponse } from "next/server";
import { mapRouteError, notFound } from "@/lib/api/errors";
import { getPublishedEventDetail } from "@/lib/events/public-events";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const event = await getPublishedEventDetail(eventId);

    if (!event) {
      return notFound("Event not found");
    }

    return NextResponse.json({ event });
  } catch (error) {
    return mapRouteError(error, { operation: "public_events.detail", request });
  }
}
