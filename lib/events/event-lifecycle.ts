import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { recordEventChange } from "@/lib/events/event-changes";
import { scopedByOrganisation } from "@/lib/db/organisation-scope";
import { eventReadiness, salesOpen } from "@/lib/events/event-readiness";
import { assetReferenced } from "@/lib/assets/references";
import { lockEventInventory, readEventInventory } from "@/lib/events/inventory";
import { entitlementOnSale } from "@/lib/memberships/offers";
import { ascendingCursorWhere, descendingCursorWhere, orderByForDirection, pageInfoForPage, readCursorOrFirstPage, type PaginationDirection } from "@/lib/pagination/cursor";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import {
  createEventSchema,
  eventPublicationSchema,
  eventSaleStateSchema,
  updateEventSchema
} from "@/lib/validators/events";

type CreateEventInput = z.infer<typeof createEventSchema>;
type UpdateEventInput = z.infer<typeof updateEventSchema>;
type EventPublicationInput = z.infer<typeof eventPublicationSchema>;
type EventSaleStateInput = z.infer<typeof eventSaleStateSchema>;

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

// A cancelled event (EVT-004) keeps its page and history but changes no more.
function refuseCancelled(event: { cancelledAt: Date | null }) {
  if (event.cancelledAt) {
    throw new EventLifecycleValidationError("This event was cancelled", [{ path: ["eventId"], message: "A cancelled event can't be edited, published or put back on sale" }]);
  }
}

// The image must be a ready event image of this society. Callers hold the
// Event lock (or are creating the event); the Asset row is locked after it.
async function assertHeroAsset(tx: Prisma.TransactionClient, organisationId: string, heroAssetId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Asset" WHERE "id" = ${heroAssetId} AND "organisationId" = ${organisationId} FOR UPDATE`;
  const asset = await tx.asset.findFirst({
    where: { id: heroAssetId, organisationId, kind: "event", status: "ready", deletedAt: null },
    select: { id: true }
  });

  if (!asset) {
    throw new EventLifecycleValidationError("Choose an event image uploaded for this society", [
      { path: ["heroAssetId"], message: "That image is no longer available. Upload it again, then save." }
    ]);
  }
}

// Whether a published plan still to end unlocks members-only events, asked
// only when one of these events is members-only.
async function membersOnlyReadyFor(organisationId: string, events: Array<{ visibility: string }>) {
  return events.some((event) => event.visibility === "members_only") && (await entitlementOnSale(organisationId, "members_only_events"));
}

// Images that lost or gained a reference start or stop their cleanup delay.
async function refreshAssetReferences(tx: Prisma.TransactionClient, ids: Array<string | null | undefined>) {
  for (const id of [...new Set(ids.filter((value): value is string => Boolean(value)))].sort()) {
    await tx.asset.update({ where: { id }, data: { unreferencedAt: (await assetReferenced(tx, id)) ? null : new Date() } });
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
  heroAssetId: true,
  heroAlt: true,
  compensationRefundMode: true,
  checkoutHoldMinutes: true,
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
  capacity: true,
  heroAssetId: true,
  cancelledAt: true,
  ticketTypes: { select: { id: true, price: true, quantity: true } },
  organisation: { select: { stripeAccountId: true, stripeChargesEnabled: true, timeZone: true } },
  _count: { select: { orders: true, tickets: true } }
} satisfies Prisma.EventSelect;

// The publish reason comes from the shared readiness rules and the other texts
// mirror the unpublish and delete rules below, so the UI can say why an action
// is unavailable; the mutations still enforce them.
function toDashboardEvent(
  event: Prisma.EventGetPayload<{ select: typeof dashboardEventSelect }>,
  membersOnlyReady: boolean,
  now = new Date()
) {
  const remaining = event.ticketTypes.reduce((total, ticketType) => total + ticketType.quantity, 0);
  const readiness = eventReadiness(event, { chargesReady: isOrganisationStripeReady(event.organisation), membersOnlyReady, now });

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime: event.startTime,
    endTime: event.endTime,
    status: event.status,
    visibility: event.visibility,
    saleState: event.saleState,
    salesCloseAt: event.salesCloseAt,
    salesOpen: readiness.salesOpen,
    version: event.version,
    capacity: event.capacity,
    heroAssetId: event.heroAssetId,
    cancelledAt: event.cancelledAt,
    timeZone: event.organisation.timeZone,
    ticketTypeCount: event.ticketTypes.length,
    remaining,
    // shortcut: counts remaining stock only, not holds or capacity; use sellableQuantity if lists need it.
    soldOut: event.ticketTypes.length > 0 && remaining <= 0,
    // Every readiness blocker, for the checklist; the first is the Publish reason.
    blockers: readiness.blockers,
    warnings: readiness.warnings,
    publishBlocker: event.status === "draft" ? readiness.blockers[0]?.message ?? null : null,
    reopenBlocker:
      event.saleState === "closed" && event.salesCloseAt <= now
        ? "The sales close time has passed. Move it later on the Edit page first."
        : null,
    unpublishBlocker:
      event.status === "published" && event._count.orders > 0
        ? "This event has orders, so it stays published."
        : null,
    deleteBlocker:
      event._count.orders > 0 || event._count.tickets > 0
        ? "Events with orders or tickets cannot be deleted."
        : null,
    // Mirrors cancelOrganisationEvent (lib/events/event-cancellation.ts).
    cancelBlocker:
      event.status !== "published"
        ? "Only a published event can be cancelled. Delete a draft instead."
        : event.endTime <= now
          ? "This event has ended. Refund single orders from Orders."
          : null
  };
}

export type DashboardEvent = ReturnType<typeof toDashboardEvent>;

// One page of a dashboard events view (`take` rows, a page either way from a
// cursor), the count for every view, and tickets sold per event only when the
// caller may see sales. Upcoming means not yet ended, so an event in progress
// still shows there. Upcoming and Drafts run soonest first; Past and All newest
// first. An unreadable cursor starts again from the first page (`restarted`).
export async function listDashboardEvents(
  organisationId: string,
  {
    view,
    query,
    publishedOnly,
    includeSales,
    take = 25,
    cursor,
    direction
  }: {
    view: EventView;
    query?: string;
    publishedOnly: boolean;
    includeSales: boolean;
    take?: number;
    cursor?: string;
    direction?: PaginationDirection;
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
  const order = view === "past" || view === "all" ? "desc" : "asc";
  const from = readCursorOrFirstPage("startTime", cursor, direction);
  const after = from.at ? [(order === "asc" ? ascendingCursorWhere : descendingCursorWhere)("startTime", from.at, from.direction)] : [];
  const [found, counts] = await Promise.all([
    prisma.event.findMany({
      where: { AND: [base, viewWhere[view], ...after] },
      orderBy: orderByForDirection("startTime", from.direction, order),
      take: take + 1,
      select: dashboardEventSelect
    }),
    Promise.all(
      eventViews.map((name) => prisma.event.count({ where: { AND: [base, viewWhere[name]] } }))
    )
  ]);
  const page = pageInfoForPage({ items: found, limit: take, direction: from.direction, cursor: from.cursor, timestampField: "startTime" });
  const rows = page.items;
  // Tickets that still admit someone, as the event page and analytics count them:
  // refunded, cancelled and disputed tickets aren't sold (DEBT-002).
  const sold =
    includeSales && rows.length > 0
      ? await prisma.ticket.groupBy({
          by: ["eventId"],
          where: {
            eventId: { in: rows.map((row) => row.id) },
            event: { is: { organisationId } },
            validity: "active"
          },
          _count: true
        })
      : [];
  const soldByEvent = new Map(sold.map((group) => [group.eventId, group._count]));
  const membersOnlyReady = await membersOnlyReadyFor(organisationId, rows);

  return {
    events: rows.map((row) => ({
      ...toDashboardEvent(row, membersOnlyReady),
      sold: includeSales ? soldByEvent.get(row.id) ?? 0 : null
    })),
    counts: Object.fromEntries(eventViews.map((name, index) => [name, counts[index]])) as Record<
      EventView,
      number
    >,
    nextCursor: page.pageInfo.nextCursor,
    previousCursor: page.pageInfo.previousCursor,
    restarted: Boolean(cursor) && !from.at
  };
}

// Titles for an event filter, the 100 newest first, plus the selected event when
// it's older, so a filter reached from an old event's "View orders" still shows it (UI-025).
export async function listEventOptions(organisationId: string, selectedId?: string) {
  const options = await prisma.event.findMany({
    where: { organisationId },
    orderBy: [{ startTime: "desc" }, { id: "asc" }],
    take: 100,
    select: { id: true, title: true }
  });
  if (!selectedId || options.some((option) => option.id === selectedId)) return options;
  const selected = await prisma.event.findFirst({ where: { id: selectedId, organisationId }, select: { id: true, title: true } });
  return selected ? [...options, selected] : options;
}

export async function getDashboardEvent(organisationId: string, eventId: string) {
  const event = await prisma.event.findFirst({
    where: scopedByOrganisation(organisationId, { id: eventId }),
    select: dashboardEventSelect
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  const inventory = await readEventInventory(prisma, event.id, new Date());
  return {
    ...toDashboardEvent(event, await membersOnlyReadyFor(organisationId, [event])),
    // Issued tickets plus live checkout holds, against the capacity.
    occupancy: inventory.occupancy,
    heldByType: Object.fromEntries(inventory.holdsByType) as Record<string, number>
  };
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
          memberPrice: true,
          quantity: true,
          hidden: true,
          _count: { select: { orders: true, tickets: true } }
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  if (!event) {
    throw new EventLifecycleNotFoundError();
  }

  // Advisory numbers for the builder; the save re-checks them under the Event lock.
  const [inventory, issued] = await Promise.all([
    readEventInventory(prisma, event.id, new Date()),
    prisma.ticket.groupBy({ by: ["ticketTypeId"], where: { eventId: event.id, validity: "active" }, _count: true })
  ]);
  const issuedByType = new Map(issued.map((row) => [row.ticketTypeId, row._count]));

  return {
    ...event,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    salesCloseAt: event.salesCloseAt.toISOString(),
    occupancy: inventory.occupancy,
    ticketTypes: event.ticketTypes.map((ticketType) => ({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price,
      memberPrice: ticketType.memberPrice,
      quantity: ticketType.quantity,
      hidden: ticketType.hidden,
      ordersCount: ticketType._count.orders,
      ticketsCount: ticketType._count.tickets,
      sold: issuedByType.get(ticketType.id) ?? 0,
      held: inventory.holdsByType.get(ticketType.id) ?? 0
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
    if (input.heroAssetId) await assertHeroAsset(transaction, organisationId, input.heroAssetId);
    const event = await transaction.event.create({
      data: {
      organisationId,
      heroAssetId: input.heroAssetId ?? null,
      // A description only means something with an image.
      heroAlt: input.heroAssetId ? input.heroAlt || null : null,
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
      checkoutHoldMinutes: input.checkoutHoldMinutes,
      ticketTypes: {
        create: input.ticketTypes.map((ticketType) => ({
          name: ticketType.name,
          price: ticketType.price,
          memberPrice: ticketType.memberPrice ?? null,
          quantity: ticketType.quantity,
          hidden: ticketType.hidden ?? false
        }))
      }
    },
      select: eventSelect
    });
    await refreshAssetReferences(transaction, [event.heroAssetId]);
    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.created",
        targetType: "Event",
        targetId: event.id,
        metadata: { title: event.title }
      }
    });
    return event;
  });
}

type EventFacts = {
  title: string; description: string; startTime: Date; endTime: Date; location: string; capacity: number | null;
  salesCloseAt: Date; visibility: string; heroAssetId: string | null; heroAlt: string | null; checkoutHoldMinutes: number;
};

// What an edit changed, for History (T38): before and after for each field,
// "changed" for the description, and ticket types added, removed or edited.
function eventChanges(
  before: EventFacts & { ticketTypes: Array<{ id: string; name: string; price: number; quantity: number; hidden: boolean }> },
  after: EventFacts & { ticketTypes: Array<{ id?: string; name: string; price: number; quantity: number; hidden?: boolean }>; removedTicketTypeIds: string[] }
): Prisma.InputJsonArray {
  const value = (fact: unknown) => (fact instanceof Date ? fact.toISOString() : (fact as string | number | null));
  const fields = ["title", "startTime", "endTime", "location", "capacity", "salesCloseAt", "visibility", "checkoutHoldMinutes"] as const;
  const changes: Prisma.InputJsonObject[] = fields
    .filter((field) => value(before[field]) !== value(after[field]))
    .map((field) => ({ field, before: value(before[field]), after: value(after[field]) }));
  if (before.description !== after.description) changes.push({ field: "description" });
  if (before.heroAssetId !== after.heroAssetId) changes.push({ field: "heroAssetId", after: Boolean(after.heroAssetId) });
  if (before.heroAlt !== after.heroAlt) changes.push({ field: "heroAlt" });
  const existing = new Map(before.ticketTypes.map((ticketType) => [ticketType.id, ticketType]));
  const added = after.ticketTypes.filter((ticketType) => !ticketType.id).map((ticketType) => ticketType.name);
  const removed = after.removedTicketTypeIds.map((id) => existing.get(id)?.name ?? "A ticket type");
  const changed = after.ticketTypes.flatMap((ticketType) => {
    const was = ticketType.id ? existing.get(ticketType.id) : undefined;
    if (!was) return [];
    const edit: Record<string, string | number[] | boolean> = { name: ticketType.name };
    if (was.name !== ticketType.name) edit.renamedFrom = was.name;
    if (was.price !== ticketType.price) edit.price = [was.price, ticketType.price];
    if (was.quantity !== ticketType.quantity) edit.quantity = [was.quantity, ticketType.quantity];
    if (ticketType.hidden !== undefined && was.hidden !== ticketType.hidden) edit.hidden = ticketType.hidden;
    return Object.keys(edit).length > 1 ? [edit] : [];
  });
  if (added.length || removed.length || changed.length) changes.push({ field: "ticketTypes", added, removed, changed });
  return changes;
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
      cancelledAt: true,
      ticketTypes: { select: { id: true } }
    }
  });

  if (!existingEvent) {
    throw new EventLifecycleNotFoundError();
  }
  refuseCancelled(existingEvent);

  if (existingEvent.version !== input.version) {
    throw new EventLifecycleConflictError();
  }

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

  // No list means no ticket type sync; only a submitted list can remove one.
  const ticketTypes = input.ticketTypes ?? [];
  const submittedIds = ticketTypes
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

  return prisma.$transaction(async (transaction) => {
    // Checkout and fulfilment take the same Event lock, so holds, issued tickets
    // and remaining stock cannot change while this edit decides.
    await lockEventInventory(transaction, existingEvent.id);
    const locked = await transaction.event.findUniqueOrThrow({
      where: { id: existingEvent.id },
      select: {
        version: true,
        status: true,
        heroAssetId: true,
        heroAlt: true,
        title: true,
        description: true,
        startTime: true,
        endTime: true,
        latestEndTime: true,
        location: true,
        capacity: true,
        salesCloseAt: true,
        visibility: true,
        checkoutHoldMinutes: true,
        ticketTypes: {
          select: { id: true, name: true, price: true, quantity: true, hidden: true, _count: { select: { orders: true, tickets: true } } }
        }
      }
    });

    if (locked.version !== input.version) {
      throw new EventLifecycleConflictError();
    }

    // Buyers can see a published event, so it keeps the details publishing needed.
    if (locked.status === "published") {
      const missing = (["description", "location"] as const).filter((field) => !input[field].trim());
      if (missing.length) {
        throw new EventLifecycleValidationError("A published event needs a description and location", missing.map((field) => ({ path: [field], message: `Add a ${field}.` })));
      }
    }

    // Payouts are held until two days after the end, so moving the end earlier into
    // the past would release ticket money before the event has run (SEC-004).
    if (input.endTime < locked.endTime && input.endTime <= new Date()) {
      throw new EventLifecycleValidationError("The end time can't be moved earlier into the past", [
        { path: ["endTime"], message: "Choose an end time after now" }
      ]);
    }

    const inventory = await readEventInventory(transaction, existingEvent.id, new Date());

    if (capacity !== null && capacity < inventory.occupancy) {
      throw new EventLifecycleValidationError("Capacity is below tickets already issued or held", [
        { path: ["capacity"], message: `Capacity cannot be below the ${inventory.occupancy} tickets already issued or held` }
      ]);
    }

    const lockedTicketTypes = new Map(locked.ticketTypes.map((ticketType) => [ticketType.id, ticketType]));
    const quantities = ticketTypes.map((ticketType) => {
      const current = ticketType.id ? lockedTicketTypes.get(ticketType.id)?.quantity : undefined;
      if (current === undefined || current === ticketType.expectedQuantity) return ticketType.quantity;
      // Sales moved the stock since the editor loaded it: an untouched quantity
      // keeps what is left; a changed one would overwrite sales, so reload.
      if (ticketType.quantity === ticketType.expectedQuantity) return current;
      throw new EventLifecycleConflictError("Ticket stock changed while you were editing. Reload to see the latest numbers.");
    });
    const heldDetails = ticketTypes.flatMap((ticketType, index) => {
      const held = ticketType.id ? inventory.holdsByType.get(ticketType.id) ?? 0 : 0;
      return quantities[index] < held
        ? [{ path: ["ticketTypes", String(index), "quantity"], message: `Keep at least ${held} remaining: they are held in checkouts now` }]
        : [];
    });

    if (heldDetails.length > 0) {
      throw new EventLifecycleValidationError("Remaining tickets cannot drop below active checkout holds", heldDetails);
    }

    // Types with orders or tickets are kept for history even when omitted.
    const removedTicketTypeIds = !input.ticketTypes ? [] : locked.ticketTypes
      .filter(
        (ticketType) =>
          ticketType._count.orders === 0 &&
          ticketType._count.tickets === 0 &&
          !uniqueSubmittedIds.has(ticketType.id)
      )
      .map((ticketType) => ticketType.id);

    if (input.heroAssetId && input.heroAssetId !== locked.heroAssetId) {
      await assertHeroAsset(transaction, organisationId, input.heroAssetId);
    }
    // Removing the image clears its description; an omitted description keeps the saved one.
    const heroAssetId = input.heroAssetId === undefined ? locked.heroAssetId : input.heroAssetId;
    const heroAlt = heroAssetId ? (input.heroAlt === undefined ? locked.heroAlt : input.heroAlt || null) : null;

    const updated = await transaction.event.updateMany({
      where: { id: existingEvent.id, version: input.version },
      data: {
        title: input.title,
        description: input.description,
        startTime: input.startTime,
        endTime: input.endTime,
        // SEC-032: payouts wait for the latest end ever set, active tickets or not.
        latestEndTime: new Date(Math.max((locked.latestEndTime ?? locked.endTime).getTime(), locked.endTime.getTime(), input.endTime.getTime())),
        location: input.location,
        capacity,
        salesCloseAt,
        ...(input.visibility ? { visibility: input.visibility } : {}),
        ...(input.heroAssetId !== undefined ? { heroAssetId: input.heroAssetId } : {}),
        heroAlt,
        ...(input.checkoutHoldMinutes !== undefined ? { checkoutHoldMinutes: input.checkoutHoldMinutes } : {}),
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
      ticketTypes.map((ticketType, index) =>
        ticketType.id
          ? transaction.ticketType.update({
              where: { id: ticketType.id },
              data: {
                name: ticketType.name,
                price: ticketType.price,
                memberPrice: ticketType.memberPrice ?? null,
                quantity: quantities[index],
                ...(ticketType.hidden !== undefined ? { hidden: ticketType.hidden } : {})
              }
            })
          : transaction.ticketType.create({
              data: {
                eventId: existingEvent.id,
                name: ticketType.name,
                price: ticketType.price,
                memberPrice: ticketType.memberPrice ?? null,
                quantity: quantities[index],
                hidden: ticketType.hidden ?? false
              }
            })
      )
    );

    if (input.heroAssetId !== undefined && input.heroAssetId !== locked.heroAssetId) {
      await refreshAssetReferences(transaction, [locked.heroAssetId, input.heroAssetId]);
    }

    // A new time or place emails ticket holders (T30).
    await recordEventChange(transaction, {
      eventId: existingEvent.id,
      organisationId,
      eventVersion: input.version + 1,
      actorUserId,
      before: locked,
      after: { startTime: input.startTime, endTime: input.endTime, location: input.location }
    });

    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.updated",
        targetType: "Event",
        targetId: existingEvent.id,
        metadata: {
          version: input.version + 1,
          changes: eventChanges(locked, {
            title: input.title,
            description: input.description,
            startTime: input.startTime,
            endTime: input.endTime,
            location: input.location,
            capacity,
            salesCloseAt,
            visibility: input.visibility ?? locked.visibility,
            heroAssetId,
            heroAlt,
            checkoutHoldMinutes: input.checkoutHoldMinutes ?? locked.checkoutHoldMinutes,
            ticketTypes: ticketTypes.map((ticketType, index) => ({ id: ticketType.id, name: ticketType.name, price: ticketType.price, quantity: quantities[index], hidden: ticketType.hidden })),
            removedTicketTypeIds
          })
        }
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
  cancelledAt: true,
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
    refuseCancelled(event);
    if (event.version !== version) {
      throw new EventLifecycleConflictError();
    }

    if (targetStatus === "published") {
      const readiness = eventReadiness(event, {
        chargesReady: isOrganisationStripeReady(event.organisation),
        membersOnlyReady: await membersOnlyReadyFor(organisationId, [event])
      });

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
      if (targetStatus !== "published") {
        // Checkout takes the same lock, so no order can land between this count and the change (SEC-009).
        await lockEventInventory(transaction, event.id, []);
        if (await transaction.order.count({ where: { eventId: event.id } })) {
          throw new EventLifecycleValidationError("Event cannot be unpublished after orders exist", [
            { path: ["eventId"], message: "Keep this event published for purchasers and order history" }
          ]);
        }
      }
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
    refuseCancelled(event);
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
    await lockEventInventory(transaction, event.id, []);
    const locked = await transaction.event.findUniqueOrThrow({
      where: { id: event.id },
      select: { heroAssetId: true, title: true, _count: { select: { orders: true, tickets: true } } }
    });

    if (locked._count.orders > 0 || locked._count.tickets > 0) {
      throw new EventLifecycleValidationError("Event cannot be deleted after orders or tickets exist", [
        { path: ["eventId"], message: "Keep this event for order and ticket history instead of deleting it" }
      ]);
    }

    await transaction.event.delete({ where: { id: event.id } });
    await refreshAssetReferences(transaction, [locked.heroAssetId]);
    await transaction.auditLog.create({
      data: {
        organisationId,
        actorUserId: actorUserId ?? null,
        action: "event.deleted",
        targetType: "Event",
        targetId: event.id,
        metadata: { title: locked.title }
      }
    });
  });
}
