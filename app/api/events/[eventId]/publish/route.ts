import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  unauthorized
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireEventManagementAccess
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

const eventSelect = {
  id: true,
  organisationId: true,
  title: true,
  description: true,
  startTime: true,
  endTime: true,
  location: true,
  status: true,
  createdAt: true,
  ticketTypes: {
    select: {
      id: true,
      name: true,
      price: true,
      quantity: true
    },
    orderBy: { createdAt: "asc" }
  }
} as const;

export async function PATCH(_request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const event = await prisma.event.findFirst({
      where: { id: eventId },
      select: {
        id: true,
        organisationId: true,
        status: true,
        ticketTypes: {
          select: {
            quantity: true
          }
        },
        _count: {
          select: {
            orders: true
          }
        }
      }
    });

    if (!event) {
      return notFound("Event was not found in this organisation");
    }

    await requireEventManagementAccess(event.organisationId);

    if (event.status === "draft") {
      if (event.ticketTypes.length === 0) {
        return badRequest("Event needs at least one ticket type before publishing", [
          {
            path: ["ticketTypes"],
            message: "Add at least one ticket type before publishing this event"
          }
        ]);
      }

      const totalTicketQuantity = event.ticketTypes.reduce(
        (total, ticketType) => total + ticketType.quantity,
        0
      );

      if (totalTicketQuantity <= 0) {
        return badRequest("Event needs available tickets before publishing", [
          {
            path: ["ticketTypes"],
            message: "Total ticket quantity must be greater than zero"
          }
        ]);
      }

      const publishedEvent = await prisma.event.update({
        where: { id: event.id },
        data: { status: "published" },
        select: eventSelect
      });

      return NextResponse.json({ event: publishedEvent });
    }

    if (event._count.orders > 0) {
      return badRequest("Event cannot be unpublished after orders exist", [
        {
          path: ["eventId"],
          message: "Keep this event published for purchasers and order history"
        }
      ]);
    }

    const draftEvent = await prisma.event.update({
      where: { id: event.id },
      data: { status: "draft" },
      select: eventSelect
    });

    return NextResponse.json({ event: draftEvent });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    console.error("Failed to toggle event publish status", { eventId, error });
    return internalError();
  }
}
