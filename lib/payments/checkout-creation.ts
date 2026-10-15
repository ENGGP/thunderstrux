import type { Prisma } from "@prisma/client";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { AccountVerificationError, lockVerifiedAccount } from "@/lib/auth/account-lifecycle";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { eventReadiness, salesOpen } from "@/lib/events/event-readiness";
import { lockEventInventory, readEventInventory, sellableQuantity } from "@/lib/events/inventory";
import { formatMoney } from "@/lib/format";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";
import {
  appendOrderLifecycleEvent,
  lockOrder
} from "@/lib/payments/order-lifecycle";
import { getAppUrl, getStripe, StripeConfigurationError } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee, PLATFORM_FEE_POLICY_VERSION } from "@/lib/stripe/fees";
import { PURCHASE_SNAPSHOT_VERSION } from "@/lib/purchases/projection";
import {
  expireOldActiveReservations,
  getReservationExpiry,
  reservationMinutes,
  releaseReservationForOrder,
  runSerializableReservationTransaction
} from "@/lib/tickets/reservations";

export type CheckoutCreationErrorKind =
  | "event_not_found"
  | "ticket_type_not_found"
  | "event_draft"
  | "sales_closed"
  | "sold_out"
  | "insufficient_availability"
  | "stripe_not_ready"
  | "invalid_amount"
  | "quote_changed";

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
  expectedUnitPrice: number;
};

function lockedEventSelect(ticketTypeId: string) {
  return {
    id: true,
    title: true,
    description: true,
    location: true,
    startTime: true,
    endTime: true,
    status: true,
    visibility: true,
    saleState: true,
    salesCloseAt: true,
    compensationRefundMode: true,
    organisationId: true,
    organisation: {
      select: { id: true, name: true, stripeAccountId: true, stripeChargesEnabled: true }
    },
    ticketTypes: {
      where: { id: ticketTypeId },
      select: { id: true, name: true, price: true, quantity: true },
      take: 1
    }
  } satisfies Prisma.EventSelect;
}

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
  quantity,
  expectedUnitPrice
}: CreateEventCheckoutInput) {
  let pendingOrderId: string | null = null;

  try {
    await failStalePreCheckoutOrders({ userId });

    const reservationNow = new Date();
    const reservationExpiresAt = getReservationExpiry(reservationNow);

    // Every check reads state under the User, Event and TicketType locks, so an
    // edit, close or reprice cannot land between the quote and the hold.
    const pendingOrder = await runSerializableReservationTransaction(
      async (tx) => {
        const buyer = await lockVerifiedAccount(tx, userId);
        const event = (await lockEventInventory(tx, eventId, [ticketTypeId]))
          ? await tx.event.findUnique({ where: { id: eventId }, select: lockedEventSelect(ticketTypeId) })
          : null;

        // Members-only events are concealed until membership entitlements exist (T24).
        if (!event || event.visibility === "members_only") {
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

        if (!salesOpen(event, reservationNow)) {
          throw new CheckoutCreationError("sales_closed", "Ticket sales are closed", [
            { path: ["eventId"], message: "Ticket sales for this event have closed" }
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

        await expireOldActiveReservations(tx, {
          now: reservationNow,
          ticketTypeId: ticketType.id
        });
        const sellable = sellableQuantity(
          ticketType,
          await readEventInventory(tx, event.id, reservationNow)
        );
        const [eligibility] = eventReadiness(
          { ...event, ticketTypes: [{ ...ticketType, sellable }] },
          { chargesReady: isOrganisationStripeReady(organisation), now: reservationNow }
        ).ticketTypes;

        if (eligibility.reason === "sold_out") {
          throw new CheckoutCreationError("sold_out", "Tickets are sold out", [
            {
              path: ["ticketTypeId"],
              message: "Ticket type has no remaining inventory"
            }
          ]);
        }

        if (eligibility.reason === "payments_unavailable") {
          throw new CheckoutCreationError("stripe_not_ready", "Stripe not connected", [
            {
              path: ["eventId"],
              message: organisation.stripeAccountId
                ? "Connected Stripe account does not have charges enabled"
                : "Event organiser must complete Stripe onboarding before accepting payments"
            }
          ]);
        }

        if (eligibility.reason === "free_unavailable") {
          throw new CheckoutCreationError("invalid_amount", "Invalid checkout amount", [
            {
              path: ["ticketTypeId"],
              message: "Ticket price must be greater than zero"
            }
          ]);
        }

        if (ticketType.price !== expectedUnitPrice) {
          throw new CheckoutCreationError("quote_changed", "The ticket price has changed", [
            {
              path: ["expectedUnitPrice"],
              message: `The price is now ${formatMoney(ticketType.price)} per ticket. Review it before buying.`
            }
          ]);
        }

        if (sellable < quantity) {
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

        // Configuration is read only once the request is valid, and before any write.
        const stripe = getStripe();
        const appUrl = getAppUrl();
        const totalAmount = ticketType.price * quantity;
        const platformFeeAmount = calculatePlatformFee(totalAmount);

        const order = await tx.order.create({
          data: {
            organisationId: event.organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            quantity,
            unitPrice: ticketType.price,
            status: "pending",
            totalAmount,
            compensationRefundModeSnapshot: event.compensationRefundMode,
            userId,
            // The same values the Stripe Session below charges, so the receipt never drifts from the charge.
            paymentKind: "stripe",
            purchasedTicketTypeName: ticketType.name,
            sellerName: organisation.name,
            sellerStripeAccountId: organisation.stripeAccountId,
            feeAmount: platformFeeAmount,
            feePolicyVersion: PLATFORM_FEE_POLICY_VERSION,
            snapshotVersion: PURCHASE_SNAPSHOT_VERSION,
            buyerEmailSnapshot: buyer.email,
            buyerFirstNameSnapshot: buyer.firstName,
            buyerLastNameSnapshot: buyer.lastName,
            buyerDisplayNameSnapshot: buyer.displayName,
            buyerIdentityCapturedAt: reservationNow,
            buyerIdentityProvenance: "purchase"
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

        return {
          id: order.id,
          stripe,
          appUrl,
          totalAmount,
          platformFeeAmount,
          unitPrice: ticketType.price,
          eventTitle: event.title,
          organisationId: event.organisationId,
          // Payment eligibility above guarantees a connected account.
          stripeAccountId: organisation.stripeAccountId as string
        };
      }
    );

    logInfo("checkout.session.create_started", {
      orderId: pendingOrder.id,
      eventId,
      organisationId: pendingOrder.organisationId,
      ticketTypeId,
      quantity,
      totalAmount: pendingOrder.totalAmount,
      platformFeeAmount: pendingOrder.platformFeeAmount
    });

    pendingOrderId = pendingOrder.id;
    const stripeExpiresAt = Math.ceil(Date.now() / 1000) + reservationMinutes * 60;

    await prisma.ticketReservation.update({
      where: { orderId: pendingOrder.id },
      data: { expiresAt: new Date(stripeExpiresAt * 1000) }
    });

    const session = await pendingOrder.stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: pendingOrder.eventTitle },
            unit_amount: pendingOrder.unitPrice
          },
          quantity
        }
      ],
      payment_intent_data: {
        application_fee_amount: pendingOrder.platformFeeAmount,
        on_behalf_of: pendingOrder.stripeAccountId,
        transfer_data: { destination: pendingOrder.stripeAccountId },
        metadata: {
          orderId: pendingOrder.id,
          eventId,
          organisationId: pendingOrder.organisationId,
          ticketTypeId,
          quantity: String(quantity)
        }
      },
      success_url: `${pendingOrder.appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${pendingOrder.appUrl}/cancel`,
      expires_at: stripeExpiresAt,
      metadata: {
        orderId: pendingOrder.id,
        eventId,
        organisationId: pendingOrder.organisationId,
        ticketTypeId,
        quantity: String(quantity)
      }
    });

    if (!session.url) {
      emitCheckoutSessionCreationFailure("missing_redirect_url", {
        orderId: pendingOrder.id,
        stripeSessionId: session.id,
        eventId,
        organisationId: pendingOrder.organisationId,
        ticketTypeId
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
      eventId,
      organisationId: pendingOrder.organisationId,
      ticketTypeId
    });

    return { url: session.url };
  } catch (error) {
    if (error instanceof CheckoutCreationError || error instanceof AccountVerificationError) {
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
