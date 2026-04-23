import { NextResponse } from "next/server";
import { internalError } from "@/lib/api/errors";
import { getPublishedEvents } from "@/lib/events/public-events";

export async function GET() {
  try {
    const events = await getPublishedEvents();

    return NextResponse.json({ events });
  } catch (error) {
    console.error(error);
    return internalError();
  }
}
