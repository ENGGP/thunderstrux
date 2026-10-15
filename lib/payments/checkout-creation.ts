import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
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
  attemptReconcileDelayMs,
  checkoutAttemptStatus,
  checkoutRequestHash,
  eventCheckoutOperation,
  findUserCheckoutAttempt,
  isDefiniteProviderFailure,
  markAttemptUncertain,
  newProviderOperationKey,
  type CheckoutAttemptWithOrder
} from "@/lib/payments/checkout-attempts";
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
  | "quote_changed"
  | "idempotency_conflict";

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
  // One key per purchase intent; a repeat with the same key returns the same attempt.
  idempotencyKey: string;
};

export type EventCheckoutResult =
  | { status: "redirect"; attemptId: string; url: string }
  | { status: "processing"; attemptId: string };

function replayAttempt(attempt: CheckoutAttemptWithOrder, requestHash: string): EventCheckoutResult {
  if (attempt.requestHash !== requestHash) {
    throw new CheckoutCreationError("idempotency_conflict", "This checkout was already started with a different selection", [
      { path: ["idempotencyKey"], message: "Start a new checkout to change the selection" }
    ]);
  }
  const current = checkoutAttemptStatus(attempt);
  return current.status === "ready"
    ? { status: "redirect", attemptId: attempt.id, url: current.url }
    : { status: "processing", attemptId: attempt.id };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

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

type CheckoutLifecycleSource = "checkout" | "checkout_recovery";

export async function failPendingOrder(orderId: string, message: string, source: CheckoutLifecycleSource = "checkout") {
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
    await tx.checkoutAttempt.updateMany({
      where: { orderId },
      data: { state: "failed", reconcileDueAt: null, lastOutcome: "provider_failed" }
    });
    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "order_failed",
      source,
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

export async function attachStripeSession(
  orderId: string,
  stripeSessionId: string,
  stripeSessionUrl: string,
  source: CheckoutLifecycleSource = "checkout"
) {
  await prisma.$transaction(async (tx) => {
    if (!(await lockOrder(tx, orderId))) {
      throw new CheckoutCreationInternalError();
    }
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { status: true, stripeSessionId: true }
    });
    const attachAttempt = () =>
      tx.checkoutAttempt.updateMany({
        where: { orderId },
        data: { state: "provider_attached", stripeSessionId, stripeSessionUrl, reconcileDueAt: null, lastOutcome: "session_attached" }
      });

    // The webhook may have bound this Session first; converge on it.
    if (order.stripeSessionId === stripeSessionId) {
      await attachAttempt();
      return;
    }
    if (order.status !== "pending" || order.stripeSessionId) {
      await tx.checkoutAttempt.updateMany({
        where: { orderId },
        // Keep the Session on record: a payment on it reaches compensation through the webhook.
        data: { state: "failed", stripeSessionId, stripeSessionUrl, reconcileDueAt: null, lastOutcome: "order_not_pending_at_attach" }
      });
      throw new CheckoutCreationInternalError();
    }

    const updated = await tx.order.updateMany({
      where: { id: orderId, status: "pending", stripeSessionId: null },
      data: { stripeSessionId }
    });
    if (updated.count === 0) throw new CheckoutCreationInternalError();
    await attachAttempt();

    await appendOrderLifecycleEvent(tx, {
      orderId,
      type: "stripe_session_attached",
      source,
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
  expectedUnitPrice,
  idempotencyKey
}: CreateEventCheckoutInput): Promise<EventCheckoutResult> {
  let pendingOrderId: string | null = null;
  const requestHash = checkoutRequestHash({ eventId, ticketTypeId, quantity, expectedUnitPrice });

  try {
    const earlier = await findUserCheckoutAttempt(prisma, userId, idempotencyKey);
    if (earlier) return replayAttempt(earlier, requestHash);

    await failStalePreCheckoutOrders({ userId });

    const reservationNow = new Date();
    const reservationExpiresAt = getReservationExpiry(reservationNow);

    // Every check reads state under the User, Event and TicketType locks, so an
    // edit, close or reprice cannot land between the quote and the hold.
    let created;
    try {
      created = await runSerializableReservationTransaction(async (tx) => {
        const buyer = await lockVerifiedAccount(tx, userId);
        // A same-key request that committed while this one waited for the User lock.
        const raced = await findUserCheckoutAttempt(tx, userId, idempotencyKey);
        if (raced) return { kind: "replay" as const, attempt: raced };
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

        const attempt = await tx.checkoutAttempt.create({
          data: {
            family: "ticket",
            actorKind: "user",
            actorId: userId,
            operationType: eventCheckoutOperation,
            clientIdempotencyKey: idempotencyKey,
            requestHash,
            orderId: order.id,
            providerOperationKey: newProviderOperationKey(),
            reconcileDueAt: new Date(reservationNow.getTime() + attemptReconcileDelayMs)
          },
          select: { id: true, providerOperationKey: true }
        });

        return { kind: "created" as const, order: {
          id: order.id,
          attemptId: attempt.id,
          providerOperationKey: attempt.providerOperationKey,
          stripe,
          appUrl,
          totalAmount,
          platformFeeAmount,
          unitPrice: ticketType.price,
          eventTitle: event.title,
          organisationId: event.organisationId,
          // Payment eligibility above guarantees a connected account.
          stripeAccountId: organisation.stripeAccountId as string
        } };
      });
    } catch (error) {
      // A same-key request inserted its attempt first.
      const raced = isUniqueViolation(error) ? await findUserCheckoutAttempt(prisma, userId, idempotencyKey) : null;
      if (raced) return replayAttempt(raced, requestHash);
      throw error;
    }

    if (created.kind === "replay") return replayAttempt(created.attempt, requestHash);
    const pendingOrder = created.order;

    logInfo("checkout.session.create_started", {
      orderId: pendingOrder.id,
      attemptId: pendingOrder.attemptId,
      eventId,
      organisationId: pendingOrder.organisationId,
      ticketTypeId,
      quantity,
      totalAmount: pendingOrder.totalAmount,
      platformFeeAmount: pendingOrder.platformFeeAmount
    });

    pendingOrderId = pendingOrder.id;
    const stripeExpiresAt = Math.ceil(Date.now() / 1000) + reservationMinutes * 60;
    const sessionRequest: Stripe.Checkout.SessionCreateParams = {
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
    };

    // Recovery (T14b) replays exactly this request with the same key, so Stripe
    // returns the original Session instead of treating it as a new one.
    await prisma.$transaction([
      prisma.ticketReservation.update({
        where: { orderId: pendingOrder.id },
        data: { expiresAt: new Date(stripeExpiresAt * 1000) }
      }),
      prisma.checkoutAttempt.update({
        where: { id: pendingOrder.attemptId },
        data: { providerRequest: sessionRequest as unknown as Prisma.InputJsonValue }
      })
    ]);

    let session;
    try {
      session = await pendingOrder.stripe.checkout.sessions.create(sessionRequest, { idempotencyKey: pendingOrder.providerOperationKey });
    } catch (error) {
      if (isDefiniteProviderFailure(error)) throw error;
      // Stripe may have created the Session (timeout, connection or unknown
      // error): keep the order and hold, and let recovery replay the same key.
      emitCheckoutSessionCreationFailure("provider_uncertain", {
        orderId: pendingOrder.id,
        attemptId: pendingOrder.attemptId,
        eventId,
        quantity,
        ticketTypeId,
        error
      });
      await markAttemptUncertain(pendingOrder.attemptId, "session_create_unknown");
      return { status: "processing", attemptId: pendingOrder.attemptId };
    }

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

    try {
      await attachStripeSession(pendingOrder.id, session.id, session.url);
    } catch (error) {
      if (error instanceof CheckoutCreationInternalError) throw error;
      // The Session exists but could not be bound; recovery binds the same Session.
      emitCheckoutSessionCreationFailure("session_attach_failed", {
        orderId: pendingOrder.id,
        attemptId: pendingOrder.attemptId,
        stripeSessionId: session.id,
        error
      });
      await markAttemptUncertain(pendingOrder.attemptId, "session_attach_failed").catch(() => undefined);
      return { status: "processing", attemptId: pendingOrder.attemptId };
    }

    logInfo("checkout.session.created", {
      orderId: pendingOrder.id,
      stripeSessionId: session.id,
      eventId,
      organisationId: pendingOrder.organisationId,
      ticketTypeId
    });

    return { status: "redirect", attemptId: pendingOrder.attemptId, url: session.url };
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
