import { NextResponse } from "next/server";
import {
  badRequest,
  forbidden,
  internalError,
  notFound,
  unauthorized,
  validationError
} from "@/lib/api/errors";
import {
  AuthenticationRequiredError,
  OrganisationAccessError,
  requireEventManagementAccess,
  requireOrganisationMembershipById
} from "@/lib/auth/access";
import { prisma } from "@/lib/db";
import {
  OrganisationMismatchError,
  OrganisationScopeError,
  requireOrganisationId,
  scopedByOrganisation
} from "@/lib/db/organisation-scope";
import { validateJson } from "@/lib/validators";
import { updateEventSchema } from "@/lib/validators/events";

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

export async function GET(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const { searchParams } = new URL(request.url);
    const organisationId = requireOrganisationId(searchParams.get("orgId"));
    await requireOrganisationMembershipById(organisationId);

    const event = await prisma.event.findFirst({
      where: scopedByOrganisation(organisationId, { id: eventId }),
      select: eventSelect
    });

    if (!event) {
      return notFound("Event was not found in this organisation");
    }

    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["orgId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    console.error("Failed to fetch event", { eventId, error });
    return internalError();
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { eventId } = await context.params;
  const validation = await validateJson(request, updateEventSchema);

  if (!validation.success) {
    return validationError(validation.details);
  }

  try {
    const organisationId = requireOrganisationId(validation.data.organisationId);
    await requireEventManagementAccess(organisationId);

    const existingEvent = await prisma.event.findFirst({
      where: scopedByOrganisation(organisationId, { id: eventId }),
      select: {
        id: true,
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true,
            _count: {
              select: {
                orders: true,
                tickets: true
              }
            }
          }
        }
      }
    });

    if (!existingEvent) {
      return notFound("Event was not found in this organisation");
    }

    const submittedTicketTypes = validation.data.ticketTypes;
    const existingTicketTypesById = new Map(
      existingEvent.ticketTypes.map((ticketType) => [ticketType.id, ticketType])
    );
    const submittedIds = submittedTicketTypes
      .map((ticketType) => ticketType.id)
      .filter((id): id is string => Boolean(id));
    const uniqueSubmittedIds = new Set(submittedIds);

    if (uniqueSubmittedIds.size !== submittedIds.length) {
      return badRequest("Duplicate ticket type IDs are not allowed", [
        { path: ["ticketTypes"], message: "Each ticket type can only appear once" }
      ]);
    }

    const unknownTicketTypeId = submittedIds.find(
      (ticketTypeId) => !existingTicketTypesById.has(ticketTypeId)
    );

    if (unknownTicketTypeId) {
      return badRequest("Ticket type does not belong to this event", [
        {
          path: ["ticketTypes"],
          message: "Ticket type must belong to the event being edited"
        }
      ]);
    }

    const removedTicketTypes = existingEvent.ticketTypes.filter(
      (ticketType) => !uniqueSubmittedIds.has(ticketType.id)
    );
    const soldRemovedTicketType = removedTicketTypes.find(
      (ticketType) =>
        ticketType._count.orders > 0 || ticketType._count.tickets > 0
    );

    if (soldRemovedTicketType) {
      return badRequest("Ticket type cannot be deleted after sales", [
        {
          path: ["ticketTypes"],
          message:
            "Ticket types with existing orders or issued tickets must be kept"
        }
      ]);
    }

    const modifiedSoldTicketType = submittedTicketTypes.find((ticketType) => {
      if (!ticketType.id) {
        return false;
      }

      const existingTicketType = existingTicketTypesById.get(ticketType.id);

      return Boolean(
        existingTicketType &&
          (existingTicketType._count.orders > 0 ||
            existingTicketType._count.tickets > 0) &&
          (existingTicketType.name !== ticketType.name ||
            existingTicketType.price !== ticketType.price ||
            existingTicketType.quantity !== ticketType.quantity)
      );
    });

    if (modifiedSoldTicketType) {
      return badRequest("Ticket type cannot be modified after sales", [
        {
          path: ["ticketTypes"],
          message:
            "Ticket types with existing orders or issued tickets cannot be edited"
        }
      ]);
    }

    const event = await prisma.$transaction(async (transaction) => {
      await transaction.event.update({
        where: { id: eventId },
        data: {
          title: validation.data.title,
          description: validation.data.description,
          startTime: validation.data.startTime,
          endTime: validation.data.endTime,
          location: validation.data.location
        }
      });

      const removedTicketTypeIds = removedTicketTypes.map(
        (ticketType) => ticketType.id
      );

      if (removedTicketTypeIds.length > 0) {
        await transaction.ticketType.deleteMany({
          where: {
            eventId,
            id: { in: removedTicketTypeIds }
          }
        });
      }

      await Promise.all(
        submittedTicketTypes.map((ticketType) => {
          if (ticketType.id) {
            return transaction.ticketType.update({
              where: { id: ticketType.id },
              data: {
                name: ticketType.name,
                price: ticketType.price,
                quantity: ticketType.quantity
              }
            });
          }

          return transaction.ticketType.create({
            data: {
              eventId,
              name: ticketType.name,
              price: ticketType.price,
              quantity: ticketType.quantity
            }
          });
        })
      );

      return transaction.event.findUniqueOrThrow({
        where: { id: eventId },
        select: eventSelect
      });
    });

    return NextResponse.json({ event });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationMismatchError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["organisationId"], message: error.message },
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    console.error("Failed to update event", { eventId, error });
    return internalError();
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const { eventId } = await context.params;

  try {
    const existingEvent = await prisma.event.findFirst({
      where: { id: eventId },
      select: {
        id: true,
        organisationId: true,
        _count: {
          select: {
            orders: true,
            tickets: true
          }
        }
      }
    });

    if (!existingEvent) {
      return notFound("Event was not found in this organisation");
    }

    await requireEventManagementAccess(existingEvent.organisationId);

    if (existingEvent._count.orders > 0 || existingEvent._count.tickets > 0) {
      return badRequest("Event cannot be deleted after orders or tickets exist", [
        {
          path: ["eventId"],
          message:
            "Keep this event for order and ticket history instead of deleting it"
        }
      ]);
    }

    await prisma.event.delete({
      where: { id: eventId }
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return unauthorized();
    }

    if (error instanceof OrganisationAccessError) {
      return forbidden(error.message);
    }

    if (error instanceof OrganisationScopeError) {
      return badRequest(error.message, [
        { path: ["x-org-id"], message: error.message }
      ]);
    }

    console.error("Failed to delete event", { eventId, error });
    return internalError();
  }
}
