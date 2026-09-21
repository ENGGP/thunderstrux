import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import { prisma } from "@/lib/db";
import { isTransactionConflict } from "@/lib/transaction-conflict";
import { enqueueAutomaticTicketEmailForOrder } from "@/lib/email/ticket-email-outbox";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import {
  appendOrderLifecycleEvent,
  lockOrder,
  reconciliationLifecycleSource
} from "@/lib/payments/order-lifecycle";
import {
  confirmReservationForOrder,
  expireReservationForOrder,
  findActiveReservationForOrder,
  releaseReservationForOrder
} from "@/lib/tickets/reservations";

const expectedCurrency = "aud";
const maxTransactionAttempts = 3;

type CompensationAlertPayload = {
  orderId: string;
  stripeSessionId: string;
  eventId: string;
  reason: string;
};

export type CheckoutReconciliationResult =
  | { status: "fulfilled"; orderId: string }
  | { status: "already_paid"; orderId: string }
  | { status: "compensation_required"; orderId: string; reason: string }
  | { status: "expired"; orderId: string }
  | { status: "failed"; orderId: string; reason: string }
  | { status: "ignored"; orderId?: string; reason: string };

function reconciliationError(message: string, details: Record<string, unknown>) {
  console.error("Stripe checkout reconciliation failed", {
    message,
    ...details
  });
}

function parseMetadataQuantity(quantity: string | undefined) {
  if (!quantity) {
    return null;
  }

  const parsedQuantity = Number(quantity);

  return Number.isInteger(parsedQuantity) && parsedQuantity > 0
    ? parsedQuantity
    : null;
}

export async function runCheckoutReconciliationTransaction(
  operation: (tx: Prisma.TransactionClient) => Promise<void>
) {
  for (let attempt = 1; attempt <= maxTransactionAttempts; attempt += 1) {
    try {
      await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable
      });
      return;
    } catch (error) {
      if (attempt < maxTransactionAttempts && isTransactionConflict(error)) {
        console.info("Retrying Stripe webhook transaction after write conflict", {
          attempt
        });
        continue;
      }

      throw error;
    }
  }
}

export async function findOrderForCheckoutSession(
  session: Stripe.Checkout.Session,
  tx: Prisma.TransactionClient
) {
  const orderId = session.metadata?.orderId;
  const select = {
    id: true,
    status: true,
    stripeSessionId: true,
    failureReason: true,
    requiresCompensationReview: true
  } satisfies Prisma.OrderSelect;
  const [orderByMetadataId, orderBySessionId] = await Promise.all([
    orderId
      ? tx.order.findUnique({
          where: { id: orderId },
          select
        })
      : null,
    session.id
      ? tx.order.findUnique({ where: { stripeSessionId: session.id }, select })
      : null
  ]);

  return {
    order: orderByMetadataId ?? orderBySessionId,
    ambiguous: Boolean(
      orderByMetadataId &&
        orderBySessionId &&
        orderByMetadataId.id !== orderBySessionId.id
    )
  };
}

export async function reconcileExpiredCheckoutSession(
  session: Stripe.Checkout.Session,
  { stripeEventId }: { stripeEventId?: string } = {}
): Promise<CheckoutReconciliationResult> {
  let result: CheckoutReconciliationResult = {
    status: "ignored",
    reason: "not_reconciled"
  };

  await runCheckoutReconciliationTransaction(async (tx) => {
    const resolution = await findOrderForCheckoutSession(session, tx);

    if (resolution.ambiguous) {
      logError("stripe.webhook.reconciliation_failed", {
        message: "Expired Stripe session and metadata resolve different orders",
        stripeSessionId: session.id,
        metadataOrderId: session.metadata?.orderId
      });
      emitOperationalAlert("payment_reconciliation_ambiguous_order", {
        stripeSessionId: session.id,
        metadataOrderId: session.metadata?.orderId,
        checkoutEvent: "checkout.session.expired"
      });
      result = { status: "ignored", reason: "ambiguous_order_match" };
      return;
    }

    const foundOrder = resolution.order;

    if (!foundOrder) {
      logError("stripe.webhook.reconciliation_failed", {
        message: "Local order not found for expired Stripe session",
        stripeSessionId: session.id,
        metadataOrderId: session.metadata?.orderId
      });
      result = { status: "ignored", reason: "order_not_found" };
      return;
    }

    if (!(await lockOrder(tx, foundOrder.id))) {
      result = { status: "ignored", reason: "order_not_found" };
      return;
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: foundOrder.id },
      select: {
        id: true,
        status: true,
        stripeSessionId: true,
        failureReason: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true } }
      }
    });

    logInfo("stripe.webhook.received", {
      orderId: order.id,
      stripeSessionId: session.id,
      status: order.status
    });

    if (order.status === "paid") {
      logInfo("stripe.webhook.ignored", {
        orderId: order.id,
        stripeSessionId: session.id
      });
      result = { status: "already_paid", orderId: order.id };
      return;
    }

    if (order.stripeSessionId && order.stripeSessionId !== session.id) {
      logError("stripe.webhook.reconciliation_failed", {
        message: "Expired Stripe session id does not match local order",
        orderId: order.id,
        stripeSessionId: session.id,
        orderStripeSessionId: order.stripeSessionId
      });
      result = {
        status: "ignored",
        orderId: order.id,
        reason: "session_mismatch"
      };
      return;
    }

    if (order.status === "failed" || order.status === "expired") {
      logInfo("stripe.webhook.ignored", {
        orderId: order.id,
        stripeSessionId: session.id,
        ...(order.status === "failed"
          ? { failureReason: order.failureReason }
          : {})
      });
      result =
        order.status === "expired"
          ? { status: "expired", orderId: order.id }
          : {
              status: "failed",
              orderId: order.id,
              reason: order.failureReason ?? "order_already_failed"
            };
      return;
    }

    if (order.status !== "pending") {
      logError("stripe.webhook.reconciliation_failed", {
        message: "Expired Stripe session order is not pending",
        orderId: order.id,
        stripeSessionId: session.id,
        status: order.status
      });
      result = {
        status: "ignored",
        orderId: order.id,
        reason: "order_not_pending"
      };
      return;
    }

    const now = new Date();
    await tx.order.update({
      where: { id: order.id },
      data: {
        status: "expired",
        stripeSessionId: order.stripeSessionId ?? session.id,
        failureReason: null
      }
    });
    await expireReservationForOrder(
      tx,
      order.id,
      "Stripe Checkout Session expired before payment",
      now
    );
    await appendOrderLifecycleEvent(tx, {
      orderId: order.id,
      type: "order_expired",
      source: "stripe_webhook",
      stripeEventId,
      stripeSessionId: session.id,
      fromOrderStatus: "pending",
      toOrderStatus: "expired",
      fromReservationStatus: order.reservation?.status ?? null,
      toReservationStatus:
        order.reservation?.status === "active" ? "expired" : order.reservation?.status,
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });

    logInfo("stripe.webhook.received", {
      orderId: order.id,
      stripeSessionId: session.id
    });
    result = { status: "expired", orderId: order.id };
  });

  return result;
}

export async function reconcileCompletedCheckoutSession(
  session: Stripe.Checkout.Session,
  {
    stripeEventId,
    source = "webhook"
  }: {
    stripeEventId?: string;
    source?: "webhook" | "dev_success_fallback";
  } = {}
): Promise<CheckoutReconciliationResult> {
  console.info("Stripe checkout completed reconciliation started", {
    source,
    stripeEventId,
    stripeSessionId: session.id,
    paymentStatus: session.payment_status,
    metadataOrderId: session.metadata?.orderId
  });

  if (!session.id) {
    reconciliationError("Stripe session missing id", { source, stripeEventId });
    return {
      status: "ignored",
      reason: "missing_session_id"
    } satisfies CheckoutReconciliationResult;
  }

  const metadata = session.metadata;
  const orderId = metadata?.orderId;
  const eventId = metadata?.eventId;
  const organisationId = metadata?.organisationId;
  const ticketTypeId = metadata?.ticketTypeId;
  const metadataQuantity = parseMetadataQuantity(metadata?.quantity);
  const hasRequiredMetadata =
    Boolean(orderId) &&
    Boolean(eventId) &&
    Boolean(organisationId) &&
    Boolean(ticketTypeId) &&
    Boolean(metadataQuantity);
  let result: CheckoutReconciliationResult = {
    status: "ignored",
    reason: "not_reconciled"
  };
  let compensationAlert: CompensationAlertPayload | null = null;

  await runCheckoutReconciliationTransaction(async (tx) => {
    compensationAlert = null;
    const orderSelect = {
      id: true,
      status: true,
      organisationId: true,
      eventId: true,
      ticketTypeId: true,
      quantity: true,
      unitPrice: true,
      totalAmount: true,
      stripeSessionId: true,
      paidAt: true,
      failedAt: true,
      failureReason: true,
      requiresCompensationReview: true,
      fulfilmentFailedAt: true,
      fulfilmentFailureReason: true,
      isManuallyRefunded: true,
      reservation: {
        select: { status: true }
      },
      event: {
        select: {
          organisationId: true
        }
      },
      tickets: {
        select: { id: true }
      }
    } satisfies Prisma.OrderSelect;
    const orderByMetadataId = orderId
      ? await tx.order.findUnique({
          where: { id: orderId },
          select: orderSelect
        })
      : null;
    const orderBySessionId = await tx.order.findUnique({
      where: { stripeSessionId: session.id },
      select: orderSelect
    });

    if (
      orderByMetadataId &&
      orderBySessionId &&
      orderByMetadataId.id !== orderBySessionId.id
    ) {
      logError("stripe.webhook.reconciliation_failed", {
        message: "Stripe session and metadata resolve different orders",
        stripeEventId,
        stripeSessionId: session.id,
        metadataOrderId: orderId
      });
      emitOperationalAlert("payment_reconciliation_ambiguous_order", {
        reason: "ambiguous_order_match",
        stripeEventId,
        stripeSessionId: session.id
      });
      result = { status: "ignored", reason: "ambiguous_order_match" };
      return;
    }

    const discoveredOrder = orderByMetadataId ?? orderBySessionId;

    if (!discoveredOrder) {
      reconciliationError("Local order not found for Stripe session", {
        source,
        stripeEventId,
        stripeSessionId: session.id,
        metadataOrderId: orderId
      });
      result = {
        status: "ignored",
        reason: "order_not_found"
      };
      return;
    }

    if (
      discoveredOrder.stripeSessionId &&
      discoveredOrder.stripeSessionId !== session.id
    ) {
      result = {
        status: "ignored",
        orderId: discoveredOrder.id,
        reason: "session_mismatch"
      };
      return;
    }

    await tx.$queryRaw`
      SELECT "id" FROM "TicketType"
      WHERE "id" = ${discoveredOrder.ticketTypeId}
      FOR UPDATE
    `;
    if (!(await lockOrder(tx, discoveredOrder.id))) {
      result = { status: "ignored", reason: "order_not_found" };
      return;
    }
    const order = await tx.order.findUnique({
      where: { id: discoveredOrder.id },
      select: orderSelect
    });
    if (!order) {
      result = { status: "ignored", reason: "order_not_found" };
      return;
    }

    const localOrder = order;
    console.info("Stripe checkout order matched", {
      source,
      orderId: localOrder.id,
      stripeSessionId: session.id,
      status: localOrder.status
    });

    async function markCompensationRequired(
      reason: string,
      details: Record<string, unknown>,
      {
        releaseActiveReservation = false,
        expireActiveReservation = false
      }: {
        releaseActiveReservation?: boolean;
        expireActiveReservation?: boolean;
      } = {}
    ) {
      reconciliationError(reason, {
        source,
        orderId: localOrder.id,
        stripeSessionId: session.id,
        ...details
      });

      const now = new Date();
      await tx.order.update({
        where: { id: localOrder.id },
        data: {
          status: "failed",
          stripeSessionId: localOrder.stripeSessionId ?? session.id,
          paidAt: localOrder.paidAt ?? now,
          failedAt: localOrder.failedAt ?? now,
          failureReason: reason,
          requiresCompensationReview: true,
          fulfilmentFailedAt: localOrder.fulfilmentFailedAt ?? now,
          fulfilmentFailureReason:
            localOrder.fulfilmentFailureReason ?? reason
        }
      });

      if (!localOrder.requiresCompensationReview) {
        compensationAlert = {
          orderId: localOrder.id,
          stripeSessionId: session.id,
          eventId: localOrder.eventId,
          reason
        };
      }

      if (releaseActiveReservation) {
        await releaseReservationForOrder(tx, localOrder.id, reason, now);
      } else if (expireActiveReservation) {
        await expireReservationForOrder(tx, localOrder.id, reason, now);
      }

      if (!localOrder.requiresCompensationReview) {
        const resultingReservation = await tx.ticketReservation.findUnique({
          where: { orderId: localOrder.id },
          select: { status: true }
        });
        await appendOrderLifecycleEvent(tx, {
          orderId: localOrder.id,
          type: "compensation_required",
          source: reconciliationLifecycleSource(source),
          stripeEventId,
          stripeSessionId: session.id,
          reason,
          fromOrderStatus: localOrder.status,
          toOrderStatus: "failed",
          fromReservationStatus: localOrder.reservation?.status ?? null,
          toReservationStatus: resultingReservation?.status ?? null,
          facts: { compensationReview: true },
          baseline: {
            orderStatus: localOrder.status,
            reservationStatus: localOrder.reservation?.status,
            compensationReview: localOrder.requiresCompensationReview
          }
        });
      }

      result = {
        status: "compensation_required",
        orderId: localOrder.id,
        reason
      };
    }

    async function failOrder(reason: string, details: Record<string, unknown>) {
      reconciliationError(reason, {
        source,
        orderId: localOrder.id,
        stripeSessionId: session.id,
        ...details
      });

      await tx.order.update({
        where: { id: localOrder.id },
        data: {
          status: "failed",
          stripeSessionId: localOrder.stripeSessionId ?? session.id,
          failedAt: new Date(),
          failureReason: reason
        }
      });

      await releaseReservationForOrder(tx, localOrder.id, reason);
      await appendOrderLifecycleEvent(tx, {
        orderId: localOrder.id,
        type: "order_failed",
        source: reconciliationLifecycleSource(source),
        stripeEventId,
        stripeSessionId: session.id,
        reason,
        fromOrderStatus: localOrder.status,
        toOrderStatus: "failed",
        fromReservationStatus: localOrder.reservation?.status ?? null,
        toReservationStatus:
          localOrder.reservation?.status === "active"
            ? "released"
            : localOrder.reservation?.status,
        baseline: {
          orderStatus: localOrder.status,
          reservationStatus: localOrder.reservation?.status,
          compensationReview: localOrder.requiresCompensationReview
        }
      });
      result = {
        status: "failed",
        orderId: localOrder.id,
        reason
      };
    }

    if (localOrder.status === "paid") {
      if (localOrder.tickets.length !== localOrder.quantity) {
        reconciliationError("Paid order ticket count does not match quantity; historical integrity review required", {
          source,
          orderId: localOrder.id,
          stripeSessionId: session.id,
          expectedQuantity: localOrder.quantity,
          issuedTickets: localOrder.tickets.length
        });
      }

      result = {
        status: "already_paid",
        orderId: localOrder.id
      };
      return;
    }

    const ordinaryFailedOrder =
      localOrder.status === "failed" && !localOrder.requiresCompensationReview;

    if (localOrder.status === "failed") {
      if (localOrder.requiresCompensationReview) {
        console.info("Retrying compensation-required checkout reconciliation", {
          source,
          orderId: localOrder.id,
          stripeSessionId: session.id,
          failureReason: localOrder.fulfilmentFailureReason
        });
        if (localOrder.isManuallyRefunded) {
          result = {
            status: "compensation_required",
            orderId: localOrder.id,
            reason:
              localOrder.fulfilmentFailureReason ?? "compensation_review_required"
          };
          return;
        }
        const retryReservation = await findActiveReservationForOrder(
          tx,
          localOrder.id,
          new Date()
        );

        if (!retryReservation) {
          result = {
            status: "compensation_required",
            orderId: localOrder.id,
            reason:
              localOrder.fulfilmentFailureReason ??
              localOrder.failureReason ??
              "compensation_review_required"
          };
          return;
        }
      } else if (session.payment_status !== "paid") {
        result = {
          status: "failed",
          orderId: localOrder.id,
          reason: localOrder.failureReason ?? "order_already_failed"
        };
        return;
      }
    }

    if (
      localOrder.status !== "pending" &&
      localOrder.status !== "expired" &&
      !ordinaryFailedOrder &&
      !(
        localOrder.status === "failed" &&
        localOrder.requiresCompensationReview
      )
    ) {
      reconciliationError("Order is not pending", {
        source,
        orderId: localOrder.id,
        status: localOrder.status,
        stripeSessionId: session.id,
        failureReason: localOrder.failureReason
      });
      result = {
        status: "ignored",
        orderId: localOrder.id,
        reason: "order_not_pending"
      };
      return;
    }

    if (session.payment_status !== "paid") {
      if (localOrder.status !== "pending") {
        result =
          localOrder.status === "expired"
            ? { status: "expired", orderId: localOrder.id }
            : {
                status: "failed",
                orderId: localOrder.id,
                reason: localOrder.failureReason ?? "order_already_failed"
              };
        return;
      }
      await failOrder("webhook_mismatch", {
        mismatchReason: "Stripe session is not paid",
        paymentStatus: session.payment_status
      });
      return;
    }

    if (localOrder.status === "expired") {
      console.warn("Stripe checkout completed for expired order", {
        source,
        orderId: localOrder.id,
        stripeSessionId: session.id
      });
      await markCompensationRequired("expired_order_paid_after_payment", {
        mismatchReason: "Stripe checkout completed after local order expired"
      }, {
        expireActiveReservation: true
      });
      return;
    }

    if (!hasRequiredMetadata) {
      await markCompensationRequired("missing_required_metadata_after_payment", {
        mismatchReason: "Stripe session missing required metadata",
        metadataOrderId: orderId,
        hasEventId: Boolean(eventId),
        hasOrganisationId: Boolean(organisationId),
        hasTicketTypeId: Boolean(ticketTypeId),
        hasValidQuantity: Boolean(metadataQuantity)
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    const requiredMetadata = {
      orderId: orderId,
      eventId: eventId,
      organisationId: organisationId,
      ticketTypeId: ticketTypeId,
      quantity: metadataQuantity
    };

    if (
      !requiredMetadata.orderId ||
      !requiredMetadata.eventId ||
      !requiredMetadata.organisationId ||
      !requiredMetadata.ticketTypeId ||
      !requiredMetadata.quantity
    ) {
      await markCompensationRequired("missing_required_metadata_after_payment", {
        mismatchReason: "Stripe session missing required metadata after narrowing"
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    if (localOrder.stripeSessionId && localOrder.stripeSessionId !== session.id) {
      await markCompensationRequired("webhook_mismatch", {
        mismatchReason: "Stripe session id does not match local order",
        orderStripeSessionId: localOrder.stripeSessionId
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    if (session.amount_total !== localOrder.totalAmount) {
      await markCompensationRequired("webhook_mismatch", {
        mismatchReason: "Stripe amount does not match local order",
        stripeAmountTotal: session.amount_total,
        orderTotalAmount: localOrder.totalAmount
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    if (session.currency?.toLowerCase() !== expectedCurrency) {
      await markCompensationRequired("webhook_mismatch", {
        mismatchReason: "Stripe currency does not match expected currency",
        stripeCurrency: session.currency,
        expectedCurrency
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    if (
      localOrder.id !== requiredMetadata.orderId ||
      localOrder.eventId !== requiredMetadata.eventId ||
      localOrder.ticketTypeId !== requiredMetadata.ticketTypeId ||
      localOrder.event.organisationId !== requiredMetadata.organisationId ||
      localOrder.quantity !== requiredMetadata.quantity
    ) {
      await markCompensationRequired("webhook_mismatch", {
        mismatchReason: "Stripe metadata does not match local order",
        orderId: localOrder.id,
        metadataOrderId: requiredMetadata.orderId,
        orderEventId: localOrder.eventId,
        metadataEventId: requiredMetadata.eventId,
        orderTicketTypeId: localOrder.ticketTypeId,
        metadataTicketTypeId: requiredMetadata.ticketTypeId,
        orderOrganisationId: localOrder.organisationId,
        eventOrganisationId: localOrder.event.organisationId,
        metadataOrganisationId: requiredMetadata.organisationId,
        orderQuantity: localOrder.quantity,
        metadataQuantity: requiredMetadata.quantity
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    if (ordinaryFailedOrder) {
      await markCompensationRequired(
        "paid_session_received_after_order_failed",
        { mismatchReason: "Paid session arrived after local checkout failure" },
        { releaseActiveReservation: true }
      );
      return;
    }

    const now = new Date();
    const activeReservation = await findActiveReservationForOrder(
      tx,
      localOrder.id,
      now
    );

    if (!activeReservation) {
      const existingReservation = await tx.ticketReservation.findUnique({
        where: { orderId: localOrder.id },
        select: {
          id: true,
          status: true,
          expiresAt: true
        }
      });

      if (
        existingReservation &&
        (existingReservation.status === "expired" ||
          existingReservation.expiresAt <= now)
      ) {
        console.warn("Stripe checkout completed after reservation expiry", {
          source,
          orderId: localOrder.id,
          stripeSessionId: session.id,
          reservationStatus: existingReservation.status,
          reservationExpiresAt: existingReservation.expiresAt
        });

        await markCompensationRequired("reservation_expired_after_payment", {
          mismatchReason: "Reservation expired before paid checkout session was reconciled",
          reservationStatus: existingReservation.status,
          reservationExpiresAt: existingReservation.expiresAt
        }, {
          expireActiveReservation: true
        });
        await expireReservationForOrder(
          tx,
          localOrder.id,
          "Reservation expired before checkout completed",
          now
        );
        return;
      }

      await markCompensationRequired("reservation_missing_after_payment", {
        mismatchReason: "Ticket reservation not found for paid checkout session",
        reservationStatus: existingReservation?.status,
        reservationExpiresAt: existingReservation?.expiresAt
      });
      return;
    }

    if (activeReservation.quantity !== localOrder.quantity) {
      await markCompensationRequired("reservation_quantity_mismatch_after_payment", {
        mismatchReason: "Ticket reservation quantity does not match order",
        reservationQuantity: activeReservation.quantity,
        orderQuantity: localOrder.quantity
      }, {
        releaseActiveReservation: true
      });
      return;
    }

    console.info("Stripe checkout reconciliation validation passed", {
      source,
      orderId: localOrder.id,
      stripeSessionId: session.id,
      quantity: localOrder.quantity,
      totalAmount: localOrder.totalAmount
    });

    const claimedOrder = await tx.order.updateMany({
      where: {
        id: localOrder.id,
        OR: [
          { status: "pending" },
          {
            status: "failed",
            requiresCompensationReview: true
          }
        ]
      },
      data: {
        status: "paid",
        stripeSessionId: session.id,
        paidAt: now,
        failedAt: null,
        failureReason: null,
        requiresCompensationReview: false
      }
    });

    if (claimedOrder.count === 0) {
      result = {
        status: "ignored",
        orderId: localOrder.id,
        reason: "order_claim_failed"
      };
      return;
    }

    const confirmedReservation = await confirmReservationForOrder(
      tx,
      localOrder.id,
      now
    );

    if (confirmedReservation.count === 0) {
      await markCompensationRequired("reservation_confirm_failed_after_payment", {
        mismatchReason: "Ticket reservation could not be confirmed for paid checkout session"
      });
      return;
    }

    const inventoryUpdate = await tx.ticketType.updateMany({
      where: {
        id: localOrder.ticketTypeId,
        eventId: localOrder.eventId,
        quantity: {
          gte: localOrder.quantity
        }
      },
      data: {
        quantity: {
          decrement: localOrder.quantity
        }
      }
    });

    if (inventoryUpdate.count === 0) {
      await releaseReservationForOrder(
        tx,
        localOrder.id,
        "Insufficient ticket inventory for paid checkout session",
        now
      );
      await tx.ticketReservation.updateMany({
        where: {
          orderId: localOrder.id,
          status: "confirmed"
        },
        data: {
          status: "released",
          releasedAt: now,
          releaseReason: "Insufficient ticket inventory for paid checkout session",
          confirmedAt: null
        }
      });
      await markCompensationRequired("inventory_unavailable_after_payment", {
        mismatchReason: "Insufficient ticket inventory for paid checkout session",
        ticketTypeId: localOrder.ticketTypeId,
        requestedQuantity: localOrder.quantity
      });
      return;
    }

    console.info("Stripe checkout inventory updated", {
      source,
      orderId: localOrder.id,
      ticketTypeId: localOrder.ticketTypeId,
      quantity: localOrder.quantity
    });

    if (localOrder.organisationId !== localOrder.event.organisationId) {
      console.error("Ticket organisation mismatch tolerated; canonical event ownership used during checkout reconciliation", {
        source,
        orderId: localOrder.id,
        eventId: localOrder.eventId,
        stripeSessionId: session.id,
        orderOrganisationId: localOrder.organisationId,
        eventOrganisationId: localOrder.event.organisationId
      });
    }

    await tx.ticket.createMany({
      data: Array.from({ length: localOrder.quantity }, () => ({
        orderId: localOrder.id,
        eventId: localOrder.eventId,
        ticketTypeId: localOrder.ticketTypeId,
        organisationId: localOrder.event.organisationId
      }))
    });

    console.info("Stripe checkout tickets created", {
      source,
      orderId: localOrder.id,
      ticketCount: localOrder.quantity
    });

    await appendOrderLifecycleEvent(tx, {
      orderId: localOrder.id,
      type: localOrder.requiresCompensationReview
        ? "compensation_recovered"
        : "payment_fulfilled",
      source: reconciliationLifecycleSource(source),
      stripeEventId,
      stripeSessionId: session.id,
      fromOrderStatus: localOrder.status,
      toOrderStatus: "paid",
      fromReservationStatus: localOrder.reservation?.status ?? null,
      toReservationStatus: "confirmed",
      facts: {
        compensationReview: false,
        ticketCount: localOrder.quantity
      },
      baseline: {
        orderStatus: localOrder.status,
        reservationStatus: localOrder.reservation?.status,
        compensationReview: localOrder.requiresCompensationReview
      }
    });
    await enqueueAutomaticTicketEmailForOrder(
      tx,
      localOrder.id,
      reconciliationLifecycleSource(source)
    );

    result = {
      status: "fulfilled",
      orderId: localOrder.id
    };
  });

  const alertToEmit = compensationAlert as CompensationAlertPayload | null;

  if (alertToEmit) {
    emitOperationalAlert("paid_but_unfulfilled_compensation_required", {
      orderId: alertToEmit.orderId,
      stripeSessionId: alertToEmit.stripeSessionId,
      eventId: alertToEmit.eventId,
      reason: alertToEmit.reason,
      source
    });
  }

  return result;
}
