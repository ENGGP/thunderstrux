import type { Prisma } from "@prisma/client";
import type Stripe from "stripe";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { AccountVerificationError, lockVerifiedAccount } from "@/lib/auth/account-lifecycle";
import { GuestAccessError, lockGuestBuyer } from "@/lib/guest/guest-access";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logError, logInfo } from "@/lib/ops/logger";
import { emitMetric } from "@/lib/ops/metrics";
import { eventReadiness, salesOpen } from "@/lib/events/event-readiness";
import { lockEventInventory, readEventInventory, sellableQuantity } from "@/lib/events/inventory";
import { formatMoney } from "@/lib/format";
import { failStalePreCheckoutOrders } from "@/lib/orders/stale-orders";
import {
  attachStripeSession,
  CheckoutCreationInternalError,
  failPendingOrder
} from "@/lib/payments/checkout-binding";
import {
  attemptReconcileDelayMs,
  checkoutIntegrationIdentifiers,
  checkoutSessionExpiresAt,
  checkoutAttemptStatus,
  checkoutRequestHash,
  eventCheckoutOperation,
  findCheckoutAttempt,
  type CheckoutActor,
  isDefiniteProviderFailure,
  markAttemptUncertain,
  newProviderOperationKey,
  type CheckoutAttemptWithOrder
} from "@/lib/payments/checkout-attempts";
import { issueFreeOrder } from "@/lib/payments/free-ticket-issuance";
import { activeEntitlementGrant } from "@/lib/memberships/grants";
import { appendOrderLifecycleEvent } from "@/lib/payments/order-lifecycle";
import { getAppUrl, getStripe, StripeConfigurationError } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee, PLATFORM_FEE_POLICY_VERSION } from "@/lib/stripe/fees";
import { PURCHASE_SNAPSHOT_VERSION } from "@/lib/purchases/projection";
import {
  expireOldActiveReservations,
  getReservationExpiry,
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
  | "quote_changed"
  | "idempotency_conflict";

export { CheckoutCreationInternalError };

export class CheckoutCreationError extends Error {
  readonly details: ApiErrorDetail[];

  constructor(
    readonly kind: CheckoutCreationErrorKind,
    message: string,
    details: ApiErrorDetail[] = []
  ) {
    super(message);
    this.name = "CheckoutCreationError";
    // Each detail carries its kind, so the checkout page picks its screen from the response.
    this.details = details.map((detail) => ({ reason: kind, ...detail }));
  }
}


type CreateEventCheckoutInput = {
  // A verified member, or a guest's live checkout session (T16b); never both.
  userId?: string;
  guest?: { grantId: string; guestIdentityId: string };
  eventId: string;
  ticketTypeId: string;
  quantity: number;
  expectedUnitPrice: number;
  // One key per purchase intent; a repeat with the same key returns the same attempt.
  idempotencyKey: string;
  // Where Stripe sends the buyer back: the trusted origin they bought from, else the app URL.
  returnOrigin?: string;
};

export type EventCheckoutResult =
  | { status: "redirect"; attemptId: string; url: string }
  | { status: "processing"; attemptId: string }
  // A free registration, or a replay of a checkout whose order is already fulfilled.
  | { status: "fulfilled"; attemptId: string; orderId: string };

function replayAttempt(attempt: CheckoutAttemptWithOrder, requestHash: string): EventCheckoutResult {
  if (attempt.requestHash !== requestHash) {
    throw new CheckoutCreationError("idempotency_conflict", "This checkout was already started with a different selection", [
      { path: ["idempotencyKey"], message: "Start a new checkout to change the selection" }
    ]);
  }
  const current = checkoutAttemptStatus(attempt);
  if (current.status === "completed") return { status: "fulfilled", attemptId: attempt.id, orderId: current.orderId };
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
      select: { id: true, name: true, price: true, memberPrice: true, quantity: true },
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

export async function createEventCheckout({
  userId,
  guest,
  eventId,
  ticketTypeId,
  quantity,
  expectedUnitPrice,
  idempotencyKey,
  returnOrigin
}: CreateEventCheckoutInput): Promise<EventCheckoutResult> {
  let pendingOrderId: string | null = null;
  const requestHash = checkoutRequestHash({ eventId, ticketTypeId, quantity, expectedUnitPrice });
  if (Boolean(userId) === Boolean(guest)) throw new Error("Checkout needs exactly one buyer");
  const actor: CheckoutActor = guest ? { kind: "guest", id: guest.grantId } : { kind: "user", id: userId as string };

  try {
    const earlier = await findCheckoutAttempt(prisma, actor, idempotencyKey);
    if (earlier) return replayAttempt(earlier, requestHash);

    if (userId) await failStalePreCheckoutOrders({ userId });

    const reservationNow = new Date();
    const reservationExpiresAt = getReservationExpiry(reservationNow);

    // Every check reads state under the buyer (User or GuestIdentity), Event and
    // TicketType locks, so an edit, close or reprice cannot land between the
    // quote and the hold.
    let created;
    try {
      created = await runSerializableReservationTransaction(async (tx) => {
        const buyer = guest ? await lockGuestBuyer(tx, guest.grantId, reservationNow) : await lockVerifiedAccount(tx, actor.id);
        // A same-key request that committed while this one waited for the buyer lock.
        const raced = await findCheckoutAttempt(tx, actor, idempotencyKey);
        if (raced) return { kind: "replay" as const, attempt: raced };
        const event = (await lockEventInventory(tx, eventId, [ticketTypeId]))
          ? await tx.event.findUnique({ where: { id: eventId }, select: lockedEventSelect(ticketTypeId) })
          : null;

        // A members-only event sells only to a member account whose running
        // membership of the society unlocks it, read under the buyer lock that
        // revocation and refunds also take; anyone else gets the same answer as
        // a missing event, with no details (T24b). Guests never qualify.
        if (
          !event ||
          (event.visibility === "members_only" &&
            !(userId && (await activeEntitlementGrant(tx, userId, event.organisationId, "members_only_events", reservationNow))))
        ) {
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
        // Member price (T24b): a member account whose running membership in this
        // society carries member prices pays it. Read under the buyer lock; the
        // grant and its rights version are recorded on the order, so a normal
        // expiry during the hold keeps the quote and a revocation sends the
        // payment to review at fulfilment. Guests always pay the standard price.
        const grant = userId && ticketType.memberPrice !== null
          ? await activeEntitlementGrant(tx, userId, event.organisationId, "member_prices", reservationNow)
          : null;
        const unitPrice = grant ? (ticketType.memberPrice as number) : ticketType.price;
        const [eligibility] = eventReadiness(
          { ...event, ticketTypes: [{ ...ticketType, price: unitPrice, sellable }] },
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

        if (unitPrice !== expectedUnitPrice) {
          throw new CheckoutCreationError("quote_changed", "The ticket price has changed", [
            {
              path: ["expectedUnitPrice"],
              message: `The price is now ${formatMoney(unitPrice)} per ticket. Review it before buying.`,
              value: unitPrice
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
                message: "Requested quantity exceeds availability",
                value: sellable
              }
            ]
          );
        }

        // The locked price decides the path: a free registration completes here,
        // without reading Stripe configuration.
        if (unitPrice === 0) {
          const free = await issueFreeOrder(tx, {
            membership: grant ? { grantId: grant.id, entitlementVersion: grant.entitlementVersion } : null,
            userId: userId ?? null,
            guestIdentityId: guest?.guestIdentityId ?? null,
            buyer,
            event,
            ticketType,
            quantity,
            now: reservationNow,
            attempt: {
              family: "ticket",
              actorKind: actor.kind,
              actorId: actor.id,
              operationType: eventCheckoutOperation,
              clientIdempotencyKey: idempotencyKey,
              requestHash,
              providerOperationKey: newProviderOperationKey()
            }
          });
          return { kind: "free" as const, ...free };
        }

        // Configuration is read only once the request is valid, and before any write.
        const stripe = getStripe();
        const appUrl = returnOrigin ?? getAppUrl();
        const totalAmount = unitPrice * quantity;
        const platformFeeAmount = calculatePlatformFee(totalAmount, quantity);

        const order = await tx.order.create({
          data: {
            organisationId: event.organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            quantity,
            unitPrice,
            membershipGrantId: grant?.id ?? null,
            membershipEntitlementVersion: grant?.entitlementVersion ?? null,
            status: "pending",
            totalAmount,
            compensationRefundModeSnapshot: event.compensationRefundMode,
            userId: userId ?? null,
            guestIdentityId: guest?.guestIdentityId ?? null,
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
            buyerIdentityProvenance: guest ? "verified_guest" : "purchase"
          },
          select: { id: true }
        });

        await tx.ticketReservation.create({
          data: {
            orderId: order.id,
            organisationId: event.organisationId,
            eventId: event.id,
            ticketTypeId: ticketType.id,
            userId: userId ?? null,
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
            actorKind: actor.kind,
            actorId: actor.id,
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
          // The quoted price: the member price when a membership applied.
          unitPrice,
          eventTitle: event.title,
          organisationId: event.organisationId,
          // Payment eligibility above guarantees a connected account.
          stripeAccountId: organisation.stripeAccountId as string,
          buyerEmail: buyer.email
        } };
      });
    } catch (error) {
      // A same-key request inserted its attempt first.
      const raced = isUniqueViolation(error) ? await findCheckoutAttempt(prisma, actor, idempotencyKey) : null;
      if (raced) return replayAttempt(raced, requestHash);
      throw error;
    }

    if (created.kind === "replay") return replayAttempt(created.attempt, requestHash);
    if (created.kind === "free") {
      logInfo("checkout.free.fulfilled", { orderId: created.orderId, attemptId: created.attemptId, eventId, ticketTypeId, quantity });
      emitMetric("free_registrations_total", 1, {});
      return { status: "fulfilled", attemptId: created.attemptId, orderId: created.orderId };
    }
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
    const stripeExpiresAt = checkoutSessionExpiresAt();
    const sessionRequest: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      payment_method_types: ["card"],
      integration_identifier: checkoutIntegrationIdentifiers.tickets,
      customer_email: pendingOrder.buyerEmail,
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
      // A guest comes back to their order page; their session cookie opens it, the address alone does not.
      success_url: guest ? `${pendingOrder.appUrl}/guest/orders/${pendingOrder.id}` : `${pendingOrder.appUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
      // The cancel page names the order only to whoever bought it.
      cancel_url: `${pendingOrder.appUrl}/cancel?order=${pendingOrder.id}`,
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
    if (error instanceof CheckoutCreationError || error instanceof AccountVerificationError || error instanceof GuestAccessError) {
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
