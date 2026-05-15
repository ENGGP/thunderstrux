import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
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

    const reservationBackedOrders = await tx.order.updateMany({
      where: {
        ...eventScope,
        ...(ticketTypeId ? { ticketTypeId } : {}),
        ...(userId ? { userId } : {}),
        status: "pending",
        reservation: {
          is: {
            OR: [
              { status: "expired" },
              {
                expiresAt: {
                  lte: now
                }
              }
            ]
          }
        }
      },
      data: {
        status: "expired",
        failureReason: null
      }
    });

    const legacyReservationlessOrders = await tx.order.updateMany({
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
      data: {
        status: "expired",
        failureReason: null
      }
    });

    const ordersUpdated =
      reservationBackedOrders.count + legacyReservationlessOrders.count;

    return {
      reservationsUpdated: reservations.count,
      reservationBackedOrdersUpdated: reservationBackedOrders.count,
      legacyReservationlessOrdersUpdated: legacyReservationlessOrders.count,
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
  const limit = normaliseBatchLimit(requestedLimit);
  const legacyPendingCutoff = new Date(
    now.getTime() - stalePreCheckoutOrderMinutes * 60 * 1000
  );

  const reservationCandidates = dryRun
    ? await selectExpiredReservationCandidates({ db: prisma, limit, now, lock: false })
    : await prisma.$transaction((tx) =>
        selectExpiredReservationCandidates({ db: tx, limit, now, lock: true })
      );
  const reservationIds = reservationCandidates.map((reservation) => reservation.id);
  const reservationOrderIds = reservationCandidates.map(
    (reservation) => reservation.orderId
  );
  const afterReservationLimit = Math.max(0, limit - reservationCandidates.length);
  const alreadyExpiredReservationBackedOrderCandidates =
    afterReservationLimit > 0
      ? dryRun
        ? await selectAlreadyExpiredReservationBackedOrderCandidates({
            db: prisma,
            limit: afterReservationLimit,
            lock: false
          })
        : await prisma.$transaction((tx) =>
            selectAlreadyExpiredReservationBackedOrderCandidates({
              db: tx,
              limit: afterReservationLimit,
              lock: true
            })
          )
      : [];
  const alreadyExpiredReservationBackedOrderIds =
    alreadyExpiredReservationBackedOrderCandidates.map((order) => order.id);
  const remainingLimit = Math.max(
    0,
    afterReservationLimit - alreadyExpiredReservationBackedOrderCandidates.length
  );
  const legacyOrderCandidates =
    remainingLimit > 0
      ? dryRun
        ? await selectLegacyPendingOrderCandidates({
            db: prisma,
            limit: remainingLimit,
            legacyPendingCutoff,
            lock: false
          })
        : await prisma.$transaction((tx) =>
            selectLegacyPendingOrderCandidates({
              db: tx,
              limit: remainingLimit,
              legacyPendingCutoff,
              lock: true
            })
          )
      : [];
  const legacyOrderIds = legacyOrderCandidates.map((order) => order.id);

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

  const reservationsExpired =
    reservationIds.length > 0
      ? await prisma.ticketReservation.updateMany({
          where: {
            id: { in: reservationIds },
            status: "active"
          },
          data: {
            status: "expired",
            releasedAt: now,
            releaseReason: "Reservation expired before checkout completed"
          }
        })
      : { count: 0 };

  const reservationBackedOrdersExpired =
    reservationOrderIds.length > 0
      ? await prisma.order.updateMany({
          where: {
            id: { in: reservationOrderIds },
            status: "pending",
            reservation: {
              is: {
                id: { in: reservationIds },
                status: "expired"
              }
            }
          },
          data: {
            status: "expired",
            failureReason: null
          }
        })
      : { count: 0 };

  const alreadyExpiredReservationBackedOrdersExpired =
    alreadyExpiredReservationBackedOrderIds.length > 0
      ? await prisma.order.updateMany({
          where: {
            id: { in: alreadyExpiredReservationBackedOrderIds },
            status: "pending",
            reservation: {
              is: {
                status: "expired"
              }
            }
          },
          data: {
            status: "expired",
            failureReason: null
          }
        })
      : { count: 0 };

  const legacyOrdersExpired =
    legacyOrderIds.length > 0
      ? await prisma.order.updateMany({
          where: {
            id: { in: legacyOrderIds },
            status: "pending",
            reservation: {
              is: null
            }
          },
          data: {
            status: "expired",
            failureReason: null
          }
        })
      : { count: 0 };

  return {
    dryRun,
    limit,
    now: now.toISOString(),
    legacyPendingCutoff: legacyPendingCutoff.toISOString(),
    reservationsSelected: reservationCandidates.length,
    reservationsExpired: reservationsExpired.count,
    reservationBackedOrdersExpired: reservationBackedOrdersExpired.count,
    alreadyExpiredReservationBackedOrdersSelected:
      alreadyExpiredReservationBackedOrderCandidates.length,
    alreadyExpiredReservationBackedOrdersExpired:
      alreadyExpiredReservationBackedOrdersExpired.count,
    legacyOrdersSelected: legacyOrderCandidates.length,
    legacyOrdersExpired: legacyOrdersExpired.count,
    ordersExpired:
      reservationBackedOrdersExpired.count +
      alreadyExpiredReservationBackedOrdersExpired.count +
      legacyOrdersExpired.count
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
