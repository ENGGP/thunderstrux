import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as cancelCommerce } from "@/app/api/commerce/orders/[orderId]/cancel/route";
import { POST as cancelTicket } from "@/app/api/purchases/tickets/[orderId]/cancel/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { cancelledByBuyer, pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { guestCookieName } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { createTestRateLimitBackend, setRateLimitTestBackend } from "@/lib/security/rate-limit";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { guestSession } from "@/tests/helpers/guest";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createEvent, createMember, createOrder, createOrganisationAccount } from "@/tests/helpers/test-data";

// Design round E1: an unpaid order asks Stripe where it stands, offers its
// payment page again while the hold lasts, and its buyer may cancel it.

const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), expire: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { retrieve: stripe.retrieve, expire: stripe.expire } } })
}));

beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });
afterEach(() => { stripe.retrieve.mockReset(); stripe.expire.mockReset(); });

const minute = 60_000;

// A member's unpaid order for two tickets, held for another 20 minutes, and its Stripe Session.
async function unpaidTicketOrder(holdMinutes = 20) {
  const society = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: society.organisation.id, status: "published", ticketTypes: [{ name: "Standard", price: 1500, quantity: 10 }] });
  const buyer = await createMember();
  const order = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, quantity: 2, unitPrice: 1500 });
  // PAY-009: the reservation runs the hold plus the 5-minute webhook margin, and
  // Stripe's page lasts at least 30 minutes; the job closes it when the hold ends.
  const holdEndsAt = new Date(Date.now() + holdMinutes * minute);
  await prisma.ticketReservation.create({ data: { orderId: order.id, organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, quantity: 2, expiresAt: new Date(holdEndsAt.getTime() + 5 * minute) } });
  const closesAt = Math.floor((Date.now() + 31 * minute) / 1000);
  const session = (status: string, paymentStatus = "unpaid") => ({
    id: order.stripeSessionId, status, payment_status: paymentStatus, url: "https://checkout.stripe.com/c/pay/test", expires_at: closesAt,
    metadata: { orderId: order.id, eventId: event.id, organisationId: society.organisation.id, ticketTypeId: event.ticketTypes[0].id, quantity: "2" }
  });
  setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
  return { society, event, buyer, order, session, holdEndsAt };
}

const cancel = (orderId: string, init: RequestInit = {}) =>
  cancelTicket(jsonRequest(`http://localhost:3000/api/purchases/tickets/${orderId}/cancel`, {}, init), routeContext({ orderId }));

describe("unpaid orders", () => {
  test("Stripe decides the state: waiting with the payment page, confirming once paid, ended once expired or the hold is over", async () => {
    const fixture = await unpaidTicketOrder();
    const state = () => pendingCheckoutState({ kind: "ticket", id: fixture.order.id });
    stripe.retrieve.mockResolvedValue(fixture.session("open"));
    // The buyer is told when the hold ends, not Stripe's later page close or the webhook margin.
    expect(await state()).toEqual({ state: "waiting", holdEndsAt: fixture.holdEndsAt, paymentUrl: "https://checkout.stripe.com/c/pay/test" });
    stripe.retrieve.mockResolvedValue(fixture.session("complete", "paid"));
    expect(await state()).toEqual({ state: "confirming" });
    stripe.retrieve.mockResolvedValue(fixture.session("expired"));
    expect(await state()).toEqual({ state: "ended" });
    // Without Stripe's answer the hold decides, and no payment page is offered.
    stripe.retrieve.mockRejectedValue(new Error("Stripe unavailable"));
    expect(await state()).toMatchObject({ state: "waiting", paymentUrl: null });
    // Past the hold, inside the webhook margin: the hold is over for the buyer.
    await prisma.ticketReservation.update({ where: { orderId: fixture.order.id }, data: { expiresAt: new Date(Date.now() + 2 * minute) } });
    stripe.retrieve.mockResolvedValue(fixture.session("open"));
    expect(await state()).toEqual({ state: "ended" });
  });

  // PAY-097: each render asked Stripe, against the read limit every society shares.
  test("one order's page asks Stripe at most 6 times a minute, without retries; past that it waits on the hold alone", async () => {
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    setRateLimitTestBackend(createTestRateLimitBackend());
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const fixture = await unpaidTicketOrder();
      stripe.retrieve.mockResolvedValue(fixture.session("open"));
      const state = () => pendingCheckoutState({ kind: "ticket", id: fixture.order.id });
      for (let render = 0; render < 6; render += 1) expect(await state()).toMatchObject({ state: "waiting", paymentUrl: "https://checkout.stripe.com/c/pay/test" });
      expect(await state()).toEqual({ state: "waiting", holdEndsAt: fixture.holdEndsAt, paymentUrl: null });
      expect(stripe.retrieve).toHaveBeenCalledTimes(6);
      expect(stripe.retrieve).toHaveBeenLastCalledWith(fixture.order.stripeSessionId, {}, { maxNetworkRetries: 0 });
    } finally {
      setRateLimitTestBackend(null);
    }
  });

  test("the buyer cancels: Stripe closes the payment page first, then the tickets go back on sale, once", async () => {
    const fixture = await unpaidTicketOrder();
    stripe.retrieve.mockResolvedValue(fixture.session("open"));
    stripe.expire.mockResolvedValue(fixture.session("expired"));
    const response = await cancel(fixture.order.id);
    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({ status: "cancelled" });
    expect(stripe.expire).toHaveBeenCalledWith(fixture.order.stripeSessionId);

    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id }, include: { reservation: true, lifecycleEvents: { orderBy: { sequence: "asc" } } } });
    expect(order).toMatchObject({ status: "expired", reservation: { status: "expired" } });
    expect(order.lifecycleEvents.at(-1)).toMatchObject({ type: "order_expired", source: "checkout" });
    expect(await cancelledByBuyer({ kind: "ticket", id: order.id })).toBe(true);
    // Nothing left to cancel the second time.
    expect((await cancel(fixture.order.id)).status).toBe(409);
  });

  test("if Stripe was paid in the meantime, nothing is cancelled", async () => {
    const fixture = await unpaidTicketOrder();
    stripe.retrieve.mockResolvedValueOnce(fixture.session("open")).mockResolvedValueOnce(fixture.session("complete", "paid"));
    stripe.expire.mockRejectedValue(new Error("Session is complete"));
    expect(await parseJsonResponse(await cancel(fixture.order.id))).toEqual({ status: "paid" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id }, include: { reservation: true } })).toMatchObject({ status: "pending", reservation: { status: "active" } });
  });

  test("another member, a guest without the order's session and a forged origin are refused before Stripe", async () => {
    const fixture = await unpaidTicketOrder();
    const stranger = await createMember();
    setMockSession({ userId: stranger.id, email: stranger.email, accountRole: "member" });
    expect((await cancel(fixture.order.id)).status).toBe(404);
    expect((await cancel(fixture.order.id, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    expect(stripe.retrieve).not.toHaveBeenCalled();
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).status).toBe("pending");
  });

  test("a membership order is cancelled the same way and its hold released", async () => {
    const buyer = await createMember();
    const order = await unpaidCommerceOrder("membership", { userId: buyer.id }, buyer.email);
    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    expect(await pendingCheckoutState({ kind: "commerce", id: order.id })).toMatchObject({ state: "waiting" });

    const response = await cancelCommerce(jsonRequest(`http://localhost:3000/api/commerce/orders/${order.id}/cancel`, {}), routeContext({ orderId: order.id }));
    expect(await parseJsonResponse(response)).toEqual({ status: "cancelled" });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "expired", failureReason: "buyer_cancelled" });
    expect(await cancelledByBuyer({ kind: "commerce", id: order.id })).toBe(true);
  });

  test("a guest session cancels only a merchandise order its own identity bought, whatever its checkout attempts name (SEC-059)", async () => {
    const owner = await guestSession();
    const other = await guestSession();
    const order = await unpaidCommerceOrder("merchandise", { guestIdentityId: owner.guest.guestIdentityId }, owner.email);
    // The other guest's checkout session names this order.
    await prisma.checkoutAttempt.create({ data: {
      family: "merchandise", actorKind: "guest", actorId: other.guest.grantId, operationType: "merchandise_checkout", requestHash: "synthetic",
      clientIdempotencyKey: `key-${order.id}`, providerOperationKey: `op-${order.id}`, commerceOrderId: order.id
    } });
    clearMockSession();
    const cancelAs = (guest: typeof owner) => cancelCommerce(jsonRequest(`http://localhost:3000/api/commerce/orders/${order.id}/cancel`, {}, {
      headers: { cookie: `${guestCookieName}=${guest.sessionId}`, "x-thunderstrux-guest-csrf": guestCsrfToken(guest.sessionId) }
    }), routeContext({ orderId: order.id }));
    expect((await cancelAs(other)).status).toBe(404);
    expect(stripe.retrieve).not.toHaveBeenCalled();
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");
    // The same attempt, made by the buyer's own session, cancels it.
    await prisma.checkoutAttempt.updateMany({ where: { commerceOrderId: order.id }, data: { actorId: owner.guest.grantId } });
    expect(await parseJsonResponse(await cancelAs(owner))).toEqual({ status: "cancelled" });
  });
});

// An unpaid membership (a member's) or merchandise order held for 20 minutes, and a Stripe that shows its open payment page.
async function unpaidCommerceOrder(kind: "membership" | "merchandise", buyer: { userId: string } | { guestIdentityId: string }, buyerEmail: string) {
  const society = await createOrganisationAccount({ stripeReady: true });
  const now = Date.now();
  const plan = kind === "membership"
    ? await prisma.membershipProduct.create({ data: { organisationId: society.organisation.id, name: "Semester 2", priceAmount: 2500, startsAt: new Date(now - 86_400_000), endsAt: new Date(now + 100 * 86_400_000), entitlements: ["member_prices"], status: "published", publishedAt: new Date() } })
    : null;
  const line = plan ? { quantity: 1, unitAmount: 2500, name: plan.name, termStartsAt: plan.startsAt, termEndsAt: plan.endsAt, membershipProductId: plan.id } : { quantity: 1, unitAmount: 2500, name: "Society tote" };
  const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: society.organisation.id, kind, buyer, buyerEmail, paymentKind: "stripe", feeAmount: 183, source: "checkout", lines: [line], expiresAt: new Date(now + 20 * minute)
  }));
  const order = await prisma.commerceOrder.update({ where: { id: created.id }, data: { stripeSessionId: `cs_test_${kind}_${created.id}` } });
  stripe.retrieve.mockResolvedValue({ id: order.stripeSessionId, status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/c/pay/m", expires_at: Math.floor((now + 20 * minute) / 1000) });
  stripe.expire.mockResolvedValue({ id: order.stripeSessionId, status: "expired", payment_status: "unpaid" });
  return order;
}
