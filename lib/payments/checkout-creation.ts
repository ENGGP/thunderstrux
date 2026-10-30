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
import { holdEndsAt } from "@/lib/checkout-hold";
import { formatClock, formatMoney } from "@/lib/format";
import { zoneCity } from "@/lib/zoned-time";
import { maxTicketsPerOrder } from "@/lib/validators/payments";
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
import { activeEntitlementGrant, memberPriceTicketCount } from "@/lib/memberships/grants";
import { appendOrderLifecycleEvent } from "@/lib/payments/order-lifecycle";
import { getAppUrl, getStripe, StripeConfigurationError } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee, isBelowPaidMinimum, minPaidPrice, PLATFORM_FEE_POLICY_VERSION } from "@/lib/stripe/fees";
import { codeAppliesTo, codeRefusalMessage, normaliseTicketCode, priceWithCode, readTicketCode } from "@/lib/events/ticket-codes";
import { PURCHASE_SNAPSHOT_VERSION } from "@/lib/purchases/projection";
import { getReservationExpiry, runReservationTransaction } from "@/lib/tickets/reservations";

export type CheckoutCreationErrorKind =
  | "event_not_found"
  | "ticket_type_not_found"
  | "event_draft"
  | "sales_closed"
  | "sold_out"
  | "insufficient_availability"
  | "purchase_in_progress"
  | "free_limit_reached"
  | "member_price_limit"
  | "price_below_minimum"
  | "stripe_not_ready"
  | "quote_changed"
  | "code_unavailable"
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
  // A discount, access or comp code; checked again here under the event lock.
  code?: string;
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
    checkoutHoldMinutes: true,
    organisationId: true,
    organisation: {
      select: { id: true, name: true, timeZone: true, stripeAccountId: true, stripeChargesEnabled: true }
    },
    ticketTypes: {
      where: { id: ticketTypeId },
      select: { id: true, name: true, price: true, memberPrice: true, quantity: true, hidden: true },
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
  code: codeInput,
  idempotencyKey,
  returnOrigin
}: CreateEventCheckoutInput): Promise<EventCheckoutResult> {
  let pendingOrderId: string | null = null;
  const codeText = codeInput?.trim() ? codeInput.trim().toUpperCase() : undefined;
  const requestHash = checkoutRequestHash({ eventId, ticketTypeId, quantity, expectedUnitPrice, code: codeText });
  if (Boolean(userId) === Boolean(guest)) throw new Error("Checkout needs exactly one buyer");
  const actor: CheckoutActor = guest ? { kind: "guest", id: guest.grantId } : { kind: "user", id: userId as string };

  try {
    const earlier = await findCheckoutAttempt(prisma, actor, idempotencyKey);
    if (earlier) return replayAttempt(earlier, requestHash);

    // Every check reads state under the buyer (User or GuestIdentity), Event and
    // TicketType locks, so an edit, close or reprice cannot land between the
    // quote and the hold.
    let created;
    try {
      created = await runReservationTransaction(async (tx) => {
        // The buyer lock is the buyer's own, so its wait is short; the session check needs only this clock.
        const buyer = guest ? await lockGuestBuyer(tx, guest.grantId, new Date()) : await lockVerifiedAccount(tx, actor.id);
        // A same-key request that committed while this one waited for the buyer lock.
        const raced = await findCheckoutAttempt(tx, actor, idempotencyKey);
        if (raced) return { kind: "replay" as const, attempt: raced };
        const event = (await lockEventInventory(tx, eventId, [ticketTypeId]))
          ? await tx.event.findUnique({ where: { id: eventId }, select: lockedEventSelect(ticketTypeId) })
          : null;
        // Read after the event lock: in a rush the queue for it can outlast a sales close or part of a hold.
        const reservationNow = new Date();

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
        // Read under the event lock every checkout of this event takes, so its uses count exactly.
        const normalisedCode = codeText ? normaliseTicketCode(codeText) : null;
        const lookup = normalisedCode ? await readTicketCode(tx, event.id, normalisedCode, reservationNow) : null;
        const codeTerms = lookup?.ok ? lookup.code : lookup?.terms;
        const codeApplies = Boolean(ticketType && codeTerms && codeAppliesTo(codeTerms, ticketType));

        // A hidden type reads as missing without a code for it.
        if (!ticketType || (ticketType.hidden && !codeApplies)) {
          throw new CheckoutCreationError(
            "ticket_type_not_found",
            "Ticket type was not found for this event"
          );
        }
        // A code that applies but can't be used now is refused; one for another type is ignored.
        if (codeApplies && lookup && !lookup.ok) {
          throw new CheckoutCreationError("code_unavailable", codeRefusalMessage[lookup.reason], [{ path: ["code"], message: codeRefusalMessage[lookup.reason], value: 0 }]);
        }
        const usedCode = codeApplies && lookup?.ok ? lookup.code : null;
        if (usedCode && usedCode.remaining !== null && usedCode.remaining < quantity) {
          const left = `That code has ${usedCode.remaining} ${usedCode.remaining === 1 ? "ticket" : "tickets"} left`;
          throw new CheckoutCreationError("code_unavailable", left, [{ path: ["quantity"], message: left, value: usedCode.remaining }]);
        }

        // Lapsed holds don't count here; the stale-order job expires their orders.
        const sellable = sellableQuantity(
          ticketType,
          await readEventInventory(tx, event.id, reservationNow)
        );
        // Member price (T24b): a member account whose running membership in this
        // society carries member prices pays it. Read under the buyer lock; the
        // grant and its rights version are recorded on the order, so a normal
        // expiry during the hold keeps the quote and a revocation sends the
        // payment to review at fulfilment. Guests always pay the standard price.
        // A member gets one ticket per event at this price; the count runs under
        // the buyer lock, so racing checkouts can't both get it, and later
        // tickets pay the standard price. A member price that saves nothing
        // neither limits a member nor uses that ticket up.
        const memberGrant = userId && ticketType.memberPrice !== null && ticketType.memberPrice < ticketType.price
          ? await activeEntitlementGrant(tx, userId, event.organisationId, "member_prices", reservationNow)
          : null;
        const grant = memberGrant && (await memberPriceTicketCount(tx, actor.id, event.id, reservationNow)) === 0 ? memberGrant : null;
        // A code takes its discount off the price this buyer pays otherwise, the member price included.
        const basePrice = grant ? (ticketType.memberPrice as number) : ticketType.price;
        const unitPrice = usedCode ? priceWithCode(basePrice, usedCode) : basePrice;
        // Decided 2026-10-30: refused rather than rounded to free, so a code never gives away
        // more than staff chose; the code form refuses codes that would do this up front.
        if (isBelowPaidMinimum(unitPrice) && usedCode) {
          const message = `That code can't be used on ${ticketType.name}: it leaves less than the ${formatMoney(minPaidPrice)} paid minimum. Ask ${organisation.name} about it.`;
          throw new CheckoutCreationError("code_unavailable", message, [{ path: ["code"], message, value: 0 }]);
        }
        // A price saved before the paid minimum existed; the page has no code to blame.
        if (isBelowPaidMinimum(unitPrice)) {
          const message = `${ticketType.name} can't be sold at ${formatMoney(unitPrice)}: paid tickets start at ${formatMoney(minPaidPrice)}. Ask ${organisation.name} about it.`;
          throw new CheckoutCreationError("price_below_minimum", message, [{ path: ["ticketTypeId"], message }]);
        }
        const codeFacts = usedCode
          ? { ticketCodeId: usedCode.id, codeSnapshot: usedCode.code, discountAmount: (basePrice - unitPrice) * quantity }
          : { ticketCodeId: null, codeSnapshot: null, discountAmount: 0 };
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

        // Before the quote check: offering a new price for this quantity would only lead back here.
        if (grant && quantity > 1) {
          const message = "The member price is one ticket per member for this event. Choose 1 ticket, then buy any others at the standard price in a second checkout.";
          throw new CheckoutCreationError("member_price_limit", message, [{ path: ["quantity"], message, value: 1 }]);
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
        // without reading Stripe configuration. One buyer's free tickets on an
        // event stay within one order's worth, so nobody can claim them all.
        if (unitPrice === 0) {
          const ownFree = await tx.ticket.count({
            where: { eventId: event.id, validity: "active", order: { paymentKind: "free", ...(guest ? { guestIdentityId: guest.guestIdentityId } : { userId }) } }
          });
          if (ownFree + quantity > maxTicketsPerOrder) {
            throw new CheckoutCreationError("free_limit_reached", `You can have up to ${maxTicketsPerOrder} free tickets for this event`, [
              { path: ["quantity"], message: `You already have ${ownFree} free ${ownFree === 1 ? "ticket" : "tickets"} for this event`, value: Math.max(0, maxTicketsPerOrder - ownFree) }
            ]);
          }
          const free = await issueFreeOrder(tx, {
            membership: grant ? { grantId: grant.id, entitlementVersion: grant.entitlementVersion } : null,
            code: codeFacts,
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

        // One buyer's unpaid holds on an event stay within one order's worth, so
        // repeated checkouts can't take the whole stock off sale (SEC-005).
        const { _sum: ownHeld } = await tx.ticketReservation.aggregate({
          _sum: { quantity: true },
          where: { eventId: event.id, status: "active", expiresAt: { gt: reservationNow }, order: guest ? { guestIdentityId: guest.guestIdentityId } : { userId } }
        });
        if ((ownHeld.quantity ?? 0) + quantity > maxTicketsPerOrder) {
          // Names the open order this buyer can open, so the page links to its Return to payment and Cancel order.
          const open = await tx.checkoutAttempt.findFirst({
            where: { actorKind: actor.kind, actorId: actor.id, family: "ticket", order: { eventId: event.id, status: "pending" } },
            orderBy: { createdAt: "desc" },
            select: { orderId: true }
          });
          throw new CheckoutCreationError("purchase_in_progress", "You already have a checkout in progress for this event", [
            { path: ["quantity"], message: "Finish or cancel your open checkout first", value: maxTicketsPerOrder - (ownHeld.quantity ?? 0), ...(open?.orderId ? { id: open.orderId } : {}) }
          ]);
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
            ...codeFacts,
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
            // The event's hold (PAY-009); the job closes the Stripe page when it ends.
            expiresAt: getReservationExpiry(reservationNow, event.checkoutHoldMinutes)
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
          code: codeFacts.codeSnapshot,
          eventTitle: event.title,
          holdMinutes: event.checkoutHoldMinutes,
          holdEndsAt: holdEndsAt(reservationNow, event.checkoutHoldMinutes),
          timeZone: organisation.timeZone,
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
    const stripeExpiresAt = checkoutSessionExpiresAt(pendingOrder.holdMinutes);
    const sessionRequest: Stripe.Checkout.SessionCreateParams = {
      mode: "payment",
      // Card only, so a completed Session is paid at once; delayed methods' async
      // payment events are handled anyway (PAY-030). Endive removed payment_method_types for this filter.
      allowed_payment_method_types: ["card"],
      integration_identifier: checkoutIntegrationIdentifiers.tickets,
      customer_email: pendingOrder.buyerEmail,
      line_items: [
        {
          price_data: {
            currency: "aud",
            product_data: { name: pendingOrder.eventTitle, ...(pendingOrder.code ? { description: `Code ${pendingOrder.code}` } : {}) },
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
      // Humanitix shows its hold at checkout; Stripe's page can't count down, so it names the end.
      custom_text: {
        submit: { message: `We're holding your tickets until ${formatClock(pendingOrder.holdEndsAt, pendingOrder.timeZone)} ${zoneCity(pendingOrder.timeZone)}. After that they go back on sale.` }
      },
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
    await prisma.checkoutAttempt.update({
      where: { id: pendingOrder.attemptId },
      data: { providerRequest: sessionRequest as unknown as Prisma.InputJsonValue }
    });

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
