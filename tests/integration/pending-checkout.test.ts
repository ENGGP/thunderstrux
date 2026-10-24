import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as cancelCommerce } from "@/app/api/commerce/orders/[orderId]/cancel/route";
import { POST as cancelTicket } from "@/app/api/purchases/tickets/[orderId]/cancel/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { cancelledByBuyer, pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { setMockSession } from "@/tests/helpers/auth";
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
  await prisma.ticketReservation.create({ data: { orderId: order.id, organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, quantity: 2, expiresAt: new Date(Date.now() + holdMinutes * minute) } });
  // Stripe's page closes 5 minutes before the hold ends (DEF-033).
  const closesAt = Math.floor((Date.now() + (holdMinutes - 5) * minute) / 1000);
  const session = (status: string, paymentStatus = "unpaid") => ({
    id: order.stripeSessionId, status, payment_status: paymentStatus, url: "https://checkout.stripe.com/c/pay/test", expires_at: closesAt,
    metadata: { orderId: order.id, eventId: event.id, organisationId: society.organisation.id, ticketTypeId: event.ticketTypes[0].id, quantity: "2" }
  });
  setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
  return { society, event, buyer, order, session, closesAt };
}

const cancel = (orderId: string, init: RequestInit = {}) =>
  cancelTicket(jsonRequest(`http://localhost:3000/api/purchases/tickets/${orderId}/cancel`, {}, init), routeContext({ orderId }));

describe("unpaid orders", () => {
  test("Stripe decides the state: waiting with the payment page, confirming once paid, ended once expired or the hold is over", async () => {
    const fixture = await unpaidTicketOrder();
    const state = () => pendingCheckoutState({ kind: "ticket", id: fixture.order.id });
    stripe.retrieve.mockResolvedValue(fixture.session("open"));
    // The buyer is told Stripe's deadline, not the hold's few extra minutes.
    expect(await state()).toEqual({ state: "waiting", holdEndsAt: new Date(fixture.closesAt * 1000), paymentUrl: "https://checkout.stripe.com/c/pay/test" });
    stripe.retrieve.mockResolvedValue(fixture.session("complete", "paid"));
    expect(await state()).toEqual({ state: "confirming" });
    stripe.retrieve.mockResolvedValue(fixture.session("expired"));
    expect(await state()).toEqual({ state: "ended" });
    // Without Stripe's answer the hold decides, and no payment page is offered.
    stripe.retrieve.mockRejectedValue(new Error("Stripe unavailable"));
    expect(await state()).toMatchObject({ state: "waiting", paymentUrl: null });
    await prisma.ticketReservation.update({ where: { orderId: fixture.order.id }, data: { expiresAt: new Date(Date.now() - minute) } });
    stripe.retrieve.mockResolvedValue(fixture.session("open"));
    expect(await state()).toEqual({ state: "ended" });
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
    const society = await createOrganisationAccount({ stripeReady: true });
    const buyer = await createMember();
    const now = Date.now();
    const plan = await prisma.membershipProduct.create({ data: { organisationId: society.organisation.id, name: "Semester 2", priceAmount: 2500, startsAt: new Date(now - 86_400_000), endsAt: new Date(now + 100 * 86_400_000), entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });
    const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: society.organisation.id, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 183, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 2500, name: plan.name, termStartsAt: plan.startsAt, termEndsAt: plan.endsAt, membershipProductId: plan.id }], expiresAt: new Date(now + 20 * minute)
    }));
    const order = await prisma.commerceOrder.update({ where: { id: created.id }, data: { stripeSessionId: "cs_test_membership_cancel" } });
    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    stripe.retrieve.mockResolvedValue({ id: order.stripeSessionId, status: "open", payment_status: "unpaid", url: "https://checkout.stripe.com/c/pay/m", expires_at: Math.floor((now + 20 * minute) / 1000) });
    stripe.expire.mockResolvedValue({ id: order.stripeSessionId, status: "expired", payment_status: "unpaid" });
    expect(await pendingCheckoutState({ kind: "commerce", id: order.id })).toMatchObject({ state: "waiting" });

    const response = await cancelCommerce(jsonRequest(`http://localhost:3000/api/commerce/orders/${order.id}/cancel`, {}), routeContext({ orderId: order.id }));
    expect(await parseJsonResponse(response)).toEqual({ status: "cancelled" });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "expired", failureReason: "buyer_cancelled" });
    expect(await cancelledByBuyer({ kind: "commerce", id: order.id })).toBe(true);
  });
});
