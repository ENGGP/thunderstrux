import { createHash } from "node:crypto";
import type { CommerceKind, Prisma } from "@prisma/client";
import type Stripe from "stripe";
import type { ApiErrorDetail } from "@/lib/api/errors";
import { prisma } from "@/lib/db";
import { lockVerifiedAccount } from "@/lib/auth/account-lifecycle";
import { attachCommerceSession, failPendingCommerceOrder } from "@/lib/commerce/binding";
import { commerceFamilies, type CommerceBuyer } from "@/lib/commerce/families";
import { appendCommerceLifecycleEvent, commerceTotals, createCommerceOrder } from "@/lib/commerce/orders";
import { lockGuestBuyer } from "@/lib/guest/guest-access";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { logInfo } from "@/lib/ops/logger";
import { attemptReconcileDelayMs, checkoutIntegrationIdentifiers, checkoutSessionExpiresAt, isDefiniteProviderFailure, markAttemptUncertain, newProviderOperationKey, type CheckoutActor } from "@/lib/payments/checkout-attempts";
import { getAppUrl, getStripe } from "@/lib/stripe";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { calculatePlatformFee, PLATFORM_FEE_POLICY_VERSION } from "@/lib/stripe/fees";
import { commerceHoldMinutes, holdEndsAt } from "@/lib/checkout-hold";
import { formatClock } from "@/lib/format";
import { runReservationTransaction } from "@/lib/tickets/reservations";
import { zoneCity } from "@/lib/zoned-time";

// Membership and merchandise checkout (T21), the commerce twin of ticket
// checkout (database spec 6.1-6.3): a locked transaction quotes through the
// family and records the order and attempt; Stripe is called outside it with
// the attempt's stable key; the Session is then bound to the order. A free
// total is fulfilled in the same transaction. Fulfilment of a paid order only
// ever happens from the signed webhook (lib/commerce/reconciliation.ts).

export const commerceCheckoutOperation = "commerce_checkout";

export type CommerceCheckoutErrorKind = "not_available" | "members_only" | "quote_changed" | "stripe_not_ready" | "idempotency_conflict" | "unavailable";

export class CommerceCheckoutError extends Error {
  constructor(readonly kind: CommerceCheckoutErrorKind, message: string, readonly details: ApiErrorDetail[] = []) {
    super(message);
    this.name = "CommerceCheckoutError";
  }
}

// The request's selection was malformed. Kept apart from other validation
// failures so an internal error is never reported to the buyer as theirs.
export class CommerceSelectionError extends Error {
  constructor(readonly issues: Array<{ path: PropertyKey[]; message: string }>) {
    super("Invalid selection");
    this.name = "CommerceSelectionError";
  }
}

export type CommerceCheckoutResult =
  | { status: "redirect"; attemptId: string; url: string }
  | { status: "processing"; attemptId: string }
  | { status: "fulfilled"; attemptId: string; commerceOrderId: string };

// Stable JSON: the same selection hashes the same whatever its key order.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const commerceRequestHash = (family: CommerceKind, organisationId: string, selection: unknown, expectedTotal: number) =>
  createHash("sha256").update(canonical([family, organisationId, selection, expectedTotal])).digest("hex");

type AttemptClient = Pick<Prisma.TransactionClient, "checkoutAttempt">;

function findCommerceAttempt(db: AttemptClient, actor: CheckoutActor, family: CommerceKind, clientIdempotencyKey: string) {
  return db.checkoutAttempt.findFirst({
    where: { actorKind: actor.kind, actorId: actor.id, family, operationType: commerceCheckoutOperation, clientIdempotencyKey },
    include: { commerceOrder: { select: { status: true } } }
  });
}

type CommerceAttempt = NonNullable<Awaited<ReturnType<typeof findCommerceAttempt>>>;

function replay(attempt: CommerceAttempt, requestHash: string): CommerceCheckoutResult {
  if (attempt.requestHash !== requestHash) {
    throw new CommerceCheckoutError("idempotency_conflict", "This checkout was already started with a different selection", [
      { path: ["idempotencyKey"], message: "Start a new checkout to change the selection" }
    ]);
  }
  if (attempt.commerceOrder?.status === "paid" && attempt.commerceOrderId) return { status: "fulfilled", attemptId: attempt.id, commerceOrderId: attempt.commerceOrderId };
  if (attempt.state === "provider_attached" && attempt.stripeSessionUrl && attempt.commerceOrder?.status === "pending") {
    return { status: "redirect", attemptId: attempt.id, url: attempt.stripeSessionUrl };
  }
  return { status: "processing", attemptId: attempt.id };
}

const isUniqueViolation = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

export async function createCommerceCheckout(input: {
  family: CommerceKind;
  organisationId: string;
  buyer: { userId: string } | { guest: { grantId: string; guestIdentityId: string } };
  selection: unknown;
  expectedTotal: number;
  idempotencyKey: string;
  // Where Stripe sends the buyer back: the trusted origin they bought from, else the app URL.
  returnOrigin?: string;
}): Promise<CommerceCheckoutResult> {
  const adapter = commerceFamilies[input.family];
  if (!adapter) throw new CommerceCheckoutError("not_available", "This purchase is not available");
  const guest = "guest" in input.buyer ? input.buyer.guest : null;
  if (guest && !adapter.guests) throw new CommerceCheckoutError("members_only", "Sign in to buy this");
  const parsed = adapter.selection.safeParse(input.selection);
  if (!parsed.success) throw new CommerceSelectionError(parsed.error.issues);
  const selection = parsed.data;
  const actor: CheckoutActor = guest ? { kind: "guest", id: guest.grantId } : { kind: "user", id: (input.buyer as { userId: string }).userId };
  const buyer: CommerceBuyer = guest ? { guestIdentityId: guest.guestIdentityId } : { userId: actor.id };
  const requestHash = commerceRequestHash(input.family, input.organisationId, selection, input.expectedTotal);

  const earlier = await findCommerceAttempt(prisma, actor, input.family, input.idempotencyKey);
  if (earlier) return replay(earlier, requestHash);

  let created;
  try {
    created = await runReservationTransaction(async (tx) => {
      // Buyer, then the family's resources (inside quote), then the new order.
      // The buyer lock is the buyer's own, so its wait is short; the session check needs only this clock.
      const account = guest ? await lockGuestBuyer(tx, guest.grantId, new Date()) : await lockVerifiedAccount(tx, actor.id);
      const raced = await findCommerceAttempt(tx, actor, input.family, input.idempotencyKey);
      if (raced) return { kind: "replay" as const, attempt: raced };
      const { lines } = await adapter.quote(tx, { organisationId: input.organisationId, buyer, selection });
      // Read after quote took the family's locks: in a rush the queue for them can outlast part of a hold.
      const now = new Date();
      const { totalAmount } = commerceTotals(input.family, "stripe", lines, 0);
      if (totalAmount !== input.expectedTotal) {
        throw new CommerceCheckoutError("quote_changed", "The price has changed", [
          { path: ["expectedTotal"], message: "The total has changed. Review it before buying.", value: totalAmount }
        ]);
      }
      const attempt = { family: input.family, actorKind: actor.kind, actorId: actor.id, operationType: commerceCheckoutOperation, clientIdempotencyKey: input.idempotencyKey, requestHash, providerOperationKey: newProviderOperationKey() };
      const common = { organisationId: input.organisationId, kind: input.family, buyer, buyerEmail: account.email, buyerName: [account.firstName, account.lastName].filter(Boolean).join(" ") || null, lines, source: "checkout" as const, actorUserId: guest ? null : actor.id };

      // A free total is fulfilled here, without reading Stripe configuration.
      if (totalAmount === 0) {
        const order = await createCommerceOrder(tx, { ...common, paymentKind: "free" });
        const result = await adapter.fulfil(tx, order, now);
        if (!result.fulfilled) throw new CommerceCheckoutError("unavailable", "This purchase is no longer available", [{ path: ["selection"], message: result.reason }]);
        await tx.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now } });
        await appendCommerceLifecycleEvent(tx, { commerceOrderId: order.id, type: "free_fulfilled", source: "checkout", fromStatus: "pending", toStatus: "paid" });
        const freeAttempt = await tx.checkoutAttempt.create({ data: { ...attempt, commerceOrderId: order.id, reconcileDueAt: null }, select: { id: true } });
        return { kind: "free" as const, attemptId: freeAttempt.id, commerceOrderId: order.id };
      }

      const seller = await tx.organisation.findUniqueOrThrow({ where: { id: input.organisationId }, select: { stripeAccountId: true, stripeChargesEnabled: true, timeZone: true } });
      if (!isOrganisationStripeReady(seller)) {
        throw new CommerceCheckoutError("stripe_not_ready", "This society can't take payments yet", [{ path: ["organisationId"], message: "The society must finish connecting Stripe" }]);
      }
      const stripe = getStripe();
      const appUrl = input.returnOrigin ?? getAppUrl();
      const feeAmount = calculatePlatformFee(totalAmount);
      const order = await createCommerceOrder(tx, {
        ...common, paymentKind: "stripe", feeAmount, feePolicyVersion: PLATFORM_FEE_POLICY_VERSION,
        // The hold (PAY-009): the stale-order job closes the Stripe page when it ends.
        expiresAt: holdEndsAt(now, commerceHoldMinutes)
      });
      const paidAttempt = await tx.checkoutAttempt.create({
        data: { ...attempt, commerceOrderId: order.id, reconcileDueAt: new Date(now.getTime() + attemptReconcileDelayMs) },
        select: { id: true, providerOperationKey: true }
      });
      return { kind: "created" as const, order, lines, attempt: paidAttempt, stripe, appUrl, feeAmount, destination: seller.stripeAccountId as string, timeZone: seller.timeZone };
    });
  } catch (error) {
    const raced = isUniqueViolation(error) ? await findCommerceAttempt(prisma, actor, input.family, input.idempotencyKey) : null;
    if (raced) return replay(raced, requestHash);
    throw error;
  }

  if (created.kind === "replay") return replay(created.attempt, requestHash);
  if (created.kind === "free") {
    logInfo("commerce.checkout.free_fulfilled", { commerceOrderId: created.commerceOrderId, family: input.family });
    return { status: "fulfilled", attemptId: created.attemptId, commerceOrderId: created.commerceOrderId };
  }

  const { order, attempt, stripe } = created;
  // Stripe's page outlasts the hold; the stale-order job closes it when the hold ends.
  const expiresAt = checkoutSessionExpiresAt(commerceHoldMinutes);
  const holdEnd = order.expiresAt as Date;
  const metadata = { family: input.family, commerceOrderId: order.id, organisationId: order.organisationId };
  const sessionRequest: Stripe.Checkout.SessionCreateParams = {
    mode: "payment",
    // Card only, so a completed Session is paid at once; delayed methods' async
    // payment events are handled anyway (PAY-030). Endive removed payment_method_types for this filter.
    allowed_payment_method_types: ["card"],
    integration_identifier: checkoutIntegrationIdentifiers.commerce,
    // A free option in a paid basket is on the order, not on the card statement.
    line_items: created.lines.filter((line) => line.unitAmount > 0).map((line) => ({
      price_data: { currency: order.currency, product_data: { name: line.variant ? `${line.name} (${line.variant})` : line.name }, unit_amount: line.unitAmount },
      quantity: line.quantity
    })),
    payment_intent_data: {
      application_fee_amount: created.feeAmount,
      on_behalf_of: created.destination,
      transfer_data: { destination: created.destination },
      metadata
    },
    customer_email: order.buyerEmailSnapshot,
    // Each family returns to its own order page (memberships T24a, merchandise T27b).
    success_url: `${created.appUrl}/${input.family === "membership" ? "memberships" : "merchandise"}/orders/${order.id}`,
    cancel_url: `${created.appUrl}/${input.family === "membership" ? "memberships" : "merchandise"}/orders/${order.id}?left=1`,
    expires_at: expiresAt,
    custom_text: {
      submit: { message: `We're holding your order until ${formatClock(holdEnd, created.timeZone)} ${zoneCity(created.timeZone)}. After that it's released.` }
    },
    metadata
  };
  // Recovery replays exactly this request with the same key.
  await prisma.checkoutAttempt.update({ where: { id: attempt.id }, data: { providerRequest: sessionRequest as unknown as Prisma.InputJsonValue } });

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create(sessionRequest, { idempotencyKey: attempt.providerOperationKey });
  } catch (error) {
    if (isDefiniteProviderFailure(error)) {
      await failPendingCommerceOrder(order.id, "provider_refused", "checkout");
      throw error;
    }
    // Stripe may have made the Session: keep the order and let recovery replay the same key.
    emitOperationalAlert("checkout_session_creation_failure", { reason: "provider_uncertain", commerceOrderId: order.id, attemptId: attempt.id });
    await markAttemptUncertain(attempt.id, "session_create_unknown");
    return { status: "processing", attemptId: attempt.id };
  }
  if (!session.url) {
    await failPendingCommerceOrder(order.id, "missing_redirect_url", "checkout");
    throw new CommerceCheckoutError("unavailable", "Stripe did not start the checkout");
  }
  if ((await attachCommerceSession(order.id, session.id, session.url, "checkout")) !== "attached") {
    await markAttemptUncertain(attempt.id, "session_attach_failed").catch(() => undefined);
    return { status: "processing", attemptId: attempt.id };
  }
  logInfo("commerce.checkout.session_created", { commerceOrderId: order.id, family: input.family, stripeSessionId: session.id });
  return { status: "redirect", attemptId: attempt.id, url: session.url };
}
