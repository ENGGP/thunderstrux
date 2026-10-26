import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hasOrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";
import { bucketOf, endOf, within, zeroFill, type AnalyticsRange } from "./range";

// Authoritative society metrics (readiness plan §6, T31). Every number is
// aggregated in the database from the owning facts: an event's society owns
// its ticket orders, a commerce order names its society. Totals never join
// tickets to lines or refunds to orders in a way that multiplies rows. Money
// needs orders:read as well as analytics:read; without both, money fields are
// null and the attendance, stock and engagement numbers remain.
//
// Definitions:
// - Gross: fulfilled, Stripe-paid, positive totals by fulfilment time. Pending,
//   failed, expired, payment-review and free orders are not money.
// - Refunds: Stripe-confirmed refunds of fulfilled orders by the time they were
//   confirmed. A refund reverses its share of the order's platform fee, pro
//   rata as Stripe returns it, so "Refund the rest" after a partial refund in
//   Stripe reverses only the rest's share (PAY-011). Refunds made outside
//   Thunderstrux (reported on the order) and compensation refunds of orders
//   never fulfilled, which were never sales, are not in these numbers.
// - Net sales: gross less refunds over the same days. A refund of an earlier
//   sale lowers the period it happened in, so a period can be negative.
// - Platform fees: fees on gross less fees reversed by refunds. Thunderstrux
//   does not know Stripe's processing costs or payouts, so nothing is profit.

export type AnalyticsAccess = { financial: boolean };
export const analyticsAccess = (role: OrganisationStaffRole): AnalyticsAccess => ({
  financial: hasOrganisationPermission(role, "analytics:read") && hasOrganisationPermission(role, "orders:read")
});

const n = (value: unknown) => Number(value ?? 0);
const money = (access: AnalyticsAccess, value: unknown) => (access.financial ? n(value) : null);
const sum = <Row,>(rows: Row[], key: keyof Row) => rows.reduce((total, row) => total + Number(row[key]), 0);
const paidMoney = (alias: "o" | "c") => Prisma.raw(`${alias}."paymentKind" = 'stripe' AND ${alias}."totalAmount" > 0`);
// The platform fee a refund gives back: Stripe's refund_application_fee returns it pro rata.
const feeReversed = (alias: "o" | "c") => Prisma.raw(`coalesce(sum(round(${alias}."feeAmount"::numeric * r."amount" / nullif(${alias}."totalAmount", 0))), 0)`);
const utcNow = (now: Date) => Prisma.sql`(${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

function moneySeries<Row extends { start: string; gross: number; refunded: number; fees: number; feesReversed: number }>(access: AnalyticsAccess, rows: Row[]) {
  return rows.map(({ gross, refunded, fees, feesReversed, ...row }) => ({
    ...row,
    gross: access.financial ? gross : null,
    refunded: access.financial ? refunded : null,
    net: access.financial ? gross - refunded : null,
    platformFees: access.financial ? fees - feesReversed : null
  }));
}

function moneyTotals(access: AnalyticsAccess, rows: Array<{ gross: number; refunded: number; fees: number; feesReversed: number }>) {
  const gross = sum(rows, "gross");
  const refunded = sum(rows, "refunded");
  return {
    gross: money(access, gross),
    refunded: money(access, refunded),
    net: money(access, gross - refunded),
    platformFees: money(access, sum(rows, "fees") - sum(rows, "feesReversed"))
  };
}

type Bucketed = { bucket: string } & Record<string, unknown>;
const merge = (...sets: Bucketed[][]) => {
  const rows = new Map<string, Bucketed>();
  for (const set of sets) for (const row of set) rows.set(row.bucket, { ...rows.get(row.bucket), ...row });
  return [...rows.values()];
};

// Tickets: sales, refunds, issued units, order outcomes and attendance. With
// an event, everything is that event's; otherwise attendance covers events
// that start in the range.
export async function ticketMetrics(organisationId: string, range: AnalyticsRange, access: AnalyticsAccess, eventId?: string) {
  const owned = Prisma.sql`e."organisationId" = ${organisationId} ${eventId ? Prisma.sql`AND e."id" = ${eventId}` : Prisma.empty}`;
  const fulfilled = Prisma.sql`${owned} AND o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL AND ${within(Prisma.sql`o."fulfilledAt"`, range)}`;
  const [sales, tickets, refunds, started, attendance] = await Promise.all([
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`o."fulfilledAt"`, range)} AS bucket,
        count(*) AS orders, count(*) FILTER (WHERE o."paymentKind" = 'free') AS "freeOrders",
        coalesce(sum(o."totalAmount") FILTER (WHERE ${paidMoney("o")}), 0) AS gross,
        coalesce(sum(o."feeAmount") FILTER (WHERE ${paidMoney("o")}), 0) AS fees
      FROM "Order" o JOIN "Event" e ON e."id" = o."eventId"
      WHERE ${fulfilled}
      GROUP BY 1`,
    // Tickets by their order's fulfilment, in a query of their own so order totals never multiply.
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`o."fulfilledAt"`, range)} AS bucket,
        count(*) AS issued, count(*) FILTER (WHERE t."validity" = 'active') AS valid,
        count(*) FILTER (WHERE o."paymentKind" = 'free') AS "freeIssued"
      FROM "Ticket" t JOIN "Order" o ON o."id" = t."orderId" JOIN "Event" e ON e."id" = o."eventId"
      WHERE ${fulfilled}
      GROUP BY 1`,
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`r."resolvedAt"`, range)} AS bucket, count(*) AS refunds,
        coalesce(sum(r."amount"), 0) AS refunded, ${feeReversed("o")} AS "feesReversed"
      FROM "RefundRequest" r JOIN "Order" o ON o."id" = r."orderId" JOIN "Event" e ON e."id" = o."eventId"
      WHERE ${owned} AND r."status" = 'succeeded' AND o."fulfilledAt" IS NOT NULL AND ${within(Prisma.sql`r."resolvedAt"`, range)}
      GROUP BY 1`,
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`o."createdAt"`, range)} AS bucket, count(*) AS started,
        count(*) FILTER (WHERE o."status" = 'paid') AS completed, count(*) FILTER (WHERE o."status" = 'pending') AS pending,
        count(*) FILTER (WHERE o."requiresCompensationReview") AS review,
        count(*) FILTER (WHERE o."status" IN ('failed', 'expired') AND NOT o."requiresCompensationReview") AS abandoned
      FROM "Order" o JOIN "Event" e ON e."id" = o."eventId"
      WHERE ${owned} AND ${within(Prisma.sql`o."createdAt"`, range)}
      GROUP BY 1`,
    ticketAttendance(organisationId, eventId ? { eventId } : { range })
  ]);
  const keys = ["orders", "freeOrders", "gross", "fees", "issued", "valid", "freeIssued", "refunds", "refunded", "feesReversed", "started", "completed", "pending", "review", "abandoned"] as const;
  const rows = zeroFill(range, merge(sales, tickets, refunds, started), keys);
  return {
    range,
    totals: {
      ...moneyTotals(access, rows),
      fulfilledOrders: sum(rows, "orders"),
      freeOrders: sum(rows, "freeOrders"),
      refunds: sum(rows, "refunds"),
      ticketsIssued: sum(rows, "issued"),
      ticketsValid: sum(rows, "valid"),
      ticketsFree: sum(rows, "freeIssued"),
      ordersStarted: sum(rows, "started"),
      ordersCompleted: sum(rows, "completed"),
      ordersPending: sum(rows, "pending"),
      ordersInReview: sum(rows, "review"),
      ordersAbandoned: sum(rows, "abandoned"),
      attendance
    },
    series: moneySeries(access, rows).map(({ start, gross, refunded, net, platformFees, orders, issued, started }) => ({ start, gross, refunded, net, platformFees, orders, tickets: issued, started }))
  };
}

// Valid tickets and check-ins, for one event or for events starting in a
// range. A ticket checked in and later refunded or voided is counted apart.
export async function ticketAttendance(organisationId: string, scope: { eventId: string } | { range: AnalyticsRange }) {
  const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT count(*) FILTER (WHERE t."validity" = 'active') AS valid,
      count(*) FILTER (WHERE t."validity" = 'active' AND t."checkedInAt" IS NOT NULL) AS "checkedIn",
      count(*) FILTER (WHERE t."validity" <> 'active' AND t."checkedInAt" IS NOT NULL) AS "checkedInNoLongerValid"
    FROM "Ticket" t JOIN "Order" o ON o."id" = t."orderId" JOIN "Event" e ON e."id" = o."eventId"
    WHERE e."organisationId" = ${organisationId} AND o."fulfilledAt" IS NOT NULL
      AND ${"eventId" in scope ? Prisma.sql`e."id" = ${scope.eventId}` : within(Prisma.sql`e."startTime"`, scope.range)}`;
  const valid = n(row?.valid);
  return {
    valid,
    checkedIn: n(row?.checkedIn),
    // Null when there are no valid tickets: a rate of nothing is not 0%.
    checkInRate: valid ? n(row?.checkedIn) / valid : null,
    checkedInNoLongerValid: n(row?.checkedInNoLongerValid)
  };
}

// One event's ticket types over all time: issued, valid, free and checked-in
// units, with money for finance staff. Remaining stock and holds come from
// the event's inventory read.
export async function eventTicketTypeMetrics(organisationId: string, eventId: string, access: AnalyticsAccess) {
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT tt."id", tt."name", tt."price", tt."quantity" AS remaining,
      coalesce(s.issued, 0) AS issued, coalesce(s.valid, 0) AS valid, coalesce(s."freeIssued", 0) AS "freeIssued",
      coalesce(s."checkedIn", 0) AS "checkedIn", coalesce(m.gross, 0) AS gross, coalesce(rf.refunded, 0) AS refunded
    FROM "TicketType" tt JOIN "Event" e ON e."id" = tt."eventId"
    LEFT JOIN (
      SELECT o."ticketTypeId", count(*) AS issued, count(*) FILTER (WHERE t."validity" = 'active') AS valid,
        count(*) FILTER (WHERE t."validity" = 'active' AND t."checkedInAt" IS NOT NULL) AS "checkedIn",
        count(*) FILTER (WHERE o."paymentKind" = 'free') AS "freeIssued"
      FROM "Ticket" t JOIN "Order" o ON o."id" = t."orderId"
      WHERE o."eventId" = ${eventId} AND o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL
      GROUP BY 1
    ) s ON s."ticketTypeId" = tt."id"
    LEFT JOIN (
      SELECT o."ticketTypeId", sum(o."totalAmount") AS gross
      FROM "Order" o
      WHERE o."eventId" = ${eventId} AND o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL AND ${paidMoney("o")}
      GROUP BY 1
    ) m ON m."ticketTypeId" = tt."id"
    LEFT JOIN (
      SELECT o."ticketTypeId", sum(r."amount") AS refunded
      FROM "RefundRequest" r JOIN "Order" o ON o."id" = r."orderId"
      WHERE o."eventId" = ${eventId} AND r."status" = 'succeeded' AND o."fulfilledAt" IS NOT NULL
      GROUP BY 1
    ) rf ON rf."ticketTypeId" = tt."id"
    WHERE tt."eventId" = ${eventId} AND e."organisationId" = ${organisationId}
    ORDER BY tt."createdAt", tt."id"`;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    price: n(row.price),
    remaining: n(row.remaining),
    issued: n(row.issued),
    valid: n(row.valid),
    free: n(row.freeIssued),
    checkedIn: n(row.checkedIn),
    gross: money(access, row.gross),
    refunded: money(access, row.refunded),
    net: access.financial ? n(row.gross) - n(row.refunded) : null
  }));
}

// The first and last day an event sold, in the society's zone, for its sales chart.
export async function eventSalesDays(organisationId: string, eventId: string, timeZone: string) {
  const [row] = await prisma.$queryRaw<Array<{ first: string | null; last: string | null }>>`
    SELECT to_char(min(o."fulfilledAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS first,
      to_char(max(o."fulfilledAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}), 'YYYY-MM-DD') AS last
    FROM "Order" o JOIN "Event" e ON e."id" = o."eventId"
    WHERE o."eventId" = ${eventId} AND e."organisationId" = ${organisationId} AND o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL AND ${paidMoney("o")}`;
  return row?.first && row.last ? { first: row.first, last: row.last } : null;
}

// Memberships and merchandise share the commerce order facts.
async function commerceSales(organisationId: string, kind: "membership" | "merchandise", range: AnalyticsRange) {
  return Promise.all([
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`c."fulfilledAt"`, range)} AS bucket,
        count(*) AS orders, count(*) FILTER (WHERE c."paymentKind" = 'free') AS "freeOrders",
        coalesce(sum(c."totalAmount") FILTER (WHERE ${paidMoney("c")}), 0) AS gross,
        coalesce(sum(c."feeAmount") FILTER (WHERE ${paidMoney("c")}), 0) AS fees,
        coalesce(sum(l.items), 0) AS items
      FROM "CommerceOrder" c
      CROSS JOIN LATERAL (SELECT sum("quantity") AS items FROM "CommerceOrderLine" WHERE "orderId" = c."id") l
      WHERE c."organisationId" = ${organisationId} AND c."kind" = ${kind}::"CommerceKind" AND c."status" = 'paid' AND c."fulfilledAt" IS NOT NULL
        AND ${within(Prisma.sql`c."fulfilledAt"`, range)}
      GROUP BY 1`,
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`r."resolvedAt"`, range)} AS bucket, count(*) AS refunds,
        coalesce(sum(r."amount"), 0) AS refunded, ${feeReversed("c")} AS "feesReversed"
      FROM "RefundRequest" r JOIN "CommerceOrder" c ON c."id" = r."commerceOrderId"
      WHERE c."organisationId" = ${organisationId} AND c."kind" = ${kind}::"CommerceKind" AND r."status" = 'succeeded' AND c."fulfilledAt" IS NOT NULL
        AND ${within(Prisma.sql`r."resolvedAt"`, range)}
      GROUP BY 1`
  ]);
}

// Memberships: sales and refunds, new and renewing members, and how many
// members hold a membership at the end of the range (or now, if sooner).
export async function membershipMetrics(organisationId: string, range: AnalyticsRange, access: AnalyticsAccess, now = new Date()) {
  const asOf = Prisma.sql`LEAST(${endOf(range)} - interval '1 millisecond', ${utcNow(now)})`;
  const [[sales, refunds], grants, [active]] = await Promise.all([
    commerceSales(organisationId, "membership", range),
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`g."grantedAt"`, range)} AS bucket, count(*) AS granted,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM "MembershipGrant" p
          WHERE p."userId" = g."userId" AND p."organisationId" = g."organisationId" AND p."id" <> g."id"
            AND p."endsAt" <= g."startsAt" AND (p."revokedAt" IS NULL OR p."revokedAt" > p."startsAt")
        )) AS renewals
      FROM "MembershipGrant" g
      WHERE g."organisationId" = ${organisationId} AND ${within(Prisma.sql`g."grantedAt"`, range)}
      GROUP BY 1`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT count(DISTINCT "userId") AS members FROM "MembershipGrant"
      WHERE "organisationId" = ${organisationId} AND "startsAt" <= ${asOf} AND "endsAt" > ${asOf}
        AND ("revokedAt" IS NULL OR "revokedAt" > ${asOf})`
  ]);
  const rows = zeroFill(range, merge(sales, refunds, grants), ["orders", "freeOrders", "gross", "fees", "refunds", "refunded", "feesReversed", "granted", "renewals"] as const);
  return {
    range,
    totals: {
      ...moneyTotals(access, rows),
      fulfilledOrders: sum(rows, "orders"),
      freeOrders: sum(rows, "freeOrders"),
      refunds: sum(rows, "refunds"),
      granted: sum(rows, "granted"),
      renewals: sum(rows, "renewals"),
      activeMembers: n(active?.members)
    },
    series: moneySeries(access, rows).map(({ start, gross, refunded, net, platformFees, granted, renewals }) => ({ start, gross, refunded, net, platformFees, granted, renewals }))
  };
}

// Merchandise: sales and refunds over the range; pickup states, stock and
// checkout holds as they are now.
export async function merchandiseMetrics(organisationId: string, range: AnalyticsRange, access: AnalyticsAccess, now = new Date()) {
  const [[sales, refunds], [pickups], [stock]] = await Promise.all([
    commerceSales(organisationId, "merchandise", range),
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        count(*) FILTER (WHERE "pickupStatus" = 'pending' AND "refundStatus" IS NULL AND "cancelledAt" IS NULL) AS preparing,
        count(*) FILTER (WHERE "pickupStatus" = 'ready' AND "refundStatus" IS NULL AND "cancelledAt" IS NULL) AS ready,
        count(*) FILTER (WHERE "pickupStatus" = 'collected') AS collected
      FROM "CommerceOrder"
      WHERE "organisationId" = ${organisationId} AND "kind" = 'merchandise' AND "status" = 'paid' AND "fulfilledAt" IS NOT NULL`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT
        (SELECT coalesce(sum(v."remaining"), 0) FROM "MerchandiseVariant" v JOIN "MerchandiseProduct" p ON p."id" = v."productId"
          WHERE v."organisationId" = ${organisationId} AND v."archivedAt" IS NULL AND p."status" = 'published') AS remaining,
        (SELECT coalesce(sum(l."quantity"), 0) FROM "CommerceOrderLine" l JOIN "CommerceOrder" c ON c."id" = l."orderId"
          WHERE c."organisationId" = ${organisationId} AND c."kind" = 'merchandise' AND c."status" = 'pending' AND c."paymentKind" = 'stripe'
            AND c."expiresAt" > ${utcNow(now)}) AS held`
  ]);
  const rows = zeroFill(range, merge(sales, refunds), ["orders", "freeOrders", "gross", "fees", "items", "refunds", "refunded", "feesReversed"] as const);
  return {
    range,
    totals: {
      ...moneyTotals(access, rows),
      fulfilledOrders: sum(rows, "orders"),
      freeOrders: sum(rows, "freeOrders"),
      itemsSold: sum(rows, "items"),
      refunds: sum(rows, "refunds"),
      pickups: { preparing: n(pickups?.preparing), ready: n(pickups?.ready), collected: n(pickups?.collected) },
      stock: { remaining: n(stock?.remaining), held: n(stock?.held) }
    },
    series: moneySeries(access, rows).map(({ start, gross, refunded, net, platformFees, orders, items }) => ({ start, gross, refunded, net, platformFees, orders, items }))
  };
}

// Engagement: free joins, and the distinct members who bought from or
// attended the society, with how many of them joined or hold a membership.
// Observed purchases and check-ins only; visits are not tracked.
export async function engagementMetrics(organisationId: string, range: AnalyticsRange, now = new Date()) {
  const asOf = Prisma.sql`LEAST(${endOf(range)} - interval '1 millisecond', ${utcNow(now)})`;
  const [joins, [people]] = await Promise.all([
    prisma.$queryRaw<Bucketed[]>`
      SELECT ${bucketOf(Prisma.sql`"createdAt"`, range)} AS bucket, count(*) AS joins
      FROM "OrganisationMember"
      WHERE "organisationId" = ${organisationId} AND "role" = 'member' AND ${within(Prisma.sql`"createdAt"`, range)}
      GROUP BY 1`,
    prisma.$queryRaw<Array<Record<string, unknown>>>`
      WITH buyers AS (
        SELECT o."userId" FROM "Order" o JOIN "Event" e ON e."id" = o."eventId"
        WHERE e."organisationId" = ${organisationId} AND o."userId" IS NOT NULL AND o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL
          AND ${within(Prisma.sql`o."fulfilledAt"`, range)}
        UNION
        SELECT "userId" FROM "CommerceOrder"
        WHERE "organisationId" = ${organisationId} AND "userId" IS NOT NULL AND "status" = 'paid' AND "fulfilledAt" IS NOT NULL
          AND ${within(Prisma.sql`"fulfilledAt"`, range)}
      ), attendees AS (
        SELECT DISTINCT o."userId" FROM "Ticket" t JOIN "Order" o ON o."id" = t."orderId" JOIN "Event" e ON e."id" = o."eventId"
        WHERE e."organisationId" = ${organisationId} AND o."userId" IS NOT NULL AND ${within(Prisma.sql`t."checkedInAt"`, range)}
      ), joined AS (
        SELECT "userId" FROM "OrganisationMember" WHERE "organisationId" = ${organisationId} AND "role" = 'member'
      ), members AS (
        SELECT DISTINCT "userId" FROM "MembershipGrant"
        WHERE "organisationId" = ${organisationId} AND "startsAt" <= ${asOf} AND "endsAt" > ${asOf} AND ("revokedAt" IS NULL OR "revokedAt" > ${asOf})
      )
      SELECT
        (SELECT count(*) FROM joined) AS joined,
        (SELECT count(*) FROM buyers) AS buyers,
        (SELECT count(*) FROM buyers WHERE "userId" IN (SELECT "userId" FROM joined)) AS "buyersJoined",
        (SELECT count(*) FROM buyers WHERE "userId" IN (SELECT "userId" FROM members)) AS "buyersMembers",
        (SELECT count(*) FROM attendees) AS attendees,
        (SELECT count(*) FROM attendees WHERE "userId" IN (SELECT "userId" FROM joined)) AS "attendeesJoined",
        (SELECT count(*) FROM attendees WHERE "userId" IN (SELECT "userId" FROM members)) AS "attendeesMembers"`
  ]);
  const rows = zeroFill(range, joins, ["joins"] as const);
  return {
    range,
    totals: {
      joins: sum(rows, "joins"),
      joinedNow: n(people?.joined),
      buyers: { total: n(people?.buyers), joined: n(people?.buyersJoined), members: n(people?.buyersMembers) },
      attendees: { total: n(people?.attendees), joined: n(people?.attendeesJoined), members: n(people?.attendeesMembers) }
    },
    series: rows
  };
}

// The society's gross sales by family over a range, summed separately so
// nothing multiplies. Null without finance access.
export async function societySales(organisationId: string, range: AnalyticsRange, access: AnalyticsAccess) {
  if (!access.financial) return null;
  const [row] = await prisma.$queryRaw<Array<Record<string, unknown>>>`
    SELECT
      (SELECT coalesce(sum(o."totalAmount"), 0) FROM "Order" o JOIN "Event" e ON e."id" = o."eventId"
        WHERE e."organisationId" = ${organisationId} AND o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL AND ${paidMoney("o")}
          AND ${within(Prisma.sql`o."fulfilledAt"`, range)}) AS tickets,
      (SELECT coalesce(sum(c."totalAmount"), 0) FROM "CommerceOrder" c
        WHERE c."organisationId" = ${organisationId} AND c."kind" = 'membership' AND c."status" = 'paid' AND c."fulfilledAt" IS NOT NULL AND ${paidMoney("c")}
          AND ${within(Prisma.sql`c."fulfilledAt"`, range)}) AS memberships,
      (SELECT coalesce(sum(c."totalAmount"), 0) FROM "CommerceOrder" c
        WHERE c."organisationId" = ${organisationId} AND c."kind" = 'merchandise' AND c."status" = 'paid' AND c."fulfilledAt" IS NOT NULL AND ${paidMoney("c")}
          AND ${within(Prisma.sql`c."fulfilledAt"`, range)}) AS merchandise`;
  const tickets = n(row?.tickets), memberships = n(row?.memberships), merchandise = n(row?.merchandise);
  return { tickets, memberships, merchandise, total: tickets + memberships + merchandise };
}
