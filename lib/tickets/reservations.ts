import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const reservationMinutes = 30;
export const maxReservationTransactionAttempts = 3;

export function getReservationExpiry(now = new Date()) {
  return new Date(now.getTime() + reservationMinutes * 60 * 1000);
}

function isPrismaErrorCode(error: unknown, code: string) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
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
        isPrismaErrorCode(error, "P2034")
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
    ticketTypeId,
    userId
  }: {
    now?: Date;
    organisationId?: string;
    ticketTypeId?: string;
    userId?: string;
  } = {}
) {
  const expiredReservations = await tx.ticketReservation.findMany({
    where: {
      ...(organisationId ? { organisationId } : {}),
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
  );

  const reservations = await tx.ticketReservation.updateMany({
    where: {
      orderId: {
        in: expiredOrderIds
      },
      status: "active"
    },
    data: {
      status: "expired",
      releasedAt: now,
      releaseReason: "Reservation expired before checkout completed"
    }
  });

  if (expiredOrderIds.length > 0) {
    await tx.order.updateMany({
      where: {
        id: {
          in: expiredOrderIds
        },
        status: "pending"
      },
      data: {
        status: "expired",
        failureReason: null
      }
    });
  }

  return reservations;
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
