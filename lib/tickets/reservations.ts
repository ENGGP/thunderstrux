import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { holdEndsAt } from "@/lib/checkout-hold";
import { isTransactionConflict } from "@/lib/transaction-conflict";

export const maxReservationTransactionAttempts = 3;

// Seats stay held this long past the hold's end (DEF-033, PAY-009). The stale-order
// job closes the Stripe page when the hold ends and frees the seats on Stripe's
// answer, so the margin only matters while Stripe can't be asked: a payment made
// just in time still finds its seats. Commerce stock is counted the same way.
export const lateWebhookGraceMs = 5 * 60 * 1000;

// When a reservation started now lapses: the event's hold, then the margin.
export function getReservationExpiry(now: Date, holdMinutes: number) {
  return new Date(holdEndsAt(now, holdMinutes).getTime() + lateWebhookGraceMs);
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

// PAY-095: a checkout reads the seller's Stripe account under KEY SHARE on its society, which
// conflicts with a disconnect's FOR UPDATE. Then the disconnect either waits and counts this
// checkout's order, or commits first and the checkout reads the unlinked account. The order
// insert's foreign key takes the same lock later anyway, so the lock order (Event, then
// Organisation) is unchanged. Take it before reading the account.
export async function lockSellerForCheckout(tx: Prisma.TransactionClient, seller: { eventId: string } | { organisationId: string }) {
  if ("eventId" in seller) {
    await tx.$queryRaw`SELECT o."id" FROM "Organisation" o JOIN "Event" e ON e."organisationId" = o."id" WHERE e."id" = ${seller.eventId} FOR KEY SHARE OF o`;
  } else {
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${seller.organisationId} FOR KEY SHARE`;
  }
}

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
