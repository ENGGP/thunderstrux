import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isTransactionConflict } from "@/lib/transaction-conflict";

export const reservationMinutes = 30;
export const maxReservationTransactionAttempts = 3;

export function getReservationExpiry(now = new Date()) {
  return new Date(now.getTime() + reservationMinutes * 60 * 1000);
}

// Purchases decide everything after locking the buyer, the Event and its ticket
// types (or the family's rows), so READ COMMITTED is enough: each statement after
// the lock sees what the buyer before committed. SERIALIZABLE took its snapshot
// before the lock wait and refused every buyer queued behind another (DEF-032).
// A queue of buyers waits up to 10 s for a connection instead of failing at 2 s.
export const lockedPurchaseTransactionOptions = {
  isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
  maxWait: 10_000
};

export async function runReservationTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>
) {
  for (let attempt = 1; attempt <= maxReservationTransactionAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(operation, lockedPurchaseTransactionOptions);
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
