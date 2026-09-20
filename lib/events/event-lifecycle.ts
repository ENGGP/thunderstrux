import type { z } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { scopedByOrganisation } from "@/lib/db/organisation-scope";
import {
  createEventSchema,
  createScopedTicketTypeSchema,
  updateEventSchema
} from "@/lib/validators/events";

type CreateEventInput = z.infer<typeof createEventSchema>;
type UpdateEventInput = z.infer<typeof updateEventSchema>;
type CreateTicketTypeInput = z.infer<typeof createScopedTicketTypeSchema>;

export class EventLifecycleNotFoundError extends Error {
  constructor(message = "Event was not found in this organisation") {
    super(message);
    this.name = "EventLifecycleNotFoundError";
  }
}

export class EventLifecycleValidationError extends Error {
  constructor(message: string, readonly details: ApiErrorDetail[] = []) {
    super(message);
    this.name = "EventLifecycleValidationError";
  }
}

export const eventSelect = {
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
    orderBy: { createdAt: "asc" as const }
  }
} as const;

export async function listOrganisationEvents(organisationId: string) {
  return prisma.event.findMany({
    where: scopedByOrganisation(organisationId),
    orderBy: { startTime: "asc" },
    select: eventSelect
  });
}

export async function getOrganisationEvent(
  organisationId: string,
  eventId: string
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: eventSelect
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  return event;
}

export async function getOrganisationEventForEditing(
  organisationId: string,
  eventId: string
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: {
      ...eventSelect,
      ticketTypes: {
        select: {
          id: true,
          name: true,
          price: true,
          quantity: true,
          _count: { select: { orders: true, tickets: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  return {
    ...event,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    ticketTypes: event.ticketTypes.map((ticketType) => ({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price,
      quantity: ticketType.quantity,
      ordersCount: ticketType._count.orders,
      ticketsCount: ticketType._count.tickets
    }))
  };
}

export async function createOrganisationEvent(
  organisationId: string,
  input: CreateEventInput
) {
  const organisation = await prisma.organisation.findUnique({
    where: { id: organisationId },
    select: { id: true }
  });

  if (!organisation) {
    throw new EventLifecycleValidationError("Invalid organisationId", [
      { path: ["organisationId"], message: "Organisation does not exist" }
    ]);
  }

  return prisma.event.create({
    data: {
      organisationId,
      title: input.title,
      description: input.description,
      startTime: input.startTime,
      endTime: input.endTime,
      location: input.location,
      status: input.status,
      ticketTypes: {
        create: input.ticketTypes.map((ticketType) => ({
          name: ticketType.name,
          price: ticketType.price,
          quantity: ticketType.quantity
        }))
      }
    },
    select: eventSelect
  });
}

export async function updateOrganisationEvent(
  organisationId: string,
  eventId: string,
  input: UpdateEventInput
) {
  const existingEvent = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: {
      id: true,
      ticketTypes: {
        select: {
          id: true,
          _count: { select: { orders: true, tickets: true } }
        }
      }
    }
  });

  if (!existingEvent) {
    throw new EventLifecycleNotFoundError();
  }

  const submittedIds = input.ticketTypes
    .map((ticketType) => ticketType.id)
    .filter((id): id is string => Boolean(id));
  const uniqueSubmittedIds = new Set(submittedIds);

  if (uniqueSubmittedIds.size !== submittedIds.length) {
    throw new EventLifecycleValidationError(
      "Duplicate ticket type IDs are not allowed",
      [
        {
          path: ["ticketTypes"],
          message: "Each ticket type can only appear once"
        }
      ]
    );
  }

  const existingTicketTypesById = new Set(
    existingEvent.ticketTypes.map((ticketType) => ticketType.id)
  );
  const unknownTicketTypeId = submittedIds.find(
    (ticketTypeId) => !existingTicketTypesById.has(ticketTypeId)
  );

  if (unknownTicketTypeId) {
    throw new EventLifecycleValidationError(
      "Ticket type does not belong to this event",
      [
        {
          path: ["ticketTypes"],
          message: "Ticket type must belong to the event being edited"
        }
      ]
    );
  }

  const removedTicketTypeIds = existingEvent.ticketTypes
    .filter(
      (ticketType) =>
        ticketType._count.orders === 0 &&
        ticketType._count.tickets === 0 &&
        !uniqueSubmittedIds.has(ticketType.id)
    )
    .map((ticketType) => ticketType.id);

  return prisma.$transaction(async (transaction) => {
    await transaction.event.update({
      where: { id: existingEvent.id },
      data: {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        location: input.location
      }
    });

    if (removedTicketTypeIds.length > 0) {
      await transaction.ticketType.deleteMany({
        where: { eventId: existingEvent.id, id: { in: removedTicketTypeIds } }
      });
    }

    await Promise.all(
      input.ticketTypes.map((ticketType) =>
        ticketType.id
          ? transaction.ticketType.update({
              where: { id: ticketType.id },
              data: {
                name: ticketType.name,
                price: ticketType.price,
                quantity: ticketType.quantity
              }
            })
          : transaction.ticketType.create({
              data: {
                eventId: existingEvent.id,
                name: ticketType.name,
                price: ticketType.price,
                quantity: ticketType.quantity
              }
            })
      )
    );

    return transaction.event.findUniqueOrThrow({
      where: { id: existingEvent.id },
      select: eventSelect
    });
  });
}

export async function toggleOrganisationEventPublished(
  organisationId: string,
  eventId: string
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: {
      id: true,
      status: true,
      ticketTypes: { select: { quantity: true } },
      _count: { select: { orders: true } }
    }
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  if (event.status === "draft") {
    if (event.ticketTypes.length === 0) {
      throw new EventLifecycleValidationError(
        "Event needs at least one ticket type before publishing",
        [
          {
            path: ["ticketTypes"],
            message: "Add at least one ticket type before publishing this event"
          }
        ]
      );
    }

    if (
      event.ticketTypes.reduce(
        (total, ticketType) => total + ticketType.quantity,
        0
      ) <= 0
    ) {
      throw new EventLifecycleValidationError(
        "Event needs available tickets before publishing",
        [
          {
            path: ["ticketTypes"],
            message: "Total ticket quantity must be greater than zero"
          }
        ]
      );
    }

    return prisma.event.update({
      where: { id: event.id },
      data: { status: "published" },
      select: eventSelect
    });
  }

  if (event._count.orders > 0) {
    throw new EventLifecycleValidationError(
      "Event cannot be unpublished after orders exist",
      [
        {
          path: ["eventId"],
          message: "Keep this event published for purchasers and order history"
        }
      ]
    );
  }

  return prisma.event.update({
    where: { id: event.id },
    data: { status: "draft" },
    select: eventSelect
  });
}

export async function deleteOrganisationEvent(
  organisationId: string,
  eventId: string
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: {
      id: true,
      _count: { select: { orders: true, tickets: true } }
    }
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  if (event._count.orders > 0 || event._count.tickets > 0) {
    throw new EventLifecycleValidationError(
      "Event cannot be deleted after orders or tickets exist",
      [
        {
          path: ["eventId"],
          message:
            "Keep this event for order and ticket history instead of deleting it"
        }
      ]
    );
  }

  await prisma.event.delete({ where: { id: event.id } });
}

export async function createOrganisationEventTicketType(
  organisationId: string,
  eventId: string,
  input: CreateTicketTypeInput
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: { id: true }
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  return prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: input.name,
      price: input.price,
      quantity: input.quantity
    },
    select: {
      id: true,
      eventId: true,
      name: true,
      price: true,
      quantity: true,
      createdAt: true
    }
  });
}
