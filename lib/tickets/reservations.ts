import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTransactionConflict } from "@/lib/transaction-conflict";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";

export const reservationMinutes = 30;
export const maxReservationTransactionAttempts = 3;

export function getReservationExpiry(now = new Date()) {
  return new Date(now.getTime() + reservationMinutes * 60 * 1000);
}

export async function runSerializableReservationTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  for (let attempt = 1; attempt <= maxReservationTransactionAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
    } catch (error) {
      if (
        attempt < maxReservationTransactionAttempts &&
        isTransactionConflict(error)
      ) {
        console.info("Retrying reservation transaction after write conflict", {
          attempt
        });
        continue;
      }

      throw error;
    }
  }

  throw new Error("Reservation transaction retry limit exceeded");
}

export async function expireOldActiveReservations(
  tx: Prisma.TransactionClient,
  {
    now = new Date(),
    organisationId,
    eventId,
    ticketTypeId,
    userId
  }: {
    now?: Date;
    organisationId?: string;
    eventId?: string;
    ticketTypeId?: string;
    userId?: string;
  } = {}
) {
  const organisationScope = organisationId
    ? { event: { is: { organisationId } } }
    : {};
  const expiredReservations = await tx.ticketReservation.findMany({
    where: {
      ...organisationScope,
      ...(eventId ? { eventId } : {}),
      ...(ticketTypeId ? { ticketTypeId } : {}),
      ...(userId ? { userId } : {}),
      status: "active",
      expiresAt: {
        lte: now
      }
    },
    select: {
      orderId: true
    }
  });
  const expiredOrderIds = expiredReservations.map(
    (reservation) => reservation.orderId
  ).sort();

  let count = 0;
  for (const orderId of expiredOrderIds) {
    if (!(await lockOrder(tx, orderId))) continue;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true, expiresAt: true } }
      }
    });
    if (
      order?.status !== "pending" ||
      order.reservation?.status !== "active" ||
      order.reservation.expiresAt > now
    ) continue;
    const reservation = await tx.ticketReservation.updateMany({
      where: { orderId, status: "active", expiresAt: { lte: now } },
      data: {
        status: "expired",
        releasedAt: now,
        releaseReason: "Reservation expired before checkout completed"
      }
    });
    if (reservation.count === 0) continue;
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: { status: "expired", failureReason: null }
    });
    if (updated.count === 0) continue;
    await appendOrderLifecycleEvent(tx, {
      orderId,
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
    count += 1;
  }

  return { count };
}

export async function getActiveReservedQuantity(
  tx: Prisma.TransactionClient,
  ticketTypeId: string,
  now = new Date()
) {
  const result = await tx.ticketReservation.aggregate({
    where: {
      ticketTypeId,
      status: "active",
      expiresAt: {
        gt: now
      }
    },
    _sum: {
      quantity: true
    }
  });

  return result._sum.quantity ?? 0;
}

export async function findActiveReservationForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  now = new Date()
) {
  return tx.ticketReservation.findFirst({
    where: {
      orderId,
      status: "active",
      expiresAt: {
        gt: now
      }
    },
    select: {
      id: true,
      orderId: true,
      quantity: true,
      expiresAt: true
    }
  });
}

export async function releaseReservationForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
  now = new Date()
) {
  return tx.ticketReservation.updateMany({
    where: {
      orderId,
      status: "active"
    },
    data: {
      status: "released",
      releasedAt: now,
      releaseReason: reason
    }
  });
}

export async function expireReservationForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
  now = new Date()
) {
  return tx.ticketReservation.updateMany({
    where: {
      orderId,
      status: "active"
    },
    data: {
      status: "expired",
      releasedAt: now,
      releaseReason: reason
    }
  });
}

export async function confirmReservationForOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  now = new Date()
) {
  return tx.ticketReservation.updateMany({
    where: {
      orderId,
      status: "active",
      expiresAt: {
        gt: now
      }
    },
    data: {
      status: "confirmed",
      confirmedAt: now,
      releasedAt: null,
      releaseReason: null
    }
  });
}
