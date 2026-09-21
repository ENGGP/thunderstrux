import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";
import { expireOldActiveReservations } from "@/lib/tickets/reservations";

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
};

export async function runStaleOrderCleanup({
  organisationId,
  eventId,
  ticketTypeId,
  userId
}: {
  organisationId?: string;
  eventId?: string;
  ticketTypeId?: string;
  userId?: string;
} = {}) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const legacyPendingCutoff = new Date(
      now.getTime() - stalePreCheckoutOrderMinutes * 60 * 1000
    );
    const organisationEventIds = organisationId
      ? (
          await tx.event.findMany({
            where: {
              organisationId,
              ...(eventId ? { id: eventId } : {})
            },
            select: { id: true }
          })
        ).map((event) => event.id)
      : null;
    const eventScope = organisationEventIds
      ? { eventId: { in: organisationEventIds } }
      : eventId
        ? { eventId }
        : {};
    const reservations = await expireOldActiveReservations(tx, {
      now,
      organisationId,
      eventId,
      ticketTypeId,
      userId
    });

    const alreadyExpiredOrders = await tx.order.findMany({
      where: {
        ...eventScope,
        ...(ticketTypeId ? { ticketTypeId } : {}),
        ...(userId ? { userId } : {}),
        status: "pending",
        reservation: {
          is: {
            status: "expired"
          }
        }
      },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    let alreadyExpiredCount = 0;
    for (const candidate of alreadyExpiredOrders) {
      if (!(await lockOrder(tx, candidate.id))) continue;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: candidate.id },
        select: {
          status: true,
          requiresCompensationReview: true,
          reservation: { select: { status: true } }
        }
      });
      if (order.status !== "pending" || order.reservation?.status !== "expired") {
        continue;
      }
      const updated = await tx.order.updateMany({
        where: { id: candidate.id, status: "pending" },
        data: { status: "expired", failureReason: null }
      });
      if (updated.count === 0) continue;
      await appendOrderLifecycleEvent(tx, {
        orderId: candidate.id,
        type: "order_expired",
        source: "stale_cleanup",
        reason: "reservation_already_expired",
        fromOrderStatus: "pending",
        toOrderStatus: "expired",
        fromReservationStatus: "expired",
        toReservationStatus: "expired",
        baseline: {
          orderStatus: order.status,
          reservationStatus: order.reservation.status,
          compensationReview: order.requiresCompensationReview
        }
      });
      alreadyExpiredCount += 1;
    }

    const legacyOrders = await tx.order.findMany({
      where: {
        ...eventScope,
        ...(ticketTypeId ? { ticketTypeId } : {}),
        ...(userId ? { userId } : {}),
        status: "pending",
        createdAt: {
          lt: legacyPendingCutoff
        },
        reservation: {
          is: null
        }
      },
      select: { id: true },
      orderBy: { id: "asc" }
    });
    let legacyCount = 0;
    for (const candidate of legacyOrders) {
      if (!(await lockOrder(tx, candidate.id))) continue;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: candidate.id },
        select: {
          status: true,
          createdAt: true,
          requiresCompensationReview: true,
          reservation: { select: { status: true } }
        }
      });
      if (
        order.status !== "pending" ||
        order.reservation ||
        order.createdAt >= legacyPendingCutoff
      ) continue;
      const updated = await tx.order.updateMany({
        where: { id: candidate.id, status: "pending", reservation: { is: null } },
        data: { status: "expired", failureReason: null }
      });
      if (updated.count === 0) continue;
      await appendOrderLifecycleEvent(tx, {
        orderId: candidate.id,
        type: "order_expired",
        source: "stale_cleanup",
        reason: "legacy_pending_timeout",
        fromOrderStatus: "pending",
        toOrderStatus: "expired",
        baseline: {
          orderStatus: order.status,
          compensationReview: order.requiresCompensationReview
        }
      });
      legacyCount += 1;
    }

    // Preserve the established result contract: reservationsUpdated reports
    // active reservations handled by the first phase, while ordersUpdated
    // reports only the follow-up pending-order cleanup phases.
    const ordersUpdated = alreadyExpiredCount + legacyCount;

    return {
      reservationsUpdated: reservations.count,
      reservationBackedOrdersUpdated: alreadyExpiredCount,
      legacyReservationlessOrdersUpdated: legacyCount,
      ordersUpdated
    };
  });
}

export async function failStalePreCheckoutOrders(
  filters: Parameters<typeof runStaleOrderCleanup>[0] = {}
) {
  return runStaleOrderCleanup(filters);
}

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

async function selectExpiredReservationCandidates({
  db,
  limit,
  now,
  lock
}: {
  db: QueryClient;
  limit: number;
  now: Date;
  lock: boolean;
}) {
  const lockClause = lock ? Prisma.sql`FOR UPDATE SKIP LOCKED` : Prisma.empty;

  return db.$queryRaw<ReservationCandidate[]>`
    SELECT "id", "orderId"
    FROM "TicketReservation"
    WHERE "status" = 'active'
      AND "expiresAt" <= ${now}
    ORDER BY "expiresAt" ASC, "id" ASC
    LIMIT ${limit}
    ${lockClause}
  `;
}

async function selectLegacyPendingOrderCandidates({
  db,
  limit,
  legacyPendingCutoff,
  lock
}: {
  db: QueryClient;
  limit: number;
  legacyPendingCutoff: Date;
  lock: boolean;
}) {
  const lockClause = lock ? Prisma.sql`FOR UPDATE SKIP LOCKED` : Prisma.empty;

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
    ORDER BY "createdAt" ASC, "id" ASC
    LIMIT ${limit}
    ${lockClause}
  `;
}

async function selectAlreadyExpiredReservationBackedOrderCandidates({
  db,
  limit,
  lock
}: {
  db: QueryClient;
  limit: number;
  lock: boolean;
}) {
  const lockClause = lock ? Prisma.sql`FOR UPDATE SKIP LOCKED` : Prisma.empty;

  return db.$queryRaw<LegacyOrderCandidate[]>`
    SELECT "Order"."id"
    FROM "Order"
    INNER JOIN "TicketReservation"
      ON "TicketReservation"."orderId" = "Order"."id"
    WHERE "Order"."status" = 'pending'
      AND "TicketReservation"."status" = 'expired'
    ORDER BY "Order"."createdAt" ASC, "Order"."id" ASC
    LIMIT ${limit}
    ${lockClause}
  `;
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
    now,
    lock: false
  });
  const afterReservationLimit = Math.max(0, limit - reservationCandidates.length);
  const alreadyExpiredReservationBackedOrderCandidates =
    afterReservationLimit > 0
      ? await selectAlreadyExpiredReservationBackedOrderCandidates({
          db: prisma,
          limit: afterReservationLimit,
          lock: false
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
          legacyPendingCutoff,
          lock: false
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
      ordersExpired: 0
    };
  }

  let reservationsExpired = 0;
  let reservationBackedOrdersExpired = 0;
  for (const candidate of reservationCandidates) {
    const applied = await prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, candidate.orderId))) return false;
      const order = await tx.order.findUnique({
        where: { id: candidate.orderId },
        select: {
          status: true,
          requiresCompensationReview: true,
          reservation: {
            select: { id: true, status: true, expiresAt: true }
          }
        }
      });
      if (
        !order ||
        order.status !== "pending" ||
        order.reservation?.id !== candidate.id ||
        order.reservation.status !== "active" ||
        order.reservation.expiresAt > now
      ) return false;
      const reservation = await tx.ticketReservation.updateMany({
        where: { id: candidate.id, status: "active", expiresAt: { lte: now } },
        data: {
          status: "expired",
          releasedAt: now,
          releaseReason: "Reservation expired before checkout completed"
        }
      });
      if (reservation.count === 0) return false;
      const updated = await tx.order.updateMany({
        where: { id: candidate.orderId, status: "pending" },
        data: { status: "expired", failureReason: null }
      });
      if (updated.count === 0) return false;
      await appendOrderLifecycleEvent(tx, {
        orderId: candidate.orderId,
        type: "order_expired",
        source: "stale_cleanup",
        reason: "reservation_expired",
        fromOrderStatus: "pending",
        toOrderStatus: "expired",
        fromReservationStatus: "active",
        toReservationStatus: "expired",
        baseline: {
          orderStatus: order.status,
          reservationStatus: order.reservation.status,
          compensationReview: order.requiresCompensationReview
        }
      });
      return true;
    });
    if (applied) {
      reservationsExpired += 1;
      reservationBackedOrdersExpired += 1;
    }
  }

  let alreadyExpiredReservationBackedOrdersExpired = 0;
  for (const candidate of alreadyExpiredReservationBackedOrderCandidates) {
    const applied = await prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, candidate.id))) return false;
      const order = await tx.order.findUnique({
        where: { id: candidate.id },
        select: {
          status: true,
          requiresCompensationReview: true,
          reservation: { select: { status: true } }
        }
      });
      if (order?.status !== "pending" || order.reservation?.status !== "expired") {
        return false;
      }
      const updated = await tx.order.updateMany({
        where: { id: candidate.id, status: "pending" },
        data: { status: "expired", failureReason: null }
      });
      if (updated.count === 0) return false;
      await appendOrderLifecycleEvent(tx, {
        orderId: candidate.id,
        type: "order_expired",
        source: "stale_cleanup",
        reason: "reservation_already_expired",
        fromOrderStatus: "pending",
        toOrderStatus: "expired",
        fromReservationStatus: "expired",
        toReservationStatus: "expired",
        baseline: {
          orderStatus: order.status,
          reservationStatus: order.reservation.status,
          compensationReview: order.requiresCompensationReview
        }
      });
      return true;
    });
    if (applied) alreadyExpiredReservationBackedOrdersExpired += 1;
  }

  let legacyOrdersExpired = 0;
  for (const candidate of legacyOrderCandidates) {
    const applied = await prisma.$transaction(async (tx) => {
      if (!(await lockOrder(tx, candidate.id))) return false;
      const order = await tx.order.findUnique({
        where: { id: candidate.id },
        select: {
          status: true,
          createdAt: true,
          requiresCompensationReview: true,
          reservation: { select: { status: true } }
        }
      });
      if (
        order?.status !== "pending" ||
        order.reservation ||
        order.createdAt >= legacyPendingCutoff
      ) return false;
      const updated = await tx.order.updateMany({
        where: { id: candidate.id, status: "pending", reservation: { is: null } },
        data: { status: "expired", failureReason: null }
      });
      if (updated.count === 0) return false;
      await appendOrderLifecycleEvent(tx, {
        orderId: candidate.id,
        type: "order_expired",
        source: "stale_cleanup",
        reason: "legacy_pending_timeout",
        fromOrderStatus: "pending",
        toOrderStatus: "expired",
        baseline: {
          orderStatus: order.status,
          compensationReview: order.requiresCompensationReview
        }
      });
      return true;
    });
    if (applied) legacyOrdersExpired += 1;
  }

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
      legacyOrdersExpired
  };
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
