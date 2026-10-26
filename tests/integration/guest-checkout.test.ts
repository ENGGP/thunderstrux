import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as checkoutRoute } from "@/app/api/payments/checkout/event/route";
import { POST as recoverRoute } from "@/app/api/guest/recover/route";
import GuestOrderPage from "@/app/guest/orders/[orderId]/page";
import CheckoutPage from "@/app/(public)/events/[eventId]/checkout/page";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { loadTicketDeliveryOrder, renderTicketEmail } from "@/lib/email/ticket-delivery";
import { processTicketEmailOutboxBatch } from "@/lib/email/ticket-email-outbox";
import { GuestAccessError, guestCookieName, purchaseLinkForEmail, readGuestSession, redeemGuestAccess, requestGuestAccess, requestGuestRecovery } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { getOrganisationEventTickets } from "@/lib/tickets/check-in";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestBackendFailure, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { setMockSession } from "@/tests/helpers/auth";
import { guestSession, newestGuestLink } from "@/tests/helpers/guest";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const stripeMocks = vi.hoisted(() => ({ createSession: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { create: stripeMocks.createSession } } })
}));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("NOT_FOUND"); },
  redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() })
}));

beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); stripeMocks.createSession.mockReset(); });

async function eventWith(price: number) {
  const { organisation, user } = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: price ? "General" : "Free entry", price, quantity: 20 }] });
  return { organisation, owner: user, event, ticketType: event.ticketTypes[0] };
}

const buy = (fixture: Awaited<ReturnType<typeof eventWith>>, quantity = 2) => ({
  eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity, expectedUnitPrice: fixture.ticketType.price, idempotencyKey: unique("guest-key")
});

function guestRequest(sessionId: string, body: unknown, csrf: string | null = guestCsrfToken(sessionId)) {
  return jsonRequest("http://localhost:3000/api/payments/checkout/event", body, {
    headers: { cookie: `${guestCookieName}=${sessionId}`, ...(csrf ? { "x-thunderstrux-guest-csrf": csrf } : {}) }
  });
}

describe("guest checkout", () => {
  test("a free guest registration is fulfilled for the verified guest, never a member", async () => {
    const fixture = await eventWith(0);
    const { email, sessionId, session } = await guestSession();
    const response = await checkoutRoute(guestRequest(sessionId, buy(fixture)));
    const { orderId } = await parseJsonResponse(response);
    expect(response.status).toBe(200);

    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({
      status: "paid", paymentKind: "free", userId: null, guestIdentityId: session.guestIdentityId,
      buyerEmailSnapshot: email, buyerIdentityProvenance: "verified_guest"
    });
    expect(await prisma.checkoutAttempt.findFirstOrThrow({ where: { orderId } })).toMatchObject({ actorKind: "guest", actorId: session.grantId });
    expect(await prisma.ticket.count({ where: { orderId } })).toBe(2);
    expect(await prisma.emailOutbox.count({ where: { orderId } })).toBe(1);

    // The email worker sends the tickets with a link that opens this order.
    vi.stubEnv("RESEND_API_KEY", "re_test_placeholder");
    const sent: Array<{ key: string | null; text: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      sent.push({ key: new Headers(init.headers).get("Idempotency-Key"), text: JSON.parse(String(init.body)).text });
      return new Response(JSON.stringify({ id: "msg_guest" }), { status: 200 });
    }));
    expect(await processTicketEmailOutboxBatch()).toMatchObject({ sent: 1 });
    expect(sent[0].key).toMatch(/^ticket-email\/.+\/0$/);
    const link = sent[0].text.match(/http:\/\/localhost:3000\/guest\/access#token=[A-Za-z0-9_-]{43}/)![0];
    expect((await redeemGuestAccess(new URLSearchParams(new URL(link).hash.slice(1)).get("token")!)).callbackUrl).toBe(`/guest/orders/${orderId}`);
  });

  test("the name a guest gives with their email reaches the order, so door staff find them by name", async () => {
    const fixture = await eventWith(0);
    const email = `${unique("named")}@example.com`;
    await requestGuestAccess(email, undefined, new Date(), { firstName: " Gia ", lastName: "Nguyen" });
    const { sessionId } = await redeemGuestAccess(await newestGuestLink(email));
    const { orderId } = await parseJsonResponse(await checkoutRoute(guestRequest(sessionId, buy(fixture, 1))));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ buyerFirstNameSnapshot: "Gia", buyerLastNameSnapshot: "Nguyen" });
    setMockSession({ userId: fixture.owner.id, email: fixture.owner.email, accountRole: "organisation" });
    const door = await getOrganisationEventTickets(fixture.organisation.id, fixture.event.id, { query: "gia nguyen" });
    expect(door.tickets.map((ticket) => ticket.orderId)).toEqual([orderId]);
  });

  test("a paid guest checkout holds stock and returns from Stripe to the guest order page", async () => {
    const fixture = await eventWith(1500);
    const buyer = await guestSession();
    const { sessionId } = buyer;
    stripeMocks.createSession.mockImplementation(async () => ({ id: unique("cs_test"), url: "https://checkout.stripe.test/pay" }));
    const response = await checkoutRoute(guestRequest(sessionId, buy(fixture)));
    expect(await parseJsonResponse(response)).toEqual({ kind: "stripe", url: "https://checkout.stripe.test/pay" });

    const order = await prisma.order.findFirstOrThrow({ where: { eventId: fixture.event.id } });
    expect(order).toMatchObject({ status: "pending", userId: null, buyerIdentityProvenance: "verified_guest" });
    expect(stripeMocks.createSession.mock.calls[0][0].success_url).toBe(`http://localhost:3000/guest/orders/${order.id}`);
    expect(await prisma.ticketReservation.findUniqueOrThrow({ where: { orderId: order.id } })).toMatchObject({ userId: null, status: "active" });

    // The signed webhook fulfils it like any order, and Find your purchase then opens it.
    vi.spyOn(console, "info").mockImplementation(() => {});
    const attached = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const session = checkoutSession({ id: attached.stripeSessionId!, orderId: order.id, eventId: fixture.event.id, organisationId: fixture.organisation.id, ticketTypeId: fixture.ticketType.id, quantity: 2, amountTotal: 3000 });
    await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: unique("evt_guest") })).resolves.toMatchObject({ status: "fulfilled" });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
    await requestGuestRecovery(buyer.email);
    expect((await redeemGuestAccess(await newestGuestLink(buyer.email))).callbackUrl).toBe(`/guest/orders/${order.id}`);
  });

  test("one guest email's unpaid holds are capped across checkout sessions (SEC-005)", async () => {
    stripeMocks.createSession.mockImplementation(async () => ({ id: unique("cs_guest_cap"), url: "https://checkout.stripe.test/guest" }));
    const fixture = await eventWith(1500);
    const email = `${unique("guest")}@example.com`;
    expect((await checkoutRoute(guestRequest((await guestSession(email)).sessionId, buy(fixture, 10)))).status).toBe(200);
    const refused = await checkoutRoute(guestRequest((await guestSession(email)).sessionId, buy(fixture, 1)));
    expect(refused.status).toBe(409);
    expect((await parseJsonResponse(refused)).error.details[0]).toMatchObject({ reason: "purchase_in_progress" });
    expect((await checkoutRoute(guestRequest((await guestSession()).sessionId, buy(fixture, 1)))).status).toBe(200);
  });

  test("guest checkout needs a live checkout session and its CSRF token", async () => {
    const fixture = await eventWith(0);
    const { sessionId, guest } = await guestSession();
    expect((await checkoutRoute(guestRequest(sessionId, buy(fixture), null))).status).toBe(403);
    expect((await checkoutRoute(guestRequest(sessionId, buy(fixture), "0".repeat(64)))).status).toBe(403);
    expect((await checkoutRoute(guestRequest("D".repeat(43), buy(fixture)))).status).toBe(401);

    await prisma.guestAccessGrant.update({ where: { id: guest.grantId }, data: { sessionExpiresAt: new Date(Date.now() - 1000) } });
    expect((await checkoutRoute(guestRequest(sessionId, buy(fixture)))).status).toBe(401);
    // The service checks again under the GuestIdentity lock.
    await expect(createEventCheckout({ ...buy(fixture), guest })).rejects.toBeInstanceOf(GuestAccessError);
    expect(await prisma.order.count()).toBe(0);
  });

  test("the checkout page asks a visitor for their email, then shows the review to the guest", async () => {
    const fixture = await eventWith(1500);
    const props = { params: Promise.resolve({ eventId: fixture.event.id }), searchParams: Promise.resolve({ ticketTypeId: fixture.ticketType.id, quantity: "2", guest: "1" }) };
    expect(await renderPage(await CheckoutPage(props))).toContain("Where should we send your tickets?");

    const { email, sessionId } = await guestSession();
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = sessionId;
    const review = await renderPage(await CheckoutPage(props));
    expect(review).toContain("Review your order");
    expect(review).toContain(email);
    expect(review).toContain("Buying as a guest");
  });
});

describe("guest order access", () => {
  test("a guest order opens only for the session that bought it or its purchase link; an order id alone shows nothing", async () => {
    const fixture = await eventWith(0);
    const buyer = await guestSession();
    const { orderId } = await createEventCheckout({ ...buy(fixture), guest: buyer.guest }) as { orderId: string };
    const page = async () => renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId }) }));

    globalThis.__THUNDERSTRUX_TEST_GUEST__ = buyer.sessionId;
    expect(await page()).toContain(`You&#x27;re going to ${fixture.event.title}`);

    // Same email, a different session; another guest; no session at all: the same generic page.
    for (const other of [await guestSession(buyer.email), await guestSession()]) {
      globalThis.__THUNDERSTRUX_TEST_GUEST__ = other.sessionId;
      expect(await page()).toContain("Open your order from your email");
    }
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = undefined;
    const anonymous = await page();
    expect(anonymous).toContain("Open your order from your email");
    expect(anonymous).not.toContain(fixture.event.title);
  });

  test("a refunded or disputed guest order says so and shows no tickets for the door (T44a)", async () => {
    const fixture = await eventWith(1500);
    const buyer = await guestSession();
    const order = await prisma.order.create({ data: {
      organisationId: fixture.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity: 2, unitPrice: 1500, totalAmount: 3000,
      status: "paid", paidAt: new Date(), fulfilledAt: new Date(), stripeSessionId: unique("cs_test"), guestIdentityId: buyer.guest.guestIdentityId, paymentKind: "stripe",
      purchasedTicketTypeName: "General", buyerEmailSnapshot: buyer.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "verified_guest"
    } });
    await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, organisationId: fixture.organisation.id })) });
    const { sessionId } = await redeemGuestAccess((await purchaseLinkForEmail(order.id, buyer.guest.guestIdentityId)).split("token=")[1]);
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = sessionId;
    const page = async () => renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId: order.id }) }));
    expect(await page()).toContain("Your tickets");

    await prisma.order.update({ where: { id: order.id }, data: { refundStatus: "refunded" } });
    await prisma.ticket.updateMany({ where: { orderId: order.id }, data: { validity: "void", validityReason: "refunded", validityChangedAt: new Date() } });
    await prisma.refundRequest.create({ data: { orderId: order.id, organisationId: fixture.organisation.id, amount: 3000, reason: "Buyer asked for a refund.", operationKey: unique("refund"), status: "succeeded", resolvedAt: new Date() } });
    const refunded = await page();
    expect(refunded).toContain("$30.00 was refunded to your card");
    expect(refunded).not.toContain("Your tickets");
    expect(refunded).not.toContain("You&#x27;re going to");
    expect(refunded).not.toContain("Keep your tickets in one place");

    await prisma.order.update({ where: { id: order.id }, data: { refundStatus: null, disputeStatus: "open" } });
    expect(await page()).toContain("Payment disputed");
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = undefined;
  });

  test("the ticket email carries a fresh purchase link on each send that opens just that order", async () => {
    const fixture = await eventWith(0);
    const buyer = await guestSession();
    const first = await createEventCheckout({ ...buy(fixture), guest: buyer.guest }) as { orderId: string };
    const second = await createEventCheckout({ ...buy(fixture, 1), guest: buyer.guest }) as { orderId: string };

    const link = await purchaseLinkForEmail(first.orderId, buyer.guest.guestIdentityId);
    const retry = await purchaseLinkForEmail(first.orderId, buyer.guest.guestIdentityId);
    expect(retry).not.toBe(link);
    expect(await prisma.guestAccessGrant.count({ where: { orderId: first.orderId } })).toBe(2);
    expect(JSON.stringify(await prisma.guestAccessGrant.findMany({ where: { orderId: first.orderId } }))).not.toContain(new URL(link).hash.slice(7));
    expect(renderTicketEmail(await loadTicketDeliveryOrder(first.orderId), link).text).toContain(link);

    const redeemed = await redeemGuestAccess(new URLSearchParams(new URL(link).hash.slice(1)).get("token")!);
    expect(redeemed.callbackUrl).toBe(`/guest/orders/${first.orderId}`);
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = redeemed.sessionId;
    expect(await renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId: first.orderId }) }))).toContain("Your tickets");
    expect(await renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId: second.orderId }) }))).toContain("Open your order from your email");
  });

  test("Find your purchase sends one fresh link per paid guest purchase, and nothing for other addresses", async () => {
    const fixture = await eventWith(0);
    const buyer = await guestSession();
    const orders = [
      await createEventCheckout({ ...buy(fixture), guest: buyer.guest }) as { orderId: string },
      await createEventCheckout({ ...buy(fixture, 1), guest: buyer.guest }) as { orderId: string }
    ];
    // A member's order with the same address is never sent to the guest.
    const member = await createMember({ email: `member-${buyer.email}` });
    await createEventCheckout({ ...buy(fixture, 1), userId: member.id });

    const before = await prisma.notificationOutbox.count();
    const response = await recoverRoute(jsonRequest("http://localhost:3000/api/guest/recover", { email: buyer.email.toUpperCase() }));
    expect(response.status).toBe(202);
    expect(await recoverRoute(jsonRequest("http://localhost:3000/api/guest/recover", { email: "nobody@example.com" }))).toHaveProperty("status", 202);
    const jobs = await prisma.notificationOutbox.findMany({ where: { template: "guest_order_link" } });
    expect(jobs).toHaveLength(2);
    expect(await prisma.notificationOutbox.count()).toBe(before + 2);

    const opened = await Promise.all(jobs.map(async (job) => {
      const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
      return (await redeemGuestAccess(new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!)).callbackUrl;
    }));
    expect(opened.sort()).toEqual(orders.map(({ orderId }) => `/guest/orders/${orderId}`).sort());

    // A second request sends fresh links; the used ones are already spent.
    await requestGuestRecovery(buyer.email);
    expect(await prisma.notificationOutbox.count({ where: { template: "guest_order_link", status: "pending" } })).toBe(2);
  });
});
