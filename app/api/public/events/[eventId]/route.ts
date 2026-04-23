import { NextResponse } from "next/server";
import { internalError, notFound } from "@/lib/api/errors";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        status: "published"
      },
      select: {
        id: true,
        title: true,
        description: true,
        startTime: true,
        endTime: true,
        location: true,
        organisation: {
          select: {
            name: true,
            slug: true
          }
        },
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          },
          orderBy: { createdAt: "asc" }
        }
      }
    });

    if (!event) {
      return notFound("Event not found");
    }

    return NextResponse.json({ event });
  } catch (error) {
    console.error(error);
    return internalError();
  }
}
