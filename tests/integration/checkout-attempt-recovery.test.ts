import { Prisma } from "@prisma/client";
import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { processStaleOrderCleanupBatch } from "@/lib/orders/stale-orders";
import { attemptRecoveryLeaseMs, processCheckoutAttemptRecoveryBatch } from "@/lib/payments/checkout-attempt-recovery";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const stripeMocks = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    getStripe: () => ({ checkout: { sessions: { create: stripeMocks.createSession } } })
  };
});

const connectionError = () => Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
const refusal = () => Object.assign(new Error("expires_at must be at least 30 minutes in the future"), { type: "StripeInvalidRequestError" });
const soon = () => new Date(Date.now() + 1000);

// A checkout whose Session creation lost its response: order and hold kept, attempt uncertain.
async function uncertainCheckout() {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  stripeMocks.createSession.mockReset().mockRejectedValueOnce(connectionError());
  const { organisation } = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: organisation.id, status: "published" });
  const member = await createMember();
  const key = unique("checkout");
  const request = { userId: member.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, expectedUnitPrice: event.ticketTypes[0].price, idempotencyKey: key };
  const result = await createEventCheckout(request);
  expect(result.status).toBe("processing");
  const attempt = await prisma.checkoutAttempt.findUniqueOrThrow({ where: { id: result.attemptId } });
  return { organisation, event, request, attempt, orderId: attempt.orderId! };
}

async function orderState(orderId: string) {
  return prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { reservation: true, checkoutAttempt: true, lifecycleEvents: { orderBy: { sequence: "asc" } } }
  });
}

describe("checkout attempt recovery", () => {
  test("a lost Session response is recovered by replaying the same request and key", async () => {
    const { request, orderId } = await uncertainCheckout();
    const sessionId = unique("cs_recovered");
    stripeMocks.createSession.mockResolvedValueOnce({ id: sessionId, url: "https://checkout.stripe.test/recovered" });

    await expect(processCheckoutAttemptRecoveryBatch({ now: soon() })).resolves.toMatchObject({ processed: 1, attached: 1 });

    const [original, replay] = stripeMocks.createSession.mock.calls;
    expect(replay).toEqual(original);
    const order = await orderState(orderId);
    expect(order).toMatchObject({ status: "pending", stripeSessionId: sessionId, reservation: { status: "active" } });
    expect(order.checkoutAttempt).toMatchObject({ state: "provider_attached", stripeSessionId: sessionId, reconcileDueAt: null });
    expect(order.lifecycleEvents.at(-1)).toMatchObject({ type: "stripe_session_attached", source: "checkout_recovery" });
    // The buyer's retry now gets the recovered Session.
    await expect(createEventCheckout(request)).resolves.toMatchObject({ status: "redirect", url: "https://checkout.stripe.test/recovered" });
  });

  test("a replay Stripe refuses means no Session exists, so the order fails and the hold is released", async () => {
    const { orderId } = await uncertainCheckout();
    stripeMocks.createSession.mockRejectedValueOnce(refusal());

    await expect(processCheckoutAttemptRecoveryBatch({ now: soon() })).resolves.toMatchObject({ processed: 1, provider_refused: 1 });

    const order = await orderState(orderId);
    expect(order).toMatchObject({ status: "failed", failureReason: "stripe_error", reservation: { status: "released" } });
    expect(order.checkoutAttempt).toMatchObject({ state: "failed", lastOutcome: "provider_refused", reconcileDueAt: null });
    expect(order.lifecycleEvents.at(-1)).toMatchObject({ type: "order_failed", source: "checkout_recovery" });
  });

  test("an unknown replay outcome keeps the hold and retries later", async () => {
    const { orderId } = await uncertainCheckout();
    stripeMocks.createSession.mockRejectedValueOnce(connectionError());
    const now = soon();

    await expect(processCheckoutAttemptRecoveryBatch({ now })).resolves.toMatchObject({ processed: 1, retry_scheduled: 1 });
    await expect(processCheckoutAttemptRecoveryBatch({ now })).resolves.toMatchObject({ processed: 0 });

    const order = await orderState(orderId);
    expect(order).toMatchObject({ status: "pending", reservation: { status: "active" } });
    expect(order.checkoutAttempt).toMatchObject({ state: "provider_uncertain", lastOutcome: "replay_unknown" });
    expect(order.checkoutAttempt!.reconcileDueAt!.getTime()).toBeGreaterThan(now.getTime());
  });

  test("a webhook that fulfilled first converges with no duplicate tickets", async () => {
    const { organisation, event, orderId } = await uncertainCheckout();
    const sessionId = unique("cs_paid_first");
    const session = checkoutSession({ id: sessionId, orderId, eventId: event.id, organisationId: organisation.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, amountTotal: event.ticketTypes[0].price });
    await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: unique("evt_first") })).resolves.toMatchObject({ status: "fulfilled" });
    stripeMocks.createSession.mockResolvedValueOnce({ id: sessionId, url: "https://checkout.stripe.test/paid" });

    await expect(processCheckoutAttemptRecoveryBatch({ now: soon() })).resolves.toMatchObject({ processed: 1, attached: 1 });

    const order = await orderState(orderId);
    expect(order).toMatchObject({ status: "paid", stripeSessionId: sessionId });
    expect(order.checkoutAttempt).toMatchObject({ state: "provider_attached", stripeSessionId: sessionId });
    expect(await prisma.ticket.count({ where: { orderId } })).toBe(1);
  });

  test("an order that expired before recovery stays expired and keeps the Session on record", async () => {
    const { orderId } = await uncertainCheckout();
    // The hold is 30 minutes plus the Session expiry margin, plus 5 minutes for a late webhook (DEF-033).
    const afterHold = new Date(Date.now() + 37 * 60 * 1000);
    await processStaleOrderCleanupBatch({ now: afterHold });
    const sessionId = unique("cs_after_expiry");
    stripeMocks.createSession.mockResolvedValueOnce({ id: sessionId, url: "https://checkout.stripe.test/expired" });

    await expect(processCheckoutAttemptRecoveryBatch({ now: afterHold })).resolves.toMatchObject({ processed: 1, order_closed: 1 });

    const order = await orderState(orderId);
    expect(order).toMatchObject({ status: "expired", stripeSessionId: null });
    expect(order.checkoutAttempt).toMatchObject({ state: "failed", stripeSessionId: sessionId, lastOutcome: "order_not_pending_at_attach" });
    expect(await prisma.order.count({ where: { eventId: order.eventId } })).toBe(1);
  });

  test("parallel workers replay an attempt once, and a crashed claim reappears after its lease", async () => {
    const { orderId } = await uncertainCheckout();
    stripeMocks.createSession.mockResolvedValue({ id: unique("cs_once"), url: "https://checkout.stripe.test/once" });
    const now = soon();

    const results = await Promise.all([processCheckoutAttemptRecoveryBatch({ now }), processCheckoutAttemptRecoveryBatch({ now })]);
    expect(results.reduce((total, result) => total + result.processed, 0)).toBe(1);
    expect(stripeMocks.createSession).toHaveBeenCalledTimes(2);
    expect((await orderState(orderId)).checkoutAttempt).toMatchObject({ state: "provider_attached" });

    // A worker that claimed an attempt and died leaves it hidden only until the lease ends.
    const crashed = await uncertainCheckout();
    stripeMocks.createSession.mockResolvedValue({ id: unique("cs_after_crash"), url: "https://checkout.stripe.test/crash" });
    const claimedAt = soon();
    await prisma.checkoutAttempt.update({ where: { id: crashed.attempt.id }, data: { reconcileDueAt: new Date(claimedAt.getTime() + attemptRecoveryLeaseMs) } });
    await expect(processCheckoutAttemptRecoveryBatch({ now: claimedAt })).resolves.toMatchObject({ processed: 0 });
    await expect(processCheckoutAttemptRecoveryBatch({ now: new Date(claimedAt.getTime() + attemptRecoveryLeaseMs + 1000) }))
      .resolves.toMatchObject({ processed: 1, attached: 1 });
  });

  test("an attempt that never reached Stripe fails its order without calling Stripe", async () => {
    const { orderId, attempt } = await uncertainCheckout();
    // As if the process stopped before storing the request, which happens before Stripe is called.
    await prisma.checkoutAttempt.update({ where: { id: attempt.id }, data: { providerRequest: Prisma.DbNull } });

    await expect(processCheckoutAttemptRecoveryBatch({ now: soon() })).resolves.toMatchObject({ processed: 1, provider_never_called: 1 });

    expect(stripeMocks.createSession).toHaveBeenCalledTimes(1);
    const order = await orderState(orderId);
    expect(order).toMatchObject({ status: "failed", reservation: { status: "released" } });
    expect(order.checkoutAttempt).toMatchObject({ state: "failed", lastOutcome: "provider_never_called" });
  });
});
