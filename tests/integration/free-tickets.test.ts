import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as checkoutRoute } from "@/app/api/payments/checkout/event/route";
import { prisma } from "@/lib/db";
import { setAutomaticOutboxEnqueueTestFailure } from "@/lib/email/ticket-email-outbox";
import { eventTicketTypeMetrics, societySales } from "@/lib/analytics/metrics";
import { analyticsRange } from "@/lib/analytics/range";
import { markOrganisationOrderManuallyRefunded } from "@/lib/orders/order-detail";
import { CheckoutCreationError, createEventCheckout } from "@/lib/payments/checkout-creation";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// Any Stripe use fails the test: free registrations never read provider configuration.
const stripe = vi.hoisted(() => ({ getStripe: vi.fn(() => { throw new Error("Stripe must not be called for free tickets"); }) }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: stripe.getStripe
}));

afterEach(() => {
  setAutomaticOutboxEnqueueTestFailure(null);
  stripe.getStripe.mockClear();
});

async function freeEvent({ quantity = 20, visibility = "public" as "public" | "members_only", stripeReady = false } = {}) {
  const owner = await createOrganisationAccount({ stripeReady });
  const event = await createEvent({
    organisationId: owner.organisation.id,
    status: "published",
    visibility,
    ticketTypes: [{ name: "Free entry", price: 0, quantity }]
  });
  return { owner, event, ticketType: event.ticketTypes[0] };
}

function register(userId: string, fixture: Awaited<ReturnType<typeof freeEvent>>, quantity = 2, idempotencyKey = unique("free-key")) {
  return createEventCheckout({ userId, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity, expectedUnitPrice: 0, idempotencyKey });
}

describe("free ticket registration", () => {
  test("fulfils at checkout with tickets, stock, history and email, and no Stripe, fee or hold", async () => {
    const fixture = await freeEvent();
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });

    const response = await checkoutRoute(jsonRequest("http://localhost/api/payments/checkout/event", {
      eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity: 2, expectedUnitPrice: 0, idempotencyKey: unique("free-route")
    }));
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);
    expect(body).toMatchObject({ kind: "fulfilled", orderId: expect.any(String) });

    const order = await prisma.order.findUniqueOrThrow({
      where: { id: body.orderId },
      include: { tickets: { orderBy: { issueSequence: "asc" } }, reservation: true, emailOutboxJobs: true, lifecycleEvents: { orderBy: { sequence: "asc" } } }
    });
    expect(order).toMatchObject({
      paymentKind: "free", status: "paid", totalAmount: 0, unitPrice: 0, feeAmount: 0, stripeSessionId: null,
      sellerStripeAccountId: null, purchasedTicketTypeName: "Free entry", buyerEmailSnapshot: member.email, reservation: null
    });
    expect(order.paidAt).toEqual(order.fulfilledAt);
    expect(order.tickets.map((ticket) => ticket.issueSequence)).toEqual([1, 2]);
    expect(order.emailOutboxJobs).toHaveLength(1);
    expect(order.lifecycleEvents.map((event) => event.type)).toEqual(["order_created", "free_fulfilled", "email_enqueued"]);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketType.id } })).quantity).toBe(18);
    // Never picked up by the Stripe recovery worker.
    expect(await prisma.checkoutAttempt.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ state: "created", reconcileDueAt: null });
    expect(stripe.getStripe).not.toHaveBeenCalled();
  });

  test("a replay returns the same order and a different selection with the same key is a conflict", async () => {
    const fixture = await freeEvent();
    const member = await createMember();
    const key = unique("free-replay");
    const first = await register(member.id, fixture, 2, key);
    const again = await register(member.id, fixture, 2, key);
    expect(first).toMatchObject({ status: "fulfilled" });
    expect(again).toEqual(first);
    await expect(register(member.id, fixture, 3, key)).rejects.toMatchObject({ kind: "idempotency_conflict" });
    expect(await prisma.order.count({ where: { eventId: fixture.event.id } })).toBe(1);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketType.id } })).quantity).toBe(18);
  });

  test("one buyer holds at most one order's worth of free tickets for an event, so nobody can claim them all", async () => {
    const fixture = await freeEvent({ quantity: 50 });
    const member = await createMember();
    await register(member.id, fixture, 6);
    await expect(register(member.id, fixture, 5)).rejects.toMatchObject({ kind: "free_limit_reached", details: [expect.objectContaining({ value: 4 })] });
    await register(member.id, fixture, 4);
    await expect(register(member.id, fixture, 1)).rejects.toMatchObject({ kind: "free_limit_reached" });
    expect(await prisma.ticket.count({ where: { eventId: fixture.event.id } })).toBe(10);
    // A cancelled registration no longer counts.
    await prisma.ticket.updateMany({ where: { eventId: fixture.event.id, issueSequence: 1 }, data: { validity: "void", validityReason: "cancelled" } });
    await expect(register(member.id, fixture, 2)).resolves.toMatchObject({ status: "fulfilled" });
    // Another buyer is unaffected.
    await expect(register((await createMember()).id, fixture, 10)).resolves.toMatchObject({ status: "fulfilled" });
  });

  test("two members racing for the last seat get exactly one ticket", async () => {
    const fixture = await freeEvent({ quantity: 1 });
    const [a, b] = await Promise.all([createMember(), createMember()]);
    const results = await Promise.allSettled([register(a.id, fixture, 1), register(b.id, fixture, 1)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(CheckoutCreationError);
    expect(["sold_out", "insufficient_availability"]).toContain(refused.reason.kind);
    expect(await prisma.ticket.count({ where: { eventId: fixture.event.id } })).toBe(1);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketType.id } })).quantity).toBe(0);
  });

  test("members-only events stay concealed and a failed email enqueue rolls the whole registration back", async () => {
    const hidden = await freeEvent({ visibility: "members_only" });
    const member = await createMember();
    await expect(register(member.id, hidden)).rejects.toMatchObject({ kind: "event_not_found" });

    const fixture = await freeEvent();
    setAutomaticOutboxEnqueueTestFailure(new Error("synthetic enqueue failure"));
    await expect(register(member.id, fixture)).rejects.toThrow("synthetic enqueue failure");
    expect(await prisma.order.count({ where: { eventId: fixture.event.id } })).toBe(0);
    expect(await prisma.ticket.count({ where: { eventId: fixture.event.id } })).toBe(0);
    expect(await prisma.checkoutAttempt.count({ where: { actorId: member.id } })).toBe(0);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketType.id } })).quantity).toBe(20);
  });

  test("free registrations count as sold but never as revenue, and cannot be marked refunded", async () => {
    const fixture = await freeEvent({ stripeReady: true });
    const paidType = await prisma.ticketType.create({ data: { eventId: fixture.event.id, name: "Supporter", price: 2000, quantity: 5 } });
    const paid = await createOrder({
      organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: paidType.id,
      status: "paid", paidAt: new Date(), quantity: 1, unitPrice: 2000
    });
    await prisma.ticket.create({ data: { orderId: paid.id, eventId: fixture.event.id, ticketTypeId: paidType.id, organisationId: fixture.owner.organisation.id, issueSequence: 1 } });
    const member = await createMember();
    const free = await register(member.id, fixture, 3);
    setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });

    const types = await eventTicketTypeMetrics(fixture.owner.organisation.id, fixture.event.id, { financial: true });
    expect(types.reduce((total, type) => total + type.issued, 0)).toBe(4);
    expect(types.reduce((total, type) => total + type.free, 0)).toBe(3);
    expect(types.reduce((total, type) => total + (type.gross ?? 0), 0)).toBe(2000);
    const today = analyticsRange({}, "Australia/Brisbane");
    expect(await societySales(fixture.owner.organisation.id, today, { financial: true })).toMatchObject({ tickets: 2000, total: 2000 });

    if (free.status !== "fulfilled") throw new Error("expected a free registration");
    await expect(markOrganisationOrderManuallyRefunded(fixture.owner.organisation.id, free.orderId)).rejects.toThrow("no payment to refund");
  });
});
