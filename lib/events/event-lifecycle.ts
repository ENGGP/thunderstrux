import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { scopedByOrganisation } from "@/lib/db/organisation-scope";
import {
  eventReadiness,
  MEMBERS_ONLY_EVENTS_ENABLED,
  salesOpen
} from "@/lib/events/event-readiness";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import {
  createEventSchema,
  createScopedTicketTypeSchema,
  eventPublicationSchema,
  eventSaleStateSchema,
  updateEventSchema
} from "@/lib/validators/events";

type CreateEventInput = z.infer<typeof createEventSchema>;
type UpdateEventInput = z.infer<typeof updateEventSchema>;
type EventPublicationInput = z.infer<typeof eventPublicationSchema>;
type EventSaleStateInput = z.infer<typeof eventSaleStateSchema>;
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

export class EventLifecycleConflictError extends Error {
  constructor(message = "This event changed since you opened it. Reload it to see the latest version.") {
    super(message);
    this.name = "EventLifecycleConflictError";
  }
}

function rejectMembersOnly(visibility: string | undefined) {
  if (visibility === "members_only" && !MEMBERS_ONLY_EVENTS_ENABLED) {
    throw new EventLifecycleValidationError("Members-only events are not available yet", [
      { path: ["visibility"], message: "Members-only events become available with memberships" }
    ]);
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
  capacity: true,
  visibility: true,
  salesCloseAt: true,
  saleState: true,
  version: true,
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
  description: true,
  location: true,
  startTime: true,
  endTime: true,
  status: true,
  visibility: true,
  salesCloseAt: true,
  saleState: true,
  version: true,
  ticketTypes: { select: { id: true, price: true, quantity: true } },
  organisation: { select: { stripeAccountId: true, stripeChargesEnabled: true } },
  _count: { select: { orders: true, tickets: true } }
} satisfies Prisma.EventSelect;

// The publish reason comes from the shared readiness rules and the other texts
// mirror the unpublish and delete rules below, so the UI can say why an action
// is unavailable; the mutations still enforce them.
function toDashboardEvent(
  event: Prisma.EventGetPayload<{ select: typeof dashboardEventSelect }>,
  now = new Date()
) {
  const remaining = event.ticketTypes.reduce((total, ticketType) => total + ticketType.quantity, 0);
  const readiness = eventReadiness(event, { chargesReady: isOrganisationStripeReady(event.organisation), now });

  return {
    id: event.id,
    title: event.title,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    status: event.status,
    visibility: event.visibility,
    saleState: event.saleState,
    salesCloseAt: event.salesCloseAt,
    salesOpen: readiness.salesOpen,
    version: event.version,
    ticketTypeCount: event.ticketTypes.length,
    remaining,
    publishBlocker: event.status === "draft" ? readiness.blockers[0]?.message ?? null : null,
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

// Titles for an event filter, newest first.
export function listEventOptions(organisationId: string) {
  return prisma.event.findMany({
    where: { organisationId },
    orderBy: [{ startTime: "desc" }, { id: "asc" }],
    take: 100,
    select: { id: true, title: true }
  });
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

  rejectMembersOnly(input.visibility);

  return prisma.$transaction(async (transaction) => {
    const event = await transaction.event.create({
      data: {
      organisationId,
      title: input.title,
      description: input.description,
      startTime: input.startTime,
      endTime: input.endTime,
      location: input.location,
      // Always a draft: publishing goes through the readiness-checked transition.
      status: "draft",
      capacity: input.capacity ?? null,
      visibility: input.visibility ?? "public",
      salesCloseAt: input.salesCloseAt ?? input.startTime,
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
      version: true,
      startTime: true,
      salesCloseAt: true,
      capacity: true,
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

  if (existingEvent.version !== input.version) {
    throw new EventLifecycleConflictError();
  }

  rejectMembersOnly(input.visibility);
  // A close time still at its default follows the start time; an explicit one stays.
  const salesCloseAt =
    input.salesCloseAt ??
    (existingEvent.salesCloseAt.getTime() === existingEvent.startTime.getTime()
      ? input.startTime
      : existingEvent.salesCloseAt);

  if (salesCloseAt > input.endTime) {
    throw new EventLifecycleValidationError("Ticket sales must close before the event ends", [
      { path: ["salesCloseAt"], message: "Ticket sales must close before the event ends" }
    ]);
  }

  const capacity = input.capacity === undefined ? existingEvent.capacity : input.capacity;

  if (capacity !== null) {
    // shortcut: unlocked read, so a checkout committing now can slip past; T12 moves this under the event lock.
    const [issued, held] = await Promise.all([
      prisma.ticket.count({ where: { eventId: existingEvent.id, validity: "active" } }),
      prisma.ticketReservation.aggregate({
        where: { eventId: existingEvent.id, status: "active", expiresAt: { gt: new Date() } },
        _sum: { quantity: true }
      })
    ]);
    const committed = issued + (held._sum.quantity ?? 0);

    if (capacity < committed) {
      throw new EventLifecycleValidationError("Capacity is below tickets already issued or held", [
        { path: ["capacity"], message: `Capacity cannot be below the ${committed} tickets already issued or held` }
      ]);
    }
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
    const updated = await transaction.event.updateMany({
      where: { id: existingEvent.id, version: input.version },
      data: {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        location: input.location,
        capacity,
        salesCloseAt,
        ...(input.visibility ? { visibility: input.visibility } : {}),
        version: { increment: 1 },
        ...(input.compensationRefundMode
          ? { compensationRefundMode: input.compensationRefundMode }
          : {})
      }
    });

    if (updated.count === 0) {
      throw new EventLifecycleConflictError();
    }

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

const transitionSelect = {
  id: true,
  status: true,
  version: true,
  title: true,
  description: true,
  location: true,
  startTime: true,
  endTime: true,
  salesCloseAt: true,
  saleState: true,
  visibility: true,
  ticketTypes: { select: { id: true, price: true, quantity: true } },
  organisation: { select: { stripeAccountId: true, stripeChargesEnabled: true } },
  _count: { select: { orders: true } }
} satisfies Prisma.EventSelect;

async function findTransitionEvent(organisationId: string, eventId: string) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: transitionSelect
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  return event;
}

// Moves an event to an explicit target status. Asking for the status it already
// has is a no-op, so a retried request cannot flip it back; a stale version is a
// conflict. Publishing applies the shared readiness rules.
export async function setOrganisationEventPublication(
  organisationId: string,
  eventId: string,
  { targetStatus, version }: EventPublicationInput,
  actorUserId?: string
) {
  const event = await findTransitionEvent(organisationId, eventId);

  if (event.status !== targetStatus) {
    if (event.version !== version) {
      throw new EventLifecycleConflictError();
    }

    if (targetStatus === "published") {
      const readiness = eventReadiness(event, { chargesReady: isOrganisationStripeReady(event.organisation) });

      if (!readiness.publishable) {
        throw new EventLifecycleValidationError(
          "Event is not ready to publish",
          readiness.blockers.map((blocker) => ({ path: [blocker.field], message: blocker.message }))
        );
      }
    } else if (event._count.orders > 0) {
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

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.event.updateMany({
        where: { id: event.id, version, status: event.status },
        data: { status: targetStatus, version: { increment: 1 } }
      });

      if (updated.count === 0) {
        throw new EventLifecycleConflictError();
      }

      await transaction.auditLog.create({
        data: {
          organisationId,
          actorUserId: actorUserId ?? null,
          action: targetStatus === "published" ? "event.published" : "event.unpublished",
          targetType: "Event",
          targetId: event.id,
          metadata: { version: version + 1 }
        }
      });
    });
  }

  return prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: eventSelect });
}

// Closes or reopens ticket sales without changing publication.
export async function setOrganisationEventSaleState(
  organisationId: string,
  eventId: string,
  { saleState, version }: EventSaleStateInput,
  actorUserId?: string
) {
  const event = await findTransitionEvent(organisationId, eventId);

  if (event.saleState !== saleState) {
    if (event.version !== version) {
      throw new EventLifecycleConflictError();
    }

    if (saleState === "open" && !salesOpen({ saleState, salesCloseAt: event.salesCloseAt })) {
      throw new EventLifecycleValidationError("The sales close time has passed", [
        { path: ["salesCloseAt"], message: "Move the sales close time later before reopening sales" }
      ]);
    }

    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.event.updateMany({
        where: { id: event.id, version, saleState: event.saleState },
        data: { saleState, version: { increment: 1 } }
      });

      if (updated.count === 0) {
        throw new EventLifecycleConflictError();
      }

      await transaction.auditLog.create({
        data: {
          organisationId,
          actorUserId: actorUserId ?? null,
          action: saleState === "closed" ? "event.sales_closed" : "event.sales_reopened",
          targetType: "Event",
          targetId: event.id,
          metadata: { version: version + 1 }
        }
      });
    });
  }

  return prisma.event.findUniqueOrThrow({ where: { id: event.id }, select: eventSelect });
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
    await transaction.event.update({ where: { id: event.id }, data: { version: { increment: 1 } } });
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
