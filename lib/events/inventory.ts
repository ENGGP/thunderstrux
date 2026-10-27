import { Prisma } from "@prisma/client";

type InventoryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

// The only place that locks Event and TicketType rows or computes sellable stock
// (readiness plan §3.2). Lock order: the buyer's User row when a path fences it,
// then the Event, then its ticket types by ascending id, then orders and holds.
// No path may lock an Order and afterwards an Event or TicketType.
export async function lockEventInventory(
  tx: InventoryClient,
  eventId: string,
  ticketTypeIds?: string[]
) {
  const events = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR UPDATE
  `;
  if (events.length === 0) return false;

  if (ticketTypeIds?.length === 0) return true;
  const onlyThese = ticketTypeIds ? Prisma.sql`AND "id" IN (${Prisma.join(ticketTypeIds)})` : Prisma.empty;
  await tx.$queryRaw`
    SELECT "id" FROM "TicketType" WHERE "eventId" = ${eventId} ${onlyThese} ORDER BY "id" FOR UPDATE
  `;
  return true;
}

export type EventInventory = {
  capacity: number | null;
  // Valid issued tickets plus active unexpired holds across every ticket type.
  occupancy: number;
  issued: number;
  holdsByType: Map<string, number>;
};

// Callers that mutate must hold lockEventInventory first; public reads call it
// unlocked as advisory stock. `now` is the transaction's one clock reading.
// A ticket under dispute review keeps its place: a won dispute restores it.
export async function readEventInventory(
  tx: InventoryClient,
  eventId: string,
  now: Date
): Promise<EventInventory> {
  return (await readEventsInventory(tx, [eventId], now)).get(eventId) ?? { capacity: null, occupancy: 0, issued: 0, holdsByType: new Map() };
}

// The same figures for many events in two queries, for public lists (UI-007).
export async function readEventsInventory(
  tx: InventoryClient,
  eventIds: string[],
  now: Date
): Promise<Map<string, EventInventory>> {
  if (eventIds.length === 0) return new Map();
  const events = await tx.$queryRaw<Array<{ id: string; capacity: number | null; issued: number }>>`
    SELECT e."id", e."capacity",
      (SELECT COUNT(*)::int FROM "Ticket" t WHERE t."eventId" = e."id" AND t."validity" <> 'void') AS "issued"
    FROM "Event" e WHERE e."id" IN (${Prisma.join(eventIds)})
  `;
  const holds = await tx.$queryRaw<Array<{ eventId: string; ticketTypeId: string; held: number }>>`
    SELECT "eventId", "ticketTypeId", SUM("quantity")::int AS "held"
    FROM "TicketReservation"
    WHERE "eventId" IN (${Prisma.join(eventIds)}) AND "status" = 'active' AND "expiresAt" > ${now}
    GROUP BY "eventId", "ticketTypeId"
  `;

  return new Map(
    events.map((event) => {
      const own = holds.filter((row) => row.eventId === event.id);
      const held = own.reduce((total, row) => total + row.held, 0);
      return [
        event.id,
        { capacity: event.capacity, occupancy: event.issued + held, issued: event.issued, holdsByType: new Map(own.map((row) => [row.ticketTypeId, row.held])) }
      ];
    })
  );
}

// Sellable = max(0, min(type remaining - type holds, capacity - occupancy)); the
// second limit is omitted when the event has no capacity.
export function sellableQuantity(
  ticketType: { id: string; quantity: number },
  inventory: EventInventory
) {
  const typeAvailable = ticketType.quantity - (inventory.holdsByType.get(ticketType.id) ?? 0);
  const eventAvailable =
    inventory.capacity === null ? typeAvailable : inventory.capacity - inventory.occupancy;
  return Math.max(0, Math.min(typeAvailable, eventAvailable));
}
