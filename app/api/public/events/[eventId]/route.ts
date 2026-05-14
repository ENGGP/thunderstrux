import { NextResponse } from "next/server";
import { internalError, notFound } from "@/lib/api/errors";
import { getPublishedEventDetail } from "@/lib/events/public-events";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const event = await getPublishedEventDetail(eventId);

    if (!event) {
      return notFound("Event not found");
    }

    return NextResponse.json({ event });
  } catch (error) {
    console.error(error);
    return internalError();
  }
}
