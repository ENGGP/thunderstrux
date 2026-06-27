import { prisma } from "@/lib/db";

type AuditClass = "numeric" | "lifecycle-risk" | "relationship/audit-only";

type AuditCheck = {
  name: string;
  classification: AuditClass;
  recommendation: string;
  run: () => Promise<{ count: number; sampleIds: string[] }>;
};

type RawCount = Array<{ count: bigint | number }>;
type RawIds = Array<{ id: string }>;

const SAMPLE_LIMIT = 10;

function toNumber(value: bigint | number | undefined) {
  if (typeof value === "bigint") {
    return Number(value);
  }
  return value ?? 0;
}

async function rawCount(query: Promise<RawCount>) {
  const rows = await query;
  return toNumber(rows[0]?.count);
}

async function rawSampleIds(query: Promise<RawIds>) {
  const rows = await query;
  return rows.map((row) => row.id);
}

async function modelCheck(
  count: Promise<number>,
  sample: Promise<Array<{ id: string }>>
) {
  const [violationCount, sampleRows] = await Promise.all([count, sample]);
  return {
    count: violationCount,
    sampleIds: sampleRows.map((row) => row.id)
  };
}

const checks: AuditCheck[] = [
  {
    name: "ticket_type_quantity_nonnegative",
    classification: "numeric",
    recommendation: "Phase 2 candidate: CHECK (quantity >= 0) on TicketType.",
    run: () =>
      modelCheck(
        prisma.ticketType.count({ where: { quantity: { lt: 0 } } }),
        prisma.ticketType.findMany({
          where: { quantity: { lt: 0 } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "ticket_type_price_nonnegative",
    classification: "numeric",
    recommendation: "Phase 2 candidate: CHECK (price >= 0) on TicketType.",
    run: () =>
      modelCheck(
        prisma.ticketType.count({ where: { price: { lt: 0 } } }),
        prisma.ticketType.findMany({
          where: { price: { lt: 0 } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "order_quantity_positive",
    classification: "numeric",
    recommendation: "Phase 2 candidate: CHECK (quantity > 0) on Order.",
    run: () =>
      modelCheck(
        prisma.order.count({ where: { quantity: { lte: 0 } } }),
        prisma.order.findMany({
          where: { quantity: { lte: 0 } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "order_unit_price_nonnegative",
    classification: "numeric",
    recommendation: "Phase 2 candidate: CHECK (unitPrice >= 0) on Order.",
    run: () =>
      modelCheck(
        prisma.order.count({ where: { unitPrice: { lt: 0 } } }),
        prisma.order.findMany({
          where: { unitPrice: { lt: 0 } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "order_total_amount_nonnegative",
    classification: "numeric",
    recommendation: "Phase 2 candidate: CHECK (totalAmount >= 0) on Order.",
    run: () =>
      modelCheck(
        prisma.order.count({ where: { totalAmount: { lt: 0 } } }),
        prisma.order.findMany({
          where: { totalAmount: { lt: 0 } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "ticket_reservation_quantity_positive",
    classification: "numeric",
    recommendation:
      "Phase 2 candidate: CHECK (quantity > 0) on TicketReservation.",
    run: () =>
      modelCheck(
        prisma.ticketReservation.count({ where: { quantity: { lte: 0 } } }),
        prisma.ticketReservation.findMany({
          where: { quantity: { lte: 0 } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "event_end_time_after_start_time",
    classification: "lifecycle-risk",
    recommendation:
      "Phase 3 candidate after lifecycle audit: CHECK (endTime > startTime).",
    run: () =>
      modelCheck(
        prisma.event.count({ where: { endTime: { lte: prisma.event.fields.startTime } } }),
        prisma.event.findMany({
          where: { endTime: { lte: prisma.event.fields.startTime } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "paid_order_requires_paid_at",
    classification: "lifecycle-risk",
    recommendation:
      "Phase 3 candidate after webhook/compensation audit: paid orders require paidAt.",
    run: () =>
      modelCheck(
        prisma.order.count({ where: { status: "paid", paidAt: null } }),
        prisma.order.findMany({
          where: { status: "paid", paidAt: null },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "failed_order_requires_failed_at",
    classification: "lifecycle-risk",
    recommendation:
      "Phase 3 candidate only after approving the failed-order exception policy.",
    run: () =>
      modelCheck(
        prisma.order.count({ where: { status: "failed", failedAt: null } }),
        prisma.order.findMany({
          where: { status: "failed", failedAt: null },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "expired_order_has_no_paid_at",
    classification: "lifecycle-risk",
    recommendation:
      "Phase 3 candidate after confirming stale cleanup and payment lifecycle behavior.",
    run: () =>
      modelCheck(
        prisma.order.count({
          where: { status: "expired", paidAt: { not: null } }
        }),
        prisma.order.findMany({
          where: { status: "expired", paidAt: { not: null } },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "pending_order_reservation_status_active",
    classification: "relationship/audit-only",
    recommendation:
      "Audit-only for now; do not enforce cross-row lifecycle consistency with a simple check constraint.",
    run: () =>
      modelCheck(
        prisma.order.count({
          where: {
            status: "pending",
            reservation: { is: { status: { not: "active" } } }
          }
        }),
        prisma.order.findMany({
          where: {
            status: "pending",
            reservation: { is: { status: { not: "active" } } }
          },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "reservation_quantity_matches_order_quantity",
    classification: "relationship/audit-only",
    recommendation:
      "Audit-only for now; mismatches should enter compensation handling, not be repaired by P1.8.",
    run: async () => ({
      count: await rawCount(prisma.$queryRaw<RawCount>`
        SELECT COUNT(*)::bigint AS count
        FROM "TicketReservation"
        INNER JOIN "Order" ON "Order"."id" = "TicketReservation"."orderId"
        WHERE "TicketReservation"."quantity" <> "Order"."quantity"
      `),
      sampleIds: await rawSampleIds(prisma.$queryRaw<RawIds>`
        SELECT "TicketReservation"."id"
        FROM "TicketReservation"
        INNER JOIN "Order" ON "Order"."id" = "TicketReservation"."orderId"
        WHERE "TicketReservation"."quantity" <> "Order"."quantity"
        ORDER BY "TicketReservation"."id" ASC
        LIMIT ${SAMPLE_LIMIT}
      `)
    })
  },
  {
    name: "reservation_event_matches_order_event",
    classification: "relationship/audit-only",
    recommendation:
      "Audit-only for now; cross-row consistency requires lifecycle-aware repair/design.",
    run: async () => ({
      count: await rawCount(prisma.$queryRaw<RawCount>`
        SELECT COUNT(*)::bigint AS count
        FROM "TicketReservation"
        INNER JOIN "Order" ON "Order"."id" = "TicketReservation"."orderId"
        WHERE "TicketReservation"."eventId" <> "Order"."eventId"
      `),
      sampleIds: await rawSampleIds(prisma.$queryRaw<RawIds>`
        SELECT "TicketReservation"."id"
        FROM "TicketReservation"
        INNER JOIN "Order" ON "Order"."id" = "TicketReservation"."orderId"
        WHERE "TicketReservation"."eventId" <> "Order"."eventId"
        ORDER BY "TicketReservation"."id" ASC
        LIMIT ${SAMPLE_LIMIT}
      `)
    })
  },
  {
    name: "reservation_ticket_type_matches_order_ticket_type",
    classification: "relationship/audit-only",
    recommendation:
      "Audit-only for now; cross-row consistency requires lifecycle-aware repair/design.",
    run: async () => ({
      count: await rawCount(prisma.$queryRaw<RawCount>`
        SELECT COUNT(*)::bigint AS count
        FROM "TicketReservation"
        INNER JOIN "Order" ON "Order"."id" = "TicketReservation"."orderId"
        WHERE "TicketReservation"."ticketTypeId" <> "Order"."ticketTypeId"
      `),
      sampleIds: await rawSampleIds(prisma.$queryRaw<RawIds>`
        SELECT "TicketReservation"."id"
        FROM "TicketReservation"
        INNER JOIN "Order" ON "Order"."id" = "TicketReservation"."orderId"
        WHERE "TicketReservation"."ticketTypeId" <> "Order"."ticketTypeId"
        ORDER BY "TicketReservation"."id" ASC
        LIMIT ${SAMPLE_LIMIT}
      `)
    })
  }
];

export async function runDatabaseIntegrityAudit() {
  const results = [];

  for (const check of checks) {
    const result = await check.run();
    results.push({ ...check, ...result });
  }

  return results;
}

async function main() {
  const results = await runDatabaseIntegrityAudit();
  const totalViolations = results.reduce((total, result) => total + result.count, 0);

  console.log("Thunderstrux database integrity audit");
  console.log(`checks=${results.length} totalViolations=${totalViolations}`);

  for (const result of results) {
    console.log("");
    console.log(`check=${result.name}`);
    console.log(`class=${result.classification}`);
    console.log(`violations=${result.count}`);
    console.log(`sampleIds=${result.sampleIds.length > 0 ? result.sampleIds.join(",") : "none"}`);
    console.log(`recommendation=${result.recommendation}`);
  }

  if (totalViolations > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Database integrity audit failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
