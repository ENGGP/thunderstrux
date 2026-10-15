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
export async function readEventInventory(
  tx: InventoryClient,
  eventId: string,
  now: Date
): Promise<EventInventory> {
  const [event] = await tx.$queryRaw<Array<{ capacity: number | null; issued: number }>>`
    SELECT "capacity",
      (SELECT COUNT(*)::int FROM "Ticket" WHERE "eventId" = ${eventId} AND "validity" = 'active') AS "issued"
    FROM "Event" WHERE "id" = ${eventId}
  `;
  const holds = await tx.$queryRaw<Array<{ ticketTypeId: string; held: number }>>`
    SELECT "ticketTypeId", SUM("quantity")::int AS "held"
    FROM "TicketReservation"
    WHERE "eventId" = ${eventId} AND "status" = 'active' AND "expiresAt" > ${now}
    GROUP BY "ticketTypeId"
  `;
  const holdsByType = new Map(holds.map((row) => [row.ticketTypeId, row.held]));
  const held = holds.reduce((total, row) => total + row.held, 0);
  const issued = event?.issued ?? 0;

  return { capacity: event?.capacity ?? null, occupancy: issued + held, issued, holdsByType };
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
