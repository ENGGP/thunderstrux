import type { Prisma } from "@prisma/client";
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
  compensationRefundMode: true,
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

export const eventViews = ["upcoming", "drafts", "past", "all"] as const;
export type EventView = (typeof eventViews)[number];

const dashboardEventSelect = {
  id: true,
  title: true,
  location: true,
  startTime: true,
  endTime: true,
  status: true,
  ticketTypes: { select: { quantity: true } },
  _count: { select: { orders: true, tickets: true } }
} satisfies Prisma.EventSelect;

// The blocker texts mirror the publish, unpublish and delete rules below so the
// UI can say why an action is unavailable; the mutations still enforce them.
function toDashboardEvent(
  event: Prisma.EventGetPayload<{ select: typeof dashboardEventSelect }>
) {
  const remaining = event.ticketTypes.reduce((total, ticketType) => total + ticketType.quantity, 0);

  return {
    id: event.id,
    title: event.title,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    status: event.status,
    ticketTypeCount: event.ticketTypes.length,
    remaining,
    publishBlocker:
      event.status !== "draft"
        ? null
        : event.ticketTypes.length === 0
          ? "Add a ticket type before publishing."
          : remaining <= 0
            ? "Add ticket quantity before publishing."
            : null,
    unpublishBlocker:
      event.status === "published" && event._count.orders > 0
        ? "This event has orders, so it stays published."
        : null,
    deleteBlocker:
      event._count.orders > 0 || event._count.tickets > 0
        ? "Events with orders or tickets cannot be deleted."
        : null
  };
}

export type DashboardEvent = ReturnType<typeof toDashboardEvent>;

// One view of the dashboard events list (at most `take` rows), the count for
// every view, and tickets sold per event only when the caller may see sales.
// Upcoming means not yet ended, so an event in progress still shows there.
export async function listDashboardEvents(
  organisationId: string,
  {
    view,
    query,
    publishedOnly,
    includeSales,
    take = 100
  }: {
    view: EventView;
    query?: string;
    publishedOnly: boolean;
    includeSales: boolean;
    take?: number;
  }
) {
  const now = new Date();
  const base: Prisma.EventWhereInput = {
    organisationId,
    ...(publishedOnly ? { status: "published" as const } : {}),
    ...(query ? { title: { contains: query, mode: "insensitive" as const } } : {})
  };
  const viewWhere: Record<EventView, Prisma.EventWhereInput> = {
    upcoming: { endTime: { gte: now } },
    drafts: { status: "draft" },
    past: { endTime: { lt: now } },
    all: {}
  };
  const [rows, counts] = await Promise.all([
    prisma.event.findMany({
      where: { AND: [base, viewWhere[view]] },
      orderBy: [{ startTime: view === "past" ? "desc" : "asc" }, { id: "asc" }],
      take,
      select: dashboardEventSelect
    }),
    Promise.all(
      eventViews.map((name) => prisma.event.count({ where: { AND: [base, viewWhere[name]] } }))
    )
  ]);
  const sold =
    includeSales && rows.length > 0
      ? await prisma.order.groupBy({
          by: ["eventId"],
          where: {
            eventId: { in: rows.map((row) => row.id) },
            event: { is: { organisationId } },
            status: "paid"
          },
          _sum: { quantity: true }
        })
      : [];
  const soldByEvent = new Map(sold.map((group) => [group.eventId, group._sum.quantity ?? 0]));

  return {
    events: rows.map((row) => ({
      ...toDashboardEvent(row),
      sold: includeSales ? soldByEvent.get(row.id) ?? 0 : null
    })),
    counts: Object.fromEntries(eventViews.map((name, index) => [name, counts[index]])) as Record<
      EventView,
      number
    >
  };
}

export async function getDashboardEvent(organisationId: string, eventId: string) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: dashboardEventSelect
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  return toDashboardEvent(event);
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
  input: CreateEventInput,
  actorUserId?: string
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

  return prisma.$transaction(async (transaction) => {
    const event = await transaction.event.create({
      data: {
      organisationId,
      title: input.title,
      description: input.description,
      startTime: input.startTime,
      endTime: input.endTime,
      location: input.location,
      status: input.status,
      compensationRefundMode: input.compensationRefundMode,
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
    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.created",
        targetType: "Event",
        targetId: event.id
      }
    });
    return event;
  });
}

export async function updateOrganisationEvent(
  organisationId: string,
  eventId: string,
  input: UpdateEventInput,
  actorUserId?: string
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
        location: input.location,
        ...(input.compensationRefundMode
          ? { compensationRefundMode: input.compensationRefundMode }
          : {})
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

    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.updated",
        targetType: "Event",
        targetId: existingEvent.id
      }
    });

    return transaction.event.findUniqueOrThrow({
      where: { id: existingEvent.id },
      select: eventSelect
    });
  });
}

export async function toggleOrganisationEventPublished(
  organisationId: string,
  eventId: string,
  actorUserId?: string
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

    return prisma.$transaction(async (transaction) => {
      const updated = await transaction.event.update({
        where: { id: event.id },
        data: { status: "published" },
        select: eventSelect
      });
      await transaction.auditLog.create({
        data: {
          organisationId,
          actorUserId: actorUserId ?? null,
          action: "event.published",
          targetType: "Event",
          targetId: event.id
        }
      });
      return updated;
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

  return prisma.$transaction(async (transaction) => {
    const updated = await transaction.event.update({
      where: { id: event.id },
      data: { status: "draft" },
      select: eventSelect
    });
    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.unpublished",
        targetType: "Event",
        targetId: event.id
      }
    });
    return updated;
  });
}

export async function deleteOrganisationEvent(
  organisationId: string,
  eventId: string,
  actorUserId?: string
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

  await prisma.$transaction(async (transaction) => {
    await transaction.event.delete({ where: { id: event.id } });
    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.deleted",
        targetType: "Event",
        targetId: event.id
      }
    });
  });
}

export async function createOrganisationEventTicketType(
  organisationId: string,
  eventId: string,
  input: CreateTicketTypeInput,
  actorUserId?: string
) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: { id: true }
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  return prisma.$transaction(async (transaction) => {
    const ticketType = await transaction.ticketType.create({
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
    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "ticket_type.created",
        targetType: "TicketType",
        targetId: ticketType.id,
        metadata: { eventId }
      }
    });
    return ticketType;
  });
}
