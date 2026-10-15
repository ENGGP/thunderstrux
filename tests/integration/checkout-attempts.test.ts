import { describe, expect, test, vi } from "vitest";
import { GET as attemptRoute } from "@/app/api/payments/checkout/attempts/[attemptId]/route";
import { POST as checkoutRoute } from "@/app/api/payments/checkout/event/route";
import { prisma } from "@/lib/db";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  unique
} from "@/tests/helpers/test-data";

const stripeMocks = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    getStripe: () => ({ checkout: { sessions: { create: stripeMocks.createSession } } })
  };
});

type CheckoutParams = { metadata: Record<string, string> };

async function readyEvent() {
  const { organisation } = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: organisation.id, status: "published" });
  const member = await createMember();
  return { organisation, event, member, ticketType: event.ticketTypes[0] };
}

function request(event: Awaited<ReturnType<typeof readyEvent>>, idempotencyKey: string, quantity = 1) {
  return {
    userId: event.member.id,
    eventId: event.event.id,
    ticketTypeId: event.ticketType.id,
    quantity,
    expectedUnitPrice: event.ticketType.price,
    idempotencyKey
  };
}

async function readStatus(userId: string, email: string, attemptId: string) {
  setMockSession({ userId, email, accountRole: "member" });
  const response = await attemptRoute(jsonRequest(`http://localhost/api/payments/checkout/attempts/${attemptId}`), routeContext({ attemptId }));
  return { status: response.status, body: await parseJsonResponse(response) };
}

describe("idempotent checkout attempts", () => {
  test("a double click with one key makes one order and one Stripe Session", async () => {
    stripeMocks.createSession.mockReset().mockResolvedValue({ id: unique("cs_double"), url: "https://checkout.stripe.test/double" });
    const fixture = await readyEvent();
    const key = unique("checkout");

    const results = await Promise.all([createEventCheckout(request(fixture, key)), createEventCheckout(request(fixture, key))]);

    expect(stripeMocks.createSession).toHaveBeenCalledTimes(1);
    expect(await prisma.order.count({ where: { eventId: fixture.event.id } })).toBe(1);
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow({ where: { actorId: fixture.member.id } });
    expect(new Set(results.map((result) => result.attemptId))).toEqual(new Set([attempt.id]));
    expect(results.map((result) => result.status)).toContain("redirect");
    // Stripe received the attempt's stable key, so its own replay protection applies too.
    expect(stripeMocks.createSession.mock.calls[0][1]).toEqual({ idempotencyKey: attempt.providerOperationKey });

    // A later retry with the same key returns the same Session without calling Stripe.
    await expect(createEventCheckout(request(fixture, key))).resolves.toEqual({
      status: "redirect",
      attemptId: attempt.id,
      url: "https://checkout.stripe.test/double"
    });
    expect(stripeMocks.createSession).toHaveBeenCalledTimes(1);
  });

  test("the same key with a different selection is a 409", async () => {
    stripeMocks.createSession.mockReset().mockResolvedValue({ id: unique("cs_conflict"), url: "https://checkout.stripe.test/conflict" });
    const fixture = await readyEvent();
    const key = unique("checkout");
    await createEventCheckout(request(fixture, key));

    setMockSession({ userId: fixture.member.id, email: fixture.member.email, accountRole: "member" });
    const response = await checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", {
      eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity: 2, expectedUnitPrice: fixture.ticketType.price, idempotencyKey: key
    }));

    expect(response.status).toBe(409);
    expect(await parseJsonResponse(response)).toMatchObject({ error: { code: "CONFLICT", details: [{ path: ["idempotencyKey"] }] } });
    expect(await prisma.order.count({ where: { eventId: fixture.event.id } })).toBe(1);
  });

  test("a lost Stripe response keeps the order and hold and answers 202 without a second Session", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stripeMocks.createSession.mockReset().mockRejectedValue(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
    const fixture = await readyEvent();
    const key = unique("checkout");

    setMockSession({ userId: fixture.member.id, email: fixture.member.email, accountRole: "member" });
    const response = await checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", {
      eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity: 1, expectedUnitPrice: fixture.ticketType.price, idempotencyKey: key
    }));

    expect(response.status).toBe(202);
    const body = await parseJsonResponse(response);
    expect(body).toEqual({ attemptId: expect.any(String), status: "processing" });
    const attempt = await prisma.checkoutAttempt.findUniqueOrThrow({ where: { id: body.attemptId }, include: { order: { include: { reservation: true } } } });
    expect(attempt).toMatchObject({ state: "provider_uncertain", lastOutcome: "session_create_unknown", stripeSessionId: null });
    expect(attempt.reconcileDueAt).not.toBeNull();
    expect(attempt.order).toMatchObject({ status: "pending", reservation: { status: "active" } });

    await expect(createEventCheckout(request(fixture, key))).resolves.toEqual({ status: "processing", attemptId: attempt.id });
    expect(stripeMocks.createSession).toHaveBeenCalledTimes(1);
    expect(await readStatus(fixture.member.id, fixture.member.email, attempt.id)).toEqual({
      status: 200,
      body: { attemptId: attempt.id, status: "processing" }
    });
  });

  test("a Session that cannot be attached leaves the attempt uncertain for recovery", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await readyEvent();
    // Another order already holds the Session id, so binding it fails in the database.
    const taken = await createOrder({ organisationId: fixture.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, status: "expired" });
    const sessionId = unique("cs_taken");
    await prisma.order.update({ where: { id: taken.id }, data: { stripeSessionId: sessionId } });
    stripeMocks.createSession.mockReset().mockResolvedValue({ id: sessionId, url: "https://checkout.stripe.test/taken" });

    const result = await createEventCheckout(request(fixture, unique("checkout")));

    expect(result.status).toBe("processing");
    const attempt = await prisma.checkoutAttempt.findUniqueOrThrow({ where: { id: result.attemptId }, include: { order: { include: { reservation: true } } } });
    expect(attempt).toMatchObject({ state: "provider_uncertain", lastOutcome: "session_attach_failed", stripeSessionId: null });
    expect(attempt.order).toMatchObject({ status: "pending", stripeSessionId: null, reservation: { status: "active" } });
  });

  test("a webhook that fulfils before attachment converges on the same Session", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fixture = await readyEvent();
    const sessionId = unique("cs_early");
    stripeMocks.createSession.mockReset().mockImplementation(async (params: CheckoutParams) => {
      const session = checkoutSession({
        id: sessionId,
        orderId: params.metadata.orderId,
        eventId: params.metadata.eventId,
        organisationId: params.metadata.organisationId,
        ticketTypeId: params.metadata.ticketTypeId,
        quantity: 1,
        amountTotal: fixture.ticketType.price
      });
      await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: unique("evt_early") })).resolves.toMatchObject({ status: "fulfilled" });
      return { id: sessionId, url: "https://checkout.stripe.test/early" };
    });

    const result = await createEventCheckout(request(fixture, unique("checkout")));

    const attempt = await prisma.checkoutAttempt.findUniqueOrThrow({ where: { id: result.attemptId }, include: { order: true } });
    expect(attempt).toMatchObject({ state: "provider_attached", stripeSessionId: sessionId, order: { status: "paid", stripeSessionId: sessionId } });
    expect(await prisma.ticket.count({ where: { orderId: attempt.orderId! } })).toBe(1);
    expect((await readStatus(fixture.member.id, fixture.member.email, attempt.id)).body).toEqual({
      attemptId: attempt.id,
      status: "completed",
      orderId: attempt.orderId
    });
  });

  test("only the buyer can read an attempt", async () => {
    stripeMocks.createSession.mockReset().mockResolvedValue({ id: unique("cs_owner"), url: "https://checkout.stripe.test/owner" });
    const fixture = await readyEvent();
    const result = await createEventCheckout(request(fixture, unique("checkout")));
    const stranger = await createMember();

    expect(await readStatus(fixture.member.id, fixture.member.email, result.attemptId)).toEqual({
      status: 200,
      body: { attemptId: result.attemptId, status: "ready", url: "https://checkout.stripe.test/owner" }
    });
    expect((await readStatus(stranger.id, stranger.email, result.attemptId)).status).toBe(404);
    expect((await readStatus(stranger.id, stranger.email, "missing-attempt")).status).toBe(404);
  });
});
