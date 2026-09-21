import type {
  OrderLifecycleEventType,
  OrderLifecycleSource,
  OrderStatus,
  Prisma,
  ReservationStatus
} from "@prisma/client";

type LifecycleClient = Prisma.TransactionClient;

export type OrderLifecycleFacts = {
  compensationReview?: boolean;
  emailMode?: "automatic" | "manual";
  emailTerminal?: boolean;
  legacyHistoryIncomplete?: boolean;
  ticketCount?: number;
};

export type AppendOrderLifecycleEventInput = {
  orderId: string;
  type: OrderLifecycleEventType;
  source: OrderLifecycleSource;
  actorUserId?: string | null;
  stripeEventId?: string | null;
  stripeSessionId?: string | null;
  emailOutboxId?: string | null;
  reason?: string | null;
  fromOrderStatus?: OrderStatus | null;
  toOrderStatus?: OrderStatus | null;
  fromReservationStatus?: ReservationStatus | null;
  toReservationStatus?: ReservationStatus | null;
  facts?: OrderLifecycleFacts;
  baseline?: {
    orderStatus: OrderStatus;
    reservationStatus?: ReservationStatus | null;
    compensationReview?: boolean;
  };
};

export async function lockOrder(tx: LifecycleClient, orderId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Order" WHERE "id" = ${orderId} FOR UPDATE
  `;
  return rows.length > 0;
}

async function nextSequence(tx: LifecycleClient, orderId: string) {
  const latest = await tx.orderLifecycleEvent.findFirst({
    where: { orderId },
    orderBy: { sequence: "desc" },
    select: { sequence: true }
  });
  return (latest?.sequence ?? 0) + 1;
}

export async function appendOrderLifecycleEvent(
  tx: LifecycleClient,
  input: AppendOrderLifecycleEventInput
) {
  // Callers must hold the order lock, or have created the order in this transaction.
  let sequence = await nextSequence(tx, input.orderId);

  if (sequence === 1 && input.type !== "order_created" && input.baseline) {
    await tx.orderLifecycleEvent.create({
      data: {
        orderId: input.orderId,
        sequence,
        type: "legacy_baseline",
        source: "legacy",
        toOrderStatus: input.baseline.orderStatus,
        toReservationStatus: input.baseline.reservationStatus ?? null,
        facts: {
          compensationReview: input.baseline.compensationReview ?? false,
          legacyHistoryIncomplete: true
        }
      }
    });
    sequence += 1;
  }

  return tx.orderLifecycleEvent.create({
    data: {
      orderId: input.orderId,
      sequence,
      type: input.type,
      source: input.source,
      actorUserId: input.actorUserId ?? null,
      stripeEventId: input.stripeEventId ?? null,
      stripeSessionId: input.stripeSessionId ?? null,
      emailOutboxId: input.emailOutboxId ?? null,
      reason: input.reason ?? null,
      fromOrderStatus: input.fromOrderStatus ?? null,
      toOrderStatus: input.toOrderStatus ?? null,
      fromReservationStatus: input.fromReservationStatus ?? null,
      toReservationStatus: input.toReservationStatus ?? null,
      facts: input.facts as Prisma.InputJsonValue | undefined
    }
  });
}

export function reconciliationLifecycleSource(
  source: "webhook" | "dev_success_fallback"
): "stripe_webhook" | "development_fallback" {
  return source === "webhook" ? "stripe_webhook" : "development_fallback";
}
