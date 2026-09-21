import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";
import { getAppUrl, getStripe, StripeConfigurationError } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee } from "@/lib/stripe/fees";
import {
  expireOldActiveReservations,
  getActiveReservedQuantity,
  getReservationExpiry,
  reservationMinutes,
  releaseReservationForOrder,
  runSerializableReservationTransaction
} from "@/lib/tickets/reservations";

export type CheckoutCreationErrorKind =
  | "event_not_found"
  | "ticket_type_not_found"
  | "event_draft"
  | "sold_out"
  | "insufficient_availability"
  | "stripe_not_ready"
  | "invalid_amount";

export class CheckoutCreationError extends Error {
  constructor(
    readonly kind: CheckoutCreationErrorKind,
    message: string,
    readonly details: ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "CheckoutCreationError";
  }
}

export class CheckoutCreationInternalError extends Error {
  constructor() {
    super("Checkout session creation failed");
    this.name = "CheckoutCreationInternalError";
  }
}

type CreateEventCheckoutInput = {
  userId: string;
  eventId: string;
  ticketTypeId: string;
  quantity: number;
};

function emitCheckoutSessionCreationFailure(
  reason: string,
  context: Record<string, unknown>
) {
  logError("checkout.session.create_failed", { reason, ...context });
  emitMetric("checkout_session_create_failures_total", 1, { reason });
  emitOperationalAlert("checkout_session_creation_failure", {
    reason,
    ...context
  });
}

async function failPendingOrder(orderId: string, message: string) {
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) return;
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: {
        status: true,
        requiresCompensationReview: true,
        reservation: { select: { status: true } }
      }
    });
    if (order.status !== "pending") return;

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending" },
      data: {
        status: "failed",
        failedAt: new Date(),
        failureReason: "stripe_error"
      }
    });
    if (updated.count === 0) return;

    await releaseReservationForOrder(tx, orderId, message);
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "order_failed",
      source: "checkout",
      reason: "stripe_error",
      fromOrderStatus: "pending",
      toOrderStatus: "failed",
      fromReservationStatus: order.reservation?.status ?? null,
      toReservationStatus:
        order.reservation?.status === "active" ? "released" : order.reservation?.status,
      baseline: {
        orderStatus: order.status,
        reservationStatus: order.reservation?.status,
        compensationReview: order.requiresCompensationReview
      }
    });
  });
}

async function attachStripeSession(orderId: string, stripeSessionId: string) {
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) {
      throw new CheckoutCreationInternalError();
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, stripeSessionId: true }
    });

    if (order.stripeSessionId === stripeSessionId) return;
    if (order.status !== "pending" || order.stripeSessionId) {
      throw new CheckoutCreationInternalError();
    }

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending", stripeSessionId: null },
      data: { stripeSessionId }
    });
    if (updated.count === 0) throw new CheckoutCreationInternalError();

    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "stripe_session_attached",
      source: "checkout",
      stripeSessionId,
      fromOrderStatus: "pending",
      toOrderStatus: "pending"
    });
  });
}

export async function createEventCheckout({
  userId,
  eventId,
  ticketTypeId,
  quantity
}: CreateEventCheckoutInput) {
  let pendingOrderId: string | null = null;

  try {
    await failStalePreCheckoutOrders({ userId });

    const event = await prisma.event.findFirst({
      where: { id: eventId },
      select: {
        id: true,
        title: true,
        status: true,
        organisationId: true,
        organisation: {
          select: {
            id: true,
            stripeAccountId: true,
            stripeChargesEnabled: true
          }
        },
        ticketTypes: {
          where: { id: ticketTypeId },
          select: { id: true, name: true, price: true, quantity: true },
          take: 1
        }
      }
    });

    if (!event) {
      throw new CheckoutCreationError("event_not_found", "Event was not found");
    }

    if (event.status !== "published") {
      throw new CheckoutCreationError("event_draft", "Event is draft", [
        {
          path: ["eventId"],
          message: "Event must be published before tickets can be purchased"
        }
      ]);
    }

    const organisation = event.organisation;
    const ticketType = event.ticketTypes[0];

    if (!ticketType) {
      throw new CheckoutCreationError(
        "ticket_type_not_found",
        "Ticket type was not found for this event"
      );
    }

    if (ticketType.quantity <= 0) {
      throw new CheckoutCreationError("sold_out", "Tickets are sold out", [
        {
          path: ["ticketTypeId"],
          message: "Ticket type has no remaining inventory"
        }
      ]);
    }

    if (!organisation.stripeAccountId) {
      throw new CheckoutCreationError(
        "stripe_not_ready",
        "Stripe not connected",
        [
          {
            path: ["eventId"],
            message:
              "Event organiser must complete Stripe onboarding before accepting payments"
          }
        ]
      );
    }

    if (!isOrganisationStripeReady(organisation)) {
      throw new CheckoutCreationError(
        "stripe_not_ready",
        "Stripe not connected",
        [
          {
            path: ["eventId"],
            message: "Connected Stripe account does not have charges enabled"
          }
        ]
      );
    }

    const totalAmount = ticketType.price * quantity;

    if (totalAmount <= 0) {
      throw new CheckoutCreationError(
        "invalid_amount",
        "Invalid checkout amount",
        [
          {
            path: ["ticketTypeId"],
            message: "Ticket price must be greater than zero"
          }
        ]
      );
    }

    const platformFeeAmount = calculatePlatformFee(totalAmount);
    const stripe = getStripe();
    const appUrl = getAppUrl();
    const reservationNow = new Date();
    const reservationExpiresAt = getReservationExpiry(reservationNow);

    logInfo("checkout.session.create_started", {
      eventId: event.id,
      organisationId: event.organisationId,
      ticketTypeId: ticketType.id,
      quantity,
      totalAmount,
      platformFeeAmount
    });

    const pendingOrder = await runSerializableReservationTransaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TicketType" WHERE id = ${ticketType.id} FOR UPDATE`;
        await expireOldActiveReservations(tx, {
          now: reservationNow,
          ticketTypeId: ticketType.id
        });

        const lockedTicketType = await tx.ticketType.findFirst({
          where: { id: ticketType.id, eventId: event.id },
          select: { id: true, quantity: true }
        });

        if (!lockedTicketType) {
          throw new CheckoutCreationError(
            "ticket_type_not_found",
            "Ticket type was not found",
            [
              {
                path: ["ticketTypeId"],
                message: "Ticket type was not found for this event"
              }
            ]
          );
        }

        const activeReservedQuantity = await getActiveReservedQuantity(
          tx,
          lockedTicketType.id,
          reservationNow
        );
        const availableNow = lockedTicketType.quantity - activeReservedQuantity;

        if (availableNow <= 0) {
          throw new CheckoutCreationError("sold_out", "Tickets are sold out", [
            {
              path: ["ticketTypeId"],
              message: "Ticket type has no remaining inventory"
            }
          ]);
        }

        if (availableNow < quantity) {
          throw new CheckoutCreationError(
            "insufficient_availability",
            "Not enough tickets available",
            [
              {
                path: ["quantity"],
                message: "Requested quantity exceeds availability"
              }
            ]
          );
        }

        const order = await tx.order.create({
          data: {
            organisationId: event.organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            quantity,
            unitPrice: ticketType.price,
            status: "pending",
            totalAmount,
            userId
          },
          select: { id: true }
        });

        await tx.ticketReservation.create({
          data: {
            orderId: order.id,
            organisationId: event.organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            userId,
            quantity,
            expiresAt: reservationExpiresAt
          }
        });

        await appendOrderLifecycleEvent(tx, {
          orderId: order.id,
          type: "order_created",
          source: "checkout",
          toOrderStatus: "pending",
          toReservationStatus: "active"
        });

        return order;
      }
    );

    pendingOrderId = pendingOrder.id;
    const stripeExpiresAt = Math.ceil(Date.now() / 1000) + reservationMinutes * 60;

    await prisma.ticketReservation.update({
      where: { orderId: pendingOrder.id },
      data: { expiresAt: new Date(stripeExpiresAt * 1000) }
    });

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: event.title },
            unit_amount: ticketType.price
          },
          quantity
        }
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeAmount,
        on_behalf_of: organisation.stripeAccountId,
        transfer_data: { destination: organisation.stripeAccountId }
      },
      success_url: `${appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/cancel`,
      expires_at: stripeExpiresAt,
      metadata: {
        orderId: pendingOrder.id,
        eventId: event.id,
        organisationId: event.organisationId,
        ticketTypeId: ticketType.id,
        quantity: String(quantity)
      }
    });

    if (!session.url) {
      emitCheckoutSessionCreationFailure("missing_redirect_url", {
        orderId: pendingOrder.id,
        stripeSessionId: session.id,
        eventId: event.id,
        organisationId: event.organisationId,
        ticketTypeId: ticketType.id
      });
      await failPendingOrder(
        pendingOrder.id,
        "Stripe Checkout Session did not include a redirect URL"
      );
      pendingOrderId = null;
      throw new CheckoutCreationInternalError();
    }

    await attachStripeSession(pendingOrder.id, session.id);

    logInfo("checkout.session.created", {
      orderId: pendingOrder.id,
      stripeSessionId: session.id,
      eventId: event.id,
      organisationId: event.organisationId,
      ticketTypeId: ticketType.id
    });

    return { url: session.url };
  } catch (error) {
    if (error instanceof CheckoutCreationError) {
      throw error;
    }

    if (error instanceof StripeConfigurationError) {
      emitCheckoutSessionCreationFailure("stripe_configuration_error", {
        eventId,
        quantity,
        ticketTypeId,
        error
      });
      throw error;
    }

    if (error instanceof CheckoutCreationInternalError) {
      throw error;
    }

    if (pendingOrderId) {
      await failPendingOrder(
        pendingOrderId,
        "Failed to create Stripe Checkout Session"
      );
    }

    emitCheckoutSessionCreationFailure("stripe_error", {
      eventId,
      quantity,
      ticketTypeId,
      error
    });
    throw error;
  }
}
