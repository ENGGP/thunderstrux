import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type AuditClass = "numeric" | "lifecycle-risk" | "relationship/audit-only";

type AuditCheck = {
  name: string;
  classification: AuditClass;
  recommendation: string;
  // Rows from before the owning feature existed, explained rather than repaired:
  // reported, but they don't fail the audit (T41).
  legacy?: string;
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
  },
  {
    name: "paid_order_records_fulfilment",
    classification: "lifecycle-risk",
    recommendation:
      "Audit-only: a paid order without fulfilledAt had no tickets when T10 backfilled it; review it rather than inventing a time.",
    run: () =>
      modelCheck(
        prisma.order.count({ where: { status: "paid", fulfilledAt: null } }),
        prisma.order.findMany({
          where: { status: "paid", fulfilledAt: null },
          select: { id: true },
          take: SAMPLE_LIMIT,
          orderBy: { id: "asc" }
        })
      )
  },
  {
    name: "order_tickets_within_quantity",
    classification: "relationship/audit-only",
    recommendation:
      "Audit-only: more issued units than the order quantity means duplicate issuance; review before any repair.",
    run: async () => ({
      count: await rawCount(prisma.$queryRaw<RawCount>`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT "Order"."id" FROM "Order"
          INNER JOIN "Ticket" ON "Ticket"."orderId" = "Order"."id"
          GROUP BY "Order"."id" HAVING COUNT("Ticket"."id") > MAX("Order"."quantity")
        ) AS over_issued
      `),
      sampleIds: await rawSampleIds(prisma.$queryRaw<RawIds>`
        SELECT "Order"."id" FROM "Order"
        INNER JOIN "Ticket" ON "Ticket"."orderId" = "Order"."id"
        GROUP BY "Order"."id" HAVING COUNT("Ticket"."id") > MAX("Order"."quantity")
        ORDER BY "Order"."id" ASC
        LIMIT ${SAMPLE_LIMIT}
      `)
    })
  },
  {
    name: "checkout_attempt_session_matches_order",
    classification: "relationship/audit-only",
    recommendation:
      "Audit-only: an attached checkout attempt must name the same Stripe Session as its order; review before any repair.",
    run: async () => ({
      count: await rawCount(prisma.$queryRaw<RawCount>`
        SELECT COUNT(*)::bigint AS count FROM "CheckoutAttempt"
        INNER JOIN "Order" ON "Order"."id" = "CheckoutAttempt"."orderId"
        WHERE "Order"."stripeSessionId" IS NOT NULL
          AND "CheckoutAttempt"."stripeSessionId" IS NOT NULL
          AND "Order"."stripeSessionId" <> "CheckoutAttempt"."stripeSessionId"
      `),
      sampleIds: await rawSampleIds(prisma.$queryRaw<RawIds>`
        SELECT "CheckoutAttempt"."id" FROM "CheckoutAttempt"
        INNER JOIN "Order" ON "Order"."id" = "CheckoutAttempt"."orderId"
        WHERE "Order"."stripeSessionId" IS NOT NULL
          AND "CheckoutAttempt"."stripeSessionId" IS NOT NULL
          AND "Order"."stripeSessionId" <> "CheckoutAttempt"."stripeSessionId"
        ORDER BY "CheckoutAttempt"."id" ASC
        LIMIT ${SAMPLE_LIMIT}
      `)
    })
  },
  ...(["Order", "Ticket", "TicketReservation"] as const).map((table) => ({
    name: `${table.toLowerCase()}_organisation_matches_event`,
    classification: "relationship/audit-only" as const,
    recommendation: "Repair denormalized organisationId from Event.organisationId after a verified backup.",
    run: async () => ({
      count: await rawCount(prisma.$queryRawUnsafe<RawCount>(
        `SELECT COUNT(*)::bigint AS count FROM "${table}" row INNER JOIN "Event" event ON event."id" = row."eventId" WHERE row."organisationId" <> event."organisationId"`
      )),
      sampleIds: await rawSampleIds(prisma.$queryRawUnsafe<RawIds>(
        `SELECT row."id" FROM "${table}" row INNER JOIN "Event" event ON event."id" = row."eventId" WHERE row."organisationId" <> event."organisationId" ORDER BY row."id" ASC LIMIT ${SAMPLE_LIMIT}`
      ))
    })
  }))
];

// A check from a query that selects the offending rows' "id" (T41).
function sqlCheck(name: string, classification: AuditClass, recommendation: string, offending: Prisma.Sql, legacy?: string): AuditCheck {
  return {
    name,
    classification,
    recommendation,
    legacy,
    run: async () => ({
      count: await rawCount(prisma.$queryRaw<RawCount>`SELECT COUNT(*)::bigint AS count FROM (${offending}) offending`),
      sampleIds: await rawSampleIds(prisma.$queryRaw<RawIds>`SELECT id FROM (${offending}) offending ORDER BY id ASC LIMIT ${SAMPLE_LIMIT}`)
    })
  };
}

// T41: free, guest, snapshot, validity, refund, commerce, grant, stock, hold
// and outbox invariants. Each says what should be true; the recommendation
// says what to do with an exception, never a silent repair.
checks.push(
  sqlCheck("free_order_has_no_charge", "numeric", "Investigate: a free order totals zero and has no Stripe session.",
    Prisma.sql`SELECT "id" FROM "Order" WHERE "paymentKind" = 'free' AND ("totalAmount" <> 0 OR "stripeSessionId" IS NOT NULL)`),
  // Also a constraint since T41 (Order_paid_total_matches_units_chk); kept for databases restored from before it.
  sqlCheck("paid_order_total_matches_units", "numeric", "Investigate the checkout that wrote it; never rewrite a charged total.",
    Prisma.sql`SELECT "id" FROM "Order" WHERE "status" = 'paid' AND "totalAmount" <> "unitPrice" * "quantity"`),
  // Since account closure (T04, 5 Oct 2026) accounts are anonymised, never deleted.
  sqlCheck("order_has_buyer", "relationship/audit-only", "Every order belongs to a member or a guest identity; find how this one was created.",
    Prisma.sql`SELECT "id" FROM "Order" WHERE "userId" IS NULL AND "guestIdentityId" IS NULL AND "createdAt" >= '2026-10-05'`),
  sqlCheck("order_has_buyer_before_closure", "relationship/audit-only", "Keep the order for its money and tickets; its buyer can't be recovered.",
    Prisma.sql`SELECT "id" FROM "Order" WHERE "userId" IS NULL AND "guestIdentityId" IS NULL AND "createdAt" < '2026-10-05'`,
    "Before account closure (T04), deleting an account cleared its orders' buyer; those orders keep their money and tickets without one."),
  sqlCheck("fulfilled_order_has_purchase_snapshot", "lifecycle-risk", "Orders fulfilled since T10 record what was bought.",
    Prisma.sql`SELECT "id" FROM "Order" WHERE "fulfilledAt" IS NOT NULL AND "purchasedTicketTypeName" IS NULL`,
    "Orders fulfilled before purchase snapshots (T10) have none; buyer pages say the historical label is unavailable."),
  sqlCheck("refunded_or_cancelled_order_has_no_valid_tickets", "lifecycle-risk", "A refund or cancellation voids its tickets in the same transaction; void leftovers only after review.",
    Prisma.sql`SELECT DISTINCT o."id" FROM "Order" o JOIN "Ticket" t ON t."orderId" = o."id" WHERE (o."refundStatus" = 'refunded' OR o."cancelledAt" IS NOT NULL) AND t."validity" = 'active'`),
  sqlCheck("fulfilled_order_issued_every_ticket", "lifecycle-risk", "A fulfilled order without its tickets needs compensation review, not new tickets.",
    Prisma.sql`SELECT o."id" FROM "Order" o WHERE o."status" = 'paid' AND o."fulfilledAt" IS NOT NULL AND NOT o."requiresCompensationReview" AND (SELECT COUNT(*) FROM "Ticket" t WHERE t."orderId" = o."id") < o."quantity"`),
  sqlCheck("refunds_within_order_total", "numeric", "Confirmed refunds can't exceed what was paid; compare with the Stripe dashboard.",
    Prisma.sql`SELECT COALESCE(r."orderId", r."commerceOrderId") AS id FROM "RefundRequest" r LEFT JOIN "Order" o ON o."id" = r."orderId" LEFT JOIN "CommerceOrder" c ON c."id" = r."commerceOrderId" WHERE r."status" = 'succeeded' GROUP BY 1, o."totalAmount", c."totalAmount" HAVING SUM(r."amount") > COALESCE(o."totalAmount", c."totalAmount")`),
  sqlCheck("commerce_line_amount_matches", "numeric", "Line amounts are quantity times unit amount in cents; find the writer.",
    Prisma.sql`SELECT "orderId" AS id FROM "CommerceOrderLine" WHERE "lineAmount" <> "quantity" * "unitAmount"`),
  sqlCheck("commerce_total_matches_lines", "numeric", "An order's total is the sum of its lines; find the writer.",
    Prisma.sql`SELECT c."id" FROM "CommerceOrder" c JOIN "CommerceOrderLine" l ON l."orderId" = c."id" GROUP BY c."id", c."totalAmount" HAVING SUM(l."lineAmount") <> c."totalAmount"`),
  sqlCheck("commerce_fee_within_total", "numeric", "The platform fee is between zero and the total.",
    Prisma.sql`SELECT "id" FROM "CommerceOrder" WHERE "feeAmount" < 0 OR "feeAmount" > "totalAmount"`),
  sqlCheck("fulfilled_membership_has_grant", "lifecycle-risk", "A fulfilled membership grants its term in the same transaction; review it like a payment in review.",
    Prisma.sql`SELECT DISTINCT c."id" FROM "CommerceOrder" c JOIN "CommerceOrderLine" l ON l."orderId" = c."id" LEFT JOIN "MembershipGrant" g ON g."commerceOrderLineId" = l."id" WHERE c."kind" = 'membership' AND c."status" = 'paid' AND c."fulfilledAt" IS NOT NULL AND NOT c."requiresCompensationReview" AND g."id" IS NULL`),
  sqlCheck("membership_term_positive", "numeric", "A grant ends after it starts.",
    Prisma.sql`SELECT "id" FROM "MembershipGrant" WHERE "endsAt" <= "startsAt"`),
  sqlCheck("refunded_membership_is_revoked", "lifecycle-risk", "A refunded or cancelled membership ends its grant in the same transaction.",
    Prisma.sql`SELECT g."id" FROM "MembershipGrant" g JOIN "CommerceOrderLine" l ON l."id" = g."commerceOrderLineId" JOIN "CommerceOrder" c ON c."id" = l."orderId" WHERE (c."refundStatus" = 'refunded' OR c."cancelledAt" IS NOT NULL) AND g."revokedAt" IS NULL`),
  sqlCheck("membership_grants_do_not_overlap", "relationship/audit-only", "A member holds one term per society at a time; a btree_gist exclusion constraint can enforce it once the host supports it.",
    Prisma.sql`SELECT a."id" FROM "MembershipGrant" a JOIN "MembershipGrant" b ON a."userId" = b."userId" AND a."organisationId" = b."organisationId" AND a."id" < b."id" AND a."revokedAt" IS NULL AND b."revokedAt" IS NULL AND a."startsAt" < b."endsAt" AND b."startsAt" < a."endsAt"`),
  sqlCheck("merchandise_stock_nonnegative", "numeric", "Stock can't go below zero; checkout decrements it under lock.",
    Prisma.sql`SELECT "id" FROM "MerchandiseVariant" WHERE "remaining" < 0`),
  sqlCheck("stale_ticket_hold_released", "lifecycle-risk", "The stale-order worker releases expired holds every minute; a day-old active hold means it isn't running.",
    Prisma.sql`SELECT "id" FROM "TicketReservation" WHERE "status" = 'active' AND "expiresAt" < now() - interval '1 day'`),
  sqlCheck("stale_commerce_checkout_expired", "lifecycle-risk", "The checkout-recovery worker expires abandoned commerce checkouts; a day-old pending one means it isn't running.",
    Prisma.sql`SELECT "id" FROM "CommerceOrder" WHERE "status" = 'pending' AND "expiresAt" < now() - interval '1 day'`),
  sqlCheck("outbox_not_stuck", "lifecycle-risk", "A job processing for over an hour lost its worker; lease recovery requeues it.",
    Prisma.sql`SELECT "id" FROM "EmailOutbox" WHERE "status" = 'processing' AND "processingStartedAt" < now() - interval '1 hour' UNION ALL SELECT "id" FROM "NotificationOutbox" WHERE "status" = 'processing' AND "processingStartedAt" < now() - interval '1 hour'`),
  sqlCheck("sent_notification_was_accepted", "lifecycle-risk", "A sent notice records when the provider accepted it.",
    Prisma.sql`SELECT "id" FROM "NotificationOutbox" WHERE "status" = 'sent' AND "acceptedAt" IS NULL`)
);

export async function runDatabaseIntegrityAudit() {
  const results = [];

  for (const check of checks) {
    const result = await check.run();
    results.push({ ...check, ...result });
  }

  return results;
}
