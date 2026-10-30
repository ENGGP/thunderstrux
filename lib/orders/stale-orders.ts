import { prisma } from "@/lib/db";
import { failPendingCommerceOrder } from "@/lib/commerce/binding";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { mayExpireAfterStripeCheck } from "@/lib/payments/checkout-settlement";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";
import { lateWebhookGraceMs } from "@/lib/tickets/reservations";

export const stalePreCheckoutOrderMinutes = 30;
export const defaultStaleOrderCleanupBatchLimit = 100;

export type StaleOrderCleanupBatchOptions = {
  limit?: number;
  now?: Date;
  dryRun?: boolean;
};

export type StaleOrderCleanupBatchResult = {
  dryRun: boolean;
  limit: number;
  now: string;
  legacyPendingCutoff: string;
  reservationsSelected: number;
  reservationsExpired: number;
  reservationBackedOrdersExpired: number;
  alreadyExpiredReservationBackedOrdersSelected: number;
  alreadyExpiredReservationBackedOrdersExpired: number;
  legacyOrdersSelected: number;
  legacyOrdersExpired: number;
  ordersExpired: number;
  // Kept pending this run because Stripe couldn't be asked whether they were paid (PAY-024).
  stripeDeferred: number;
};

function normaliseBatchLimit(limit: number | undefined) {
  const value = limit ?? defaultStaleOrderCleanupBatchLimit;

  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw new Error("Stale cleanup limit must be an integer between 1 and 1000.");
  }

  return value;
}

type ReservationCandidate = {
  id: string;
  orderId: string;
};

type LegacyOrderCandidate = {
  id: string;
};

type QueryClient = Pick<typeof prisma, "$queryRaw">;

// Every pick below takes the orders Stripe was asked about longest ago first (never
// asked comes first), as the sweep does. Each look stamps the order, even a failed
// one, so orders that keep failing can't hold the front of every run (PAY-046).
async function selectExpiredReservationCandidates({
  db,
  limit,
  now
}: {
  db: QueryClient;
  limit: number;
  now: Date;
}) {
  // A reservation runs the event's hold plus lateWebhookGraceMs: it is picked when
  // the hold ends, so the Stripe check closes the page then (PAY-009). Without a
  // Session, the order itself still waits for expiresAt (expirePendingOrder).
  return db.$queryRaw<ReservationCandidate[]>`
    SELECT "TicketReservation"."id", "TicketReservation"."orderId"
    FROM "TicketReservation"
    INNER JOIN "Order"
      ON "Order"."id" = "TicketReservation"."orderId"
    WHERE "TicketReservation"."status" = 'active'
      AND "TicketReservation"."expiresAt" <= ${new Date(now.getTime() + lateWebhookGraceMs)}
    ORDER BY "Order"."stripeCheckedAt" ASC NULLS FIRST, "TicketReservation"."expiresAt" ASC, "TicketReservation"."id" ASC
    LIMIT ${limit}
  `;
}

async function selectLegacyPendingOrderCandidates({
  db,
  limit,
  legacyPendingCutoff
}: {
  db: QueryClient;
  limit: number;
  legacyPendingCutoff: Date;
}) {
  return db.$queryRaw<LegacyOrderCandidate[]>`
    SELECT "id"
    FROM "Order"
    WHERE "status" = 'pending'
      AND "createdAt" < ${legacyPendingCutoff}
      AND NOT EXISTS (
        SELECT 1
        FROM "TicketReservation"
        WHERE "TicketReservation"."orderId" = "Order"."id"
      )
    ORDER BY "stripeCheckedAt" ASC NULLS FIRST, "createdAt" ASC, "id" ASC
    LIMIT ${limit}
  `;
}

async function selectAlreadyExpiredReservationBackedOrderCandidates({
  db,
  limit
}: {
  db: QueryClient;
  limit: number;
}) {
  return db.$queryRaw<LegacyOrderCandidate[]>`
    SELECT "Order"."id"
    FROM "Order"
    INNER JOIN "TicketReservation"
      ON "TicketReservation"."orderId" = "Order"."id"
    WHERE "Order"."status" = 'pending'
      AND "TicketReservation"."status" = 'expired'
    ORDER BY "Order"."stripeCheckedAt" ASC NULLS FIRST, "Order"."createdAt" ASC, "Order"."id" ASC
    LIMIT ${limit}
  `;
}

type ExpiryReason = "reservation_expired" | "reservation_already_expired" | "legacy_pending_timeout";

// The stale-order job's expiry of an unpaid ticket order (the expiry webhook and
// the buyer's cancel expire them too): under its lock, only if it still
// qualifies for the reason it was picked, with one history entry.
async function expirePendingOrder(orderId: string, reason: ExpiryReason, now: Date, legacyPendingCutoff: Date) {
  return prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) return false;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { status: true, createdAt: true, requiresCompensationReview: true, reservation: { select: { id: true, status: true, expiresAt: true } } }
    });
    if (order?.status !== "pending") return false;
    const { reservation } = order;
    const qualifies =
      reason === "reservation_expired" ? reservation?.status === "active" && reservation.expiresAt <= now
        : reason === "reservation_already_expired" ? reservation?.status === "expired"
          : !reservation && order.createdAt < legacyPendingCutoff;
    if (!qualifies) return false;
    if (reason === "reservation_expired" && reservation) {
      const released = await tx.ticketReservation.updateMany({
        where: { id: reservation.id, status: "active", expiresAt: { lte: now } },
        data: { status: "expired", releasedAt: now, releaseReason: "Reservation expired before checkout completed" }
      });
      if (released.count === 0) return false;
    }
    const updated = await tx.order.updateMany({ where: { id: orderId, status: "pending" }, data: { status: "expired", failureReason: null } });
    if (updated.count === 0) return false;
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "order_expired",
      source: "stale_cleanup",
      reason,
      fromOrderStatus: "pending",
      toOrderStatus: "expired",
      ...(reservation ? { fromReservationStatus: reservation.status, toReservationStatus: "expired" as const } : {}),
      baseline: { orderStatus: order.status, reservationStatus: reservation?.status, compensationReview: order.requiresCompensationReview }
    });
    return true;
  });
}

export async function processStaleOrderCleanupBatch({
  limit: requestedLimit,
  now = new Date(),
  dryRun = false
}: StaleOrderCleanupBatchOptions = {}): Promise<StaleOrderCleanupBatchResult> {
  try {
    const result = await processStaleOrderCleanupBatchInternal({
      limit: requestedLimit,
      now,
      dryRun
    });

    logInfo("stale_orders.batch.processed", result);
    emitMetric("stale_orders_expired_total", result.ordersExpired, {
      dryRun: result.dryRun
    });

    return result;
  } catch (error) {
    logError("stale_orders.batch.failed", {
      dryRun,
      limit: requestedLimit,
      error
    });
    emitOperationalAlert("stale_order_worker_failed", {
      dryRun,
      limit: requestedLimit,
      error
    });
    throw error;
  }
}

async function processStaleOrderCleanupBatchInternal({
  limit: requestedLimit,
  now = new Date(),
  dryRun = false
}: StaleOrderCleanupBatchOptions = {}): Promise<StaleOrderCleanupBatchResult> {
  const limit = normaliseBatchLimit(requestedLimit);
  const legacyPendingCutoff = new Date(
    now.getTime() - stalePreCheckoutOrderMinutes * 60 * 1000
  );

  const reservationCandidates = await selectExpiredReservationCandidates({
    db: prisma,
    limit,
    now
  });
  const afterReservationLimit = Math.max(0, limit - reservationCandidates.length);
  const alreadyExpiredReservationBackedOrderCandidates =
    afterReservationLimit > 0
      ? await selectAlreadyExpiredReservationBackedOrderCandidates({
          db: prisma,
          limit: afterReservationLimit
        })
      : [];
  const remainingLimit = Math.max(
    0,
    afterReservationLimit - alreadyExpiredReservationBackedOrderCandidates.length
  );
  const legacyOrderCandidates =
    remainingLimit > 0
      ? await selectLegacyPendingOrderCandidates({
          db: prisma,
          limit: remainingLimit,
          legacyPendingCutoff
        })
      : [];

  if (dryRun) {
    return {
      dryRun,
      limit,
      now: now.toISOString(),
      legacyPendingCutoff: legacyPendingCutoff.toISOString(),
      reservationsSelected: reservationCandidates.length,
      reservationsExpired: 0,
      reservationBackedOrdersExpired: 0,
      alreadyExpiredReservationBackedOrdersSelected:
        alreadyExpiredReservationBackedOrderCandidates.length,
      alreadyExpiredReservationBackedOrdersExpired: 0,
      legacyOrdersSelected: legacyOrderCandidates.length,
      legacyOrdersExpired: 0,
      ordersExpired: 0,
      stripeDeferred: 0
    };
  }

  let stripeDeferred = 0;
  const expire = async (orderIds: string[], reason: ExpiryReason) => {
    let expired = 0;
    for (const orderId of orderIds) {
      // PAY-024: ask Stripe first, so a paid order whose webhook was lost is fulfilled, not expired.
      if (!(await mayExpireAfterStripeCheck("ticket", orderId, now))) {
        stripeDeferred += 1;
        continue;
      }
      if (await expirePendingOrder(orderId, reason, now, legacyPendingCutoff)) expired += 1;
    }
    return expired;
  };
  const reservationBackedOrdersExpired = await expire(reservationCandidates.map((candidate) => candidate.orderId), "reservation_expired");
  const alreadyExpiredReservationBackedOrdersExpired = await expire(alreadyExpiredReservationBackedOrderCandidates.map((candidate) => candidate.id), "reservation_already_expired");
  const legacyOrdersExpired = await expire(legacyOrderCandidates.map((candidate) => candidate.id), "legacy_pending_timeout");
  const reservationsExpired = reservationBackedOrdersExpired;

  return {
    dryRun,
    limit,
    now: now.toISOString(),
    legacyPendingCutoff: legacyPendingCutoff.toISOString(),
    reservationsSelected: reservationCandidates.length,
    reservationsExpired,
    reservationBackedOrdersExpired,
    alreadyExpiredReservationBackedOrdersSelected:
      alreadyExpiredReservationBackedOrderCandidates.length,
    alreadyExpiredReservationBackedOrdersExpired:
      alreadyExpiredReservationBackedOrdersExpired,
    legacyOrdersSelected: legacyOrderCandidates.length,
    legacyOrdersExpired,
    ordersExpired:
      reservationBackedOrdersExpired +
      alreadyExpiredReservationBackedOrdersExpired +
      legacyOrdersExpired,
    stripeDeferred
  };
}

// Membership and merchandise orders whose hold has ended (PAY-009): asked about
// at Stripe first (PAY-024), which closes a page still open, then expired and
// their holds released. Stock stays counted for lateWebhookGraceMs past the hold
// (lib/merchandise/sale.ts) only while Stripe can't be asked.
export async function expireStaleCommerceOrders({ now = new Date(), limit = 100 } = {}) {
  const stale = await prisma.commerceOrder.findMany({
    where: { status: "pending", paymentKind: "stripe", expiresAt: { lt: now } },
    orderBy: [{ stripeCheckedAt: { sort: "asc", nulls: "first" } }, { expiresAt: "asc" }],
    take: Math.max(1, Math.min(limit, 500)),
    select: { id: true }
  });
  let expired = 0;
  let stripeDeferred = 0;
  for (const order of stale) {
    if (!(await mayExpireAfterStripeCheck("commerce", order.id, now))) {
      stripeDeferred += 1;
      continue;
    }
    if (await failPendingCommerceOrder(order.id, "hold_expired", "stale_cleanup", { status: "expired" })) expired += 1;
  }
  logInfo("commerce.stale_orders.expired", { expired, considered: stale.length, stripeDeferred });
  return { expired, considered: stale.length, stripeDeferred };
}

export function parseStaleOrderCleanupCliOptions(args: string[]) {
  let dryRun = false;
  let limit: number | undefined;

  for (const arg of args) {
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const rawLimit = arg.slice("--limit=".length);
      const parsed = Number(rawLimit);

      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
        throw new Error("--limit must be an integer between 1 and 1000.");
      }

      limit = parsed;
      continue;
    }

    throw new Error(`Unknown stale cleanup option: ${arg}`);
  }

  return { dryRun, limit };
}
