import type Stripe from "stripe";
import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { processStaleOrderCleanupBatch } from "@/lib/orders/stale-orders";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { settleCheckoutSession, sweepPendingCheckouts } from "@/lib/payments/checkout-settlement";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// PAY-024: the reconciliation sweep asks Stripe about pending ticket checkouts,
// so a payment whose webhook was lost is confirmed, never expired.

const stripe = vi.hoisted(() => ({ createSession: vi.fn(), retrieve: vi.fn(), expire: vi.fn(), unconfigured: false }));

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "StripeConfigurationError";
    }
  }
  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripe: () => {
      if (stripe.unconfigured) throw new StripeConfigurationError("STRIPE_SECRET_KEY missing at runtime");
      return { checkout: { sessions: { create: stripe.createSession, retrieve: stripe.retrieve, expire: stripe.expire } } };
    }
  };
});

const minutes = (count: number) => new Date(Date.now() + count * 60_000);
// The hold is the Session's 30 minutes plus its margin, plus 5 minutes for a late webhook (DEF-033).
const afterHold = () => minutes(37);
const missing = () => Object.assign(new Error("No such checkout.session"), { code: "resource_missing" });
const alertCount = (spy: { mock: { calls: unknown[][] } }, name: string) => spy.mock.calls.filter(([line]) => String(line).includes(`"event":"${name}"`)).length;

// A member's pending ticket checkout with its Stripe Session bound, as after the redirect.
async function pendingCheckout() {
  vi.spyOn(console, "info").mockImplementation(() => {});
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { organisation } = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: organisation.id, status: "published" });
  const member = await createMember();
  const sessionId = unique("cs_sweep");
  stripe.createSession.mockReset().mockResolvedValueOnce({ id: sessionId, url: "https://checkout.stripe.test/sweep" });
  stripe.retrieve.mockReset();
  stripe.expire.mockReset();
  stripe.unconfigured = false;
  const ticketType = event.ticketTypes[0];
  const result = await createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 1, expectedUnitPrice: ticketType.price, idempotencyKey: unique("sweep") });
  expect(result.status).toBe("redirect");
  const order = await prisma.order.findFirstOrThrow({ where: { stripeSessionId: sessionId } });
  const session = (overrides: Partial<Stripe.Checkout.Session> = {}) =>
    ({
      ...checkoutSession({ id: sessionId, orderId: order.id, eventId: event.id, organisationId: organisation.id, ticketTypeId: ticketType.id, quantity: 1, amountTotal: ticketType.price }),
      status: "complete",
      payment_intent: { id: unique("pi"), transfer_data: { destination: organisation.stripeAccountId } },
      ...overrides
    }) as Stripe.Checkout.Session;
  return { orderId: order.id, sessionId, session, errors };
}

const state = (orderId: string) =>
  prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { reservation: true, tickets: true, lifecycleEvents: { orderBy: { sequence: "asc" } } } });

describe("checkout reconciliation sweep: tickets", () => {
  test("a paid checkout whose webhook was lost is confirmed by the sweep with an alert, and the late webhook changes nothing", async () => {
    const { orderId, session, errors } = await pendingCheckout();
    stripe.retrieve.mockResolvedValue(session());

    // Too young: a webhook normally lands within seconds.
    await expect(sweepPendingCheckouts({ now: minutes(1) })).resolves.toMatchObject({ checked: 0 });
    expect(stripe.retrieve).not.toHaveBeenCalled();

    await expect(sweepPendingCheckouts({ now: minutes(3) })).resolves.toMatchObject({ checked: 1, settled: 1 });
    const confirmed = await state(orderId);
    expect(confirmed).toMatchObject({ status: "paid", reservation: { status: "confirmed" } });
    expect(confirmed.tickets).toHaveLength(1);
    expect(confirmed.lifecycleEvents.find((entry) => entry.type === "payment_fulfilled")).toMatchObject({ source: "reconciliation_sweep" });
    expect(alertCount(errors, "stripe_webhook_missed")).toBe(1);

    // The webhook arrives after all: the same path, already applied.
    await expect(settleCheckoutSession(session(), { completed: true, stripeEventId: unique("evt_late"), source: "webhook" })).resolves.toMatchObject({ family: "ticket", result: { status: "already_paid" } });
    expect(await prisma.ticket.count({ where: { orderId } })).toBe(1);
    expect(alertCount(errors, "stripe_webhook_missed")).toBe(1);
  });

  test("a checkout still open is left alone and asked about again only after the recheck interval", async () => {
    const { orderId, session } = await pendingCheckout();
    stripe.retrieve.mockResolvedValue(session({ status: "open", payment_status: "unpaid" }));
    const first = minutes(3);

    await expect(sweepPendingCheckouts({ now: first })).resolves.toMatchObject({ checked: 1, open: 1 });
    expect((await state(orderId))).toMatchObject({ status: "pending", stripeCheckedAt: first, reservation: { status: "active" } });
    await expect(sweepPendingCheckouts({ now: minutes(4) })).resolves.toMatchObject({ checked: 0 });
    await expect(sweepPendingCheckouts({ now: minutes(6) })).resolves.toMatchObject({ checked: 1, open: 1 });
    expect(stripe.retrieve).toHaveBeenCalledTimes(2);
    expect(stripe.expire).not.toHaveBeenCalled();
  });

  test("before expiring, a paid order is fulfilled instead, an open page is closed first, and an order Stripe can't be asked about waits", async () => {
    // Paid, webhook lost: fulfilled, not expired.
    const paid = await pendingCheckout();
    stripe.retrieve.mockResolvedValue(paid.session());
    await expect(processStaleOrderCleanupBatch({ now: afterHold() })).resolves.toMatchObject({ ordersExpired: 0, stripeDeferred: 0 });
    expect(await state(paid.orderId)).toMatchObject({ status: "paid", reservation: { status: "confirmed" } });
    expect(alertCount(paid.errors, "stripe_webhook_missed")).toBe(1);

    // Still open past the hold: the page is closed at Stripe, then the order expires.
    const open = await pendingCheckout();
    stripe.retrieve.mockResolvedValue(open.session({ status: "open", payment_status: "unpaid" }));
    stripe.expire.mockResolvedValue(open.session({ status: "expired", payment_status: "unpaid" }));
    await processStaleOrderCleanupBatch({ now: afterHold() });
    expect(stripe.expire).toHaveBeenCalledWith(open.sessionId);
    expect(await state(open.orderId)).toMatchObject({ status: "expired", reservation: { status: "expired" } });

    // Stripe unreachable: kept pending and its hold kept, and an alert; expired on a later run.
    const unreachable = await pendingCheckout();
    stripe.retrieve.mockRejectedValue(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
    await expect(processStaleOrderCleanupBatch({ now: afterHold() })).resolves.toMatchObject({ ordersExpired: 0, stripeDeferred: 1 });
    expect(await state(unreachable.orderId)).toMatchObject({ status: "pending", reservation: { status: "active" } });
    stripe.retrieve.mockRejectedValue(missing());
    await expect(processStaleOrderCleanupBatch({ now: afterHold() })).resolves.toMatchObject({ ordersExpired: 1, stripeDeferred: 0 });
    expect(await state(unreachable.orderId)).toMatchObject({ status: "expired" });
  });

  test("outside production, a worker without Stripe expires as before; the early check skips", async () => {
    const { orderId } = await pendingCheckout();
    stripe.unconfigured = true;

    await expect(sweepPendingCheckouts({ now: minutes(3) })).resolves.toMatchObject({ checked: 0, skipped: "stripe_unconfigured" });
    await expect(processStaleOrderCleanupBatch({ now: afterHold() })).resolves.toMatchObject({ ordersExpired: 1, stripeDeferred: 0 });
    expect(await state(orderId)).toMatchObject({ status: "expired" });
  });

  test("in production, a worker without Stripe never expires a Stripe order", async () => {
    const { orderId } = await pendingCheckout();
    stripe.unconfigured = true;
    vi.stubEnv("NODE_ENV", "production");
    try {
      await expect(processStaleOrderCleanupBatch({ now: afterHold() })).resolves.toMatchObject({ ordersExpired: 0, stripeDeferred: 1 });
    } finally {
      vi.unstubAllEnvs();
    }
    expect(await state(orderId)).toMatchObject({ status: "pending", reservation: { status: "active" } });
  });

  // PAY-029: a failed look is stamped, so a few broken orders can't take every run.
  test("a failed look is stamped and alerts; a local error is told apart from Stripe being unreachable", async () => {
    const first = await pendingCheckout();
    const second = await pendingCheckout();
    stripe.retrieve.mockImplementation(async (id: string) => {
      if (id === first.sessionId) throw new TypeError("Cannot read properties of undefined");
      throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
    });
    const now = minutes(3);
    await expect(sweepPendingCheckouts({ now })).resolves.toMatchObject({ checked: 2, failed: 1, unavailable: 1 });
    expect(await state(first.orderId)).toMatchObject({ status: "pending", stripeCheckedAt: now });
    expect(await state(second.orderId)).toMatchObject({ status: "pending", stripeCheckedAt: now });
    expect(alertCount(second.errors, "checkout_settlement_failed")).toBe(1);
    expect(alertCount(second.errors, "checkout_reconciliation_unavailable")).toBe(1);
    // Asked about again only after the recheck interval.
    await expect(sweepPendingCheckouts({ now: minutes(4) })).resolves.toMatchObject({ checked: 0 });
  });

  test("a run works through the backlog page by page", async () => {
    await pendingCheckout();
    const second = await pendingCheckout();
    stripe.retrieve.mockImplementation(async (id: string) => second.session({ id, status: "open", payment_status: "unpaid" }));
    await expect(sweepPendingCheckouts({ now: minutes(3), limit: 1 })).resolves.toMatchObject({ checked: 2, open: 2 });
  });

  // PAY-031: paid in time, confirmed after the hold ran out.
  test("a payment found after its hold lapsed gets its tickets while the event has room", async () => {
    const { orderId, session } = await pendingCheckout();
    await prisma.ticketReservation.update({ where: { orderId }, data: { expiresAt: minutes(-1) } });
    stripe.retrieve.mockResolvedValue(session());
    await expect(sweepPendingCheckouts({ now: minutes(3) })).resolves.toMatchObject({ settled: 1 });
    expect(await state(orderId)).toMatchObject({ status: "paid", reservation: { status: "confirmed" } });
    expect((await state(orderId)).tickets).toHaveLength(1);
  });

  // PAY-032: a cancellation's own close can fail, or miss a page bound after it.
  test("an open page of a cancelled event is closed and its order expired", async () => {
    const { orderId, sessionId, session } = await pendingCheckout();
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    await prisma.event.update({ where: { id: order.eventId }, data: { cancelledAt: new Date() } });
    stripe.retrieve.mockResolvedValue(session({ status: "open", payment_status: "unpaid" }));
    stripe.expire.mockResolvedValue(session({ status: "expired", payment_status: "unpaid" }));
    await sweepPendingCheckouts({ now: minutes(3) });
    expect(stripe.expire).toHaveBeenCalledWith(sessionId);
    expect(await state(orderId)).toMatchObject({ status: "expired" });
  });

  // PAY-030: a delayed payment method, complete but not paid yet.
  test("a completed but unpaid Session is left processing and its order never expires meanwhile", async () => {
    const { orderId, session } = await pendingCheckout();
    stripe.retrieve.mockResolvedValue(session({ status: "complete", payment_status: "unpaid" }));
    await expect(sweepPendingCheckouts({ now: minutes(3) })).resolves.toMatchObject({ processing: 1, settled: 0 });
    await expect(processStaleOrderCleanupBatch({ now: afterHold() })).resolves.toMatchObject({ ordersExpired: 0, stripeDeferred: 1 });
    expect(await state(orderId)).toMatchObject({ status: "pending", reservation: { status: "active" } });
    expect(stripe.expire).not.toHaveBeenCalled();
  });

  // PAY-032: the society cancels the event while the buyer's Stripe page is being created.
  test("a Session created as the event is cancelled is never attached, so the buyer isn't sent to pay", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const member = await createMember();
    stripe.createSession.mockReset().mockImplementationOnce(async () => {
      await prisma.event.update({ where: { id: event.id }, data: { cancelledAt: new Date() } });
      return { id: unique("cs_cancelled"), url: "https://checkout.stripe.test/cancelled" };
    });
    const ticketType = event.ticketTypes[0];
    await expect(createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 1, expectedUnitPrice: ticketType.price, idempotencyKey: unique("cancelled") })).rejects.toThrow();
    const order = await prisma.order.findFirstOrThrow({ where: { eventId: event.id } });
    expect(order).toMatchObject({ status: "pending", stripeSessionId: null });
    expect(await prisma.checkoutAttempt.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ state: "failed", lastOutcome: "event_cancelled_at_attach" });
  });
});
