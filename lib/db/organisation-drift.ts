import { prisma } from "@/lib/db";

const tables = ["Order", "Ticket", "TicketReservation"] as const;
const batchSize = 500;

async function mismatchCount(table: (typeof tables)[number]) {
  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}" row JOIN "Event" event ON event."id" = row."eventId" WHERE row."organisationId" <> event."organisationId"`
  );
  return Number(count);
}

async function incompatibleEventCount(table: "Ticket" | "TicketReservation") {
  const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*)::bigint AS count FROM "${table}" row JOIN "Order" linked ON linked."id" = row."orderId" WHERE row."eventId" <> linked."eventId"`
  );
  return Number(count);
}

export async function repairOrganisationDrift({ apply = false }: { apply?: boolean } = {}) {
  const initial = await Promise.all(tables.map(async (table) => ({
    table, found: await mismatchCount(table), repaired: 0
  })));
  if (!apply) return initial;
  for (const table of ["Ticket", "TicketReservation"] as const) {
    if (await incompatibleEventCount(table)) {
      throw new Error(`${table} event/order relationship mismatch; repair requires manual review`);
    }
  }
  for (const row of initial) {
    while (true) {
      const changed = await prisma.$executeRawUnsafe(
        `UPDATE "${row.table}" row SET "organisationId" = event."organisationId" FROM "Event" event WHERE row."id" IN (SELECT candidate."id" FROM "${row.table}" candidate JOIN "Event" owner ON owner."id" = candidate."eventId" WHERE candidate."organisationId" <> owner."organisationId" ORDER BY candidate."id" LIMIT ${batchSize}) AND event."id" = row."eventId" AND row."organisationId" <> event."organisationId"`
      );
      if (changed === 0) break;
      row.repaired += changed;
    }
    if (await mismatchCount(row.table)) throw new Error(`${row.table} drift remains after repair`);
  }
  return initial;
}
