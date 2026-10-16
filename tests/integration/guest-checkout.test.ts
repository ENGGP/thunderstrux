import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as checkoutRoute } from "@/app/api/payments/checkout/event/route";
import { POST as recoverRoute } from "@/app/api/guest/recover/route";
import GuestOrderPage from "@/app/guest/orders/[orderId]/page";
import CheckoutPage from "@/app/(public)/events/[eventId]/checkout/page";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { loadTicketDeliveryOrder, renderTicketEmail } from "@/lib/email/ticket-delivery";
import { GuestAccessError, guestCookieName, guestCsrfToken, purchaseLinkForEmail, readGuestSession, redeemGuestAccess, requestGuestAccess, requestGuestRecovery } from "@/lib/guest/guest-access";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestBackendFailure, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
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

// The raw token of the newest link emailed to an address, read from the encrypted outbox.
async function newestLink(email: string) {
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: email, status: "pending" }, orderBy: { createdAt: "desc" } });
  const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  return new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!;
}

async function guestSession(email = `${unique("guest")}@example.com`) {
  await requestGuestAccess(email);
  const { sessionId } = await redeemGuestAccess(await newestLink(email));
  const session = (await readGuestSession(sessionId))!;
  return { email, sessionId, session, guest: { grantId: session.grantId, guestIdentityId: session.guestIdentityId } };
}

async function eventWith(price: number) {
  const { organisation } = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: price ? "General" : "Free entry", price, quantity: 20 }] });
  return { organisation, event, ticketType: event.ticketTypes[0] };
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

    // The signed webhook fulfils it like any order, and Find your tickets then opens it.
    vi.spyOn(console, "info").mockImplementation(() => {});
    const attached = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    const session = checkoutSession({ id: attached.stripeSessionId!, orderId: order.id, eventId: fixture.event.id, organisationId: fixture.organisation.id, ticketTypeId: fixture.ticketType.id, quantity: 2, amountTotal: 3000 });
    await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: unique("evt_guest") })).resolves.toMatchObject({ status: "fulfilled" });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(2);
    await requestGuestRecovery(buyer.email);
    expect((await redeemGuestAccess(await newestLink(buyer.email))).callbackUrl).toBe(`/guest/orders/${order.id}`);
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

  test("the ticket email carries one stable purchase link per email job that opens just that order", async () => {
    const fixture = await eventWith(0);
    const buyer = await guestSession();
    const first = await createEventCheckout({ ...buy(fixture), guest: buyer.guest }) as { orderId: string };
    const second = await createEventCheckout({ ...buy(fixture, 1), guest: buyer.guest }) as { orderId: string };

    const link = await purchaseLinkForEmail(first.orderId, buyer.guest.guestIdentityId, "ticket-email/job-1");
    expect(await purchaseLinkForEmail(first.orderId, buyer.guest.guestIdentityId, "ticket-email/job-1")).toBe(link);
    expect(await prisma.guestAccessGrant.count({ where: { orderId: first.orderId } })).toBe(1);
    expect(renderTicketEmail(await loadTicketDeliveryOrder(first.orderId), link).text).toContain(link);

    const redeemed = await redeemGuestAccess(new URLSearchParams(new URL(link).hash.slice(1)).get("token")!);
    expect(redeemed.callbackUrl).toBe(`/guest/orders/${first.orderId}`);
    globalThis.__THUNDERSTRUX_TEST_GUEST__ = redeemed.sessionId;
    expect(await renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId: first.orderId }) }))).toContain("Your tickets");
    expect(await renderPage(await GuestOrderPage({ params: Promise.resolve({ orderId: second.orderId }) }))).toContain("Open your order from your email");
  });

  test("Find your tickets sends one fresh link per paid guest purchase, and nothing for other addresses", async () => {
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
