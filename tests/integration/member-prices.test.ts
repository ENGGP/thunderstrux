import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CheckoutPage from "@/app/(public)/events/[eventId]/checkout/page";
import PublicEventPage from "@/app/(public)/events/[eventId]/page";
import { POST as createEventRoute } from "@/app/api/events/route";
import { prisma } from "@/lib/db";
import { getPublishedEventDetail, priceForViewer } from "@/lib/events/public-events";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { readGuestSession, redeemGuestAccess, requestGuestAccess } from "@/lib/guest/guest-access";
import { memberPricePlan, memberPriceUnused } from "@/lib/memberships/offers";
import { CheckoutCreationError, createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { releaseFreeRegistration } from "@/lib/payments/free-cancellation";
import { orderReference, requestOrderRefund } from "@/lib/payments/order-refunds";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createMembershipGrant as membership, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), refundList: vi.fn(), refundCreate: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { create: stripe.create, retrieve: stripe.retrieve } }, refunds: { list: stripe.refundList, create: stripe.refundCreate } })
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));
beforeEach(() => {
  stripe.create.mockImplementation(async () => ({ id: unique("cs_member"), url: "https://checkout.stripe.test/pay" }));
  setRateLimitTestEnabled(true);
  setRateLimitTestBackend(createTestRateLimitBackend());
});
afterEach(() => {
  for (const mock of Object.values(stripe)) mock.mockReset();
  setRateLimitTestEnabled(null);
  setRateLimitTestBackend(null);
});

const day = 86_400_000;
const now = Date.now();

// A society selling a $15 ticket that members get for $10, and a plan unlocking member prices.
async function society({ memberPrice = 1000, stripeReady = true } = {}) {
  const account = await createOrganisationAccount({ stripeReady });
  const event = await createEvent({ organisationId: account.organisation.id, status: "published", ticketTypes: [{ name: "General", price: 1500, memberPrice, quantity: 20 }] });
  return { ...account, event, ticketType: event.ticketTypes[0] };
}

const buy = (fixture: Awaited<ReturnType<typeof society>>, userId: string, expectedUnitPrice: number, quantity = 2) =>
  createEventCheckout({ userId, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity, expectedUnitPrice, idempotencyKey: unique("member-price-key") });

describe("member prices", () => {
  test("a member with member prices pays the member price; the order records the membership and Stripe charges it", async () => {
    const fixture = await society();
    const member = await createMember();
    const grant = await membership(fixture.organisation.id, member.id, member.email);

    const refused = await buy(fixture, member.id, 1500, 1).catch((error) => error);
    expect(refused).toBeInstanceOf(CheckoutCreationError);
    expect(refused).toMatchObject({ kind: "quote_changed", details: [{ value: 1000 }] });

    await buy(fixture, member.id, 1000, 1);
    const order = await prisma.order.findFirstOrThrow({ where: { userId: member.id } });
    expect(order).toMatchObject({ unitPrice: 1000, totalAmount: 1000, membershipGrantId: grant.id, membershipEntitlementVersion: 3, paymentKind: "stripe" });
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ line_items: [{ quantity: 1, price_data: { unit_amount: 1000 } }] });
    // The price basis is a purchase fact.
    await expect(prisma.order.update({ where: { id: order.id }, data: { membershipGrantId: null, membershipEntitlementVersion: null } })).rejects.toThrow();
  });

  test("a join, an upcoming, expired or revoked membership, one without member prices, and a guest all pay the standard price", async () => {
    const fixture = await society();
    const cases = [
      async (id: string) => prisma.organisationMember.create({ data: { userId: id, organisationId: fixture.organisation.id, role: "member" } }),
      async (id: string, email: string) => membership(fixture.organisation.id, id, email, { startsAt: new Date(now + day), endsAt: new Date(now + 100 * day) }),
      async (id: string, email: string) => membership(fixture.organisation.id, id, email, { startsAt: new Date(now - 100 * day), endsAt: new Date(now - day) }),
      async (id: string, email: string) => {
        const grant = await membership(fixture.organisation.id, id, email);
        await prisma.membershipGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revocationReason: "Synthetic test revocation" } });
      },
      async (id: string, email: string) => membership(fixture.organisation.id, id, email, { entitlements: ["members_only_events"] }),
      // Another society's membership.
      async (id: string, email: string) => membership((await createOrganisationAccount()).organisation.id, id, email)
    ];
    for (const setup of cases) {
      const member = await createMember();
      await setup(member.id, member.email);
      await expect(buy(fixture, member.id, 1000)).rejects.toMatchObject({ kind: "quote_changed" });
      await buy(fixture, member.id, 1500);
      expect(await prisma.order.findFirstOrThrow({ where: { userId: member.id } })).toMatchObject({ unitPrice: 1500, membershipGrantId: null });
      expect(await memberPricePlan(fixture.organisation.slug, member.id)).toBeNull();
    }

    // A verified guest, even one whose email matches a member, pays the standard price.
    const email = `${unique("guest")}@example.com`;
    await requestGuestAccess(email);
    const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: email }, orderBy: { createdAt: "desc" } });
    const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
    const { sessionId } = await redeemGuestAccess(new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!);
    const guest = (await readGuestSession(sessionId))!;
    await expect(createEventCheckout({ guest: { grantId: guest.grantId, guestIdentityId: guest.guestIdentityId }, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity: 1, expectedUnitPrice: 1000, idempotencyKey: unique("guest-key-000000") })).rejects.toMatchObject({ kind: "quote_changed" });
  });

  test("a member price of zero is a free registration with the membership recorded, even without payments", async () => {
    const fixture = await society({ memberPrice: 0, stripeReady: false });
    const member = await createMember();
    const grant = await membership(fixture.organisation.id, member.id, member.email);
    const result = await buy(fixture, member.id, 0, 1);
    expect(result).toMatchObject({ status: "fulfilled" });
    expect(await prisma.order.findFirstOrThrow({ where: { userId: member.id } })).toMatchObject({ paymentKind: "free", unitPrice: 0, membershipGrantId: grant.id, membershipEntitlementVersion: 3 });
    expect(stripe.create).not.toHaveBeenCalled();
  });

  test("one ticket per member per event: more in one checkout is refused, and a second checkout pays the standard price on any ticket type", async () => {
    const account = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: account.organisation.id, status: "published", ticketTypes: [{ name: "General", price: 1500, memberPrice: 1000, quantity: 20 }, { name: "VIP", price: 3000, memberPrice: 2000, quantity: 20 }] });
    const [general, vip] = event.ticketTypes;
    const member = await createMember();
    const grant = await membership(account.organisation.id, member.id, member.email);
    const checkout = (ticketTypeId: string, quantity: number, expectedUnitPrice: number) =>
      createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId, quantity, expectedUnitPrice, idempotencyKey: unique("member-price-key") });

    // Refused with the reason, even from a stale page that still shows the standard price.
    await expect(checkout(general.id, 2, 1000)).rejects.toMatchObject({ kind: "member_price_limit", details: [{ path: ["quantity"], value: 1 }] });
    await expect(checkout(general.id, 3, 1500)).rejects.toMatchObject({ kind: "member_price_limit" });
    expect(await prisma.order.count({ where: { userId: member.id } })).toBe(0);
    expect(await memberPriceUnused(event.id, member.id)).toBe(true);

    // A live hold uses it up, across ticket types, and the page says the same as checkout.
    await checkout(general.id, 1, 1000);
    expect(await memberPriceUnused(event.id, member.id)).toBe(false);
    await expect(checkout(vip.id, 1, 2000)).rejects.toMatchObject({ kind: "quote_changed", details: [{ value: 3000 }] });
    // So a member can buy for friends at the standard price, however many fit one order.
    expect(await checkout(vip.id, 3, 3000)).toMatchObject({ status: "redirect" });
    expect(await prisma.order.findMany({ where: { userId: member.id }, orderBy: { createdAt: "asc" }, select: { unitPrice: true, quantity: true, membershipGrantId: true } })).toEqual([
      { unitPrice: 1000, quantity: 1, membershipGrantId: grant.id },
      { unitPrice: 3000, quantity: 3, membershipGrantId: null }
    ]);

    // A hold that lapsed gives it back.
    await prisma.ticketReservation.updateMany({ where: { userId: member.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await memberPriceUnused(event.id, member.id)).toBe(true);
    expect(await checkout(vip.id, 1, 2000)).toMatchObject({ status: "redirect" });
  });

  test("the event and checkout pages give the same answer as checkout: one at the member price, then the standard price and why", async () => {
    const fixture = await society();
    const member = await createMember();
    await membership(fixture.organisation.id, member.id, member.email);
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const eventId = fixture.event.id;
    const ticketTypeId = fixture.ticketType.id;
    const eventPage = async () => renderPage(await PublicEventPage({ params: Promise.resolve({ eventId }) }));
    const checkoutPage = async (quantity: number) => renderPage(await CheckoutPage({ params: Promise.resolve({ eventId }), searchParams: Promise.resolve({ ticketTypeId, quantity: String(quantity) }) }));

    expect(await eventPage()).toContain("1 at the member price");
    expect(await checkoutPage(1)).toContain("(member price)");
    // Several chosen before signing in: back to the box, which keeps the ticket chosen.
    await expect(checkoutPage(2)).rejects.toThrow(`REDIRECT:/events/${eventId}?ticketTypeId=${ticketTypeId}`);

    await buy(fixture, member.id, 1000, 1);
    const page = await eventPage();
    expect(page).toContain("Yours is used or in an open checkout");
    expect(page).toContain("Up to 10 per order");
    const review = await checkoutPage(2);
    expect(review).not.toContain("(member price)");
    expect(review).toContain("Pay A$30.00");
  });

  test("racing checkouts can't both get the member price, paid or free", async () => {
    for (const memberPrice of [1000, 0]) {
      const fixture = await society({ memberPrice });
      const member = await createMember();
      await membership(fixture.organisation.id, member.id, member.email);
      const results = await Promise.allSettled([buy(fixture, member.id, memberPrice, 1), buy(fixture, member.id, memberPrice, 1)]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ kind: "quote_changed", details: [{ value: 1500 }] });
      expect(await prisma.order.count({ where: { userId: member.id, membershipGrantId: { not: null } } })).toBe(1);
    }
  });

  test("a refund gives the member price back", async () => {
    const fixture = await society();
    const member = await createMember();
    await membership(fixture.organisation.id, member.id, member.email);
    await buy(fixture, member.id, 1000, 1);
    const order = await prisma.order.findFirstOrThrow({ where: { userId: member.id } });
    await reconcileCompletedCheckoutSession(checkoutSession({ id: order.stripeSessionId as string, orderId: order.id, eventId: fixture.event.id, organisationId: fixture.organisation.id, ticketTypeId: fixture.ticketType.id, quantity: 1, amountTotal: 1000 }));
    expect(await memberPriceUnused(fixture.event.id, member.id)).toBe(false);
    await expect(buy(fixture, member.id, 1000, 1)).rejects.toMatchObject({ kind: "quote_changed", details: [{ value: 1500 }] });

    const destination = fixture.organisation.stripeAccountId;
    const intent = unique("pi");
    stripe.retrieve.mockResolvedValue({ payment_status: "paid", amount_total: 1000, currency: "aud", metadata: { orderId: order.id }, payment_intent: { id: intent, amount_received: 1000, transfer_data: { destination }, latest_charge: { disputed: false } } });
    stripe.refundList.mockResolvedValue({ data: [] });
    stripe.refundCreate.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => ({ id: unique("re"), status: "succeeded", amount: 1000, currency: "aud", payment_intent: intent, metadata: { refundRequestId: params.metadata.refundRequestId, orderId: order.id } }));
    await requestOrderRefund({ organisationId: fixture.organisation.id, orderId: order.id, actor: { id: fixture.user.id }, reason: "Buyer can no longer attend.", confirmation: orderReference(order.id) });

    expect(await prisma.ticket.findFirstOrThrow({ where: { orderId: order.id } })).toMatchObject({ validity: "void" });
    expect(await memberPriceUnused(fixture.event.id, member.id)).toBe(true);
    expect(await buy(fixture, member.id, 1000, 1)).toMatchObject({ status: "redirect" });
  });

  test("a free member ticket follows the same rule, and releasing it gives it back", async () => {
    const fixture = await society({ memberPrice: 0 });
    const member = await createMember();
    await membership(fixture.organisation.id, member.id, member.email);
    await expect(buy(fixture, member.id, 0, 2)).rejects.toMatchObject({ kind: "member_price_limit" });
    const free = await buy(fixture, member.id, 0, 1);
    if (free.status !== "fulfilled") throw new Error("not fulfilled");
    await expect(buy(fixture, member.id, 0, 1)).rejects.toMatchObject({ kind: "quote_changed", details: [{ value: 1500 }] });
    expect(await buy(fixture, member.id, 1500, 2)).toMatchObject({ status: "redirect" });

    await releaseFreeRegistration({ orderId: free.orderId, buyerUserId: member.id });
    expect(await buy(fixture, member.id, 0, 1)).toMatchObject({ status: "fulfilled" });
  });

  test("a member price that saves nothing neither limits a member nor uses up their ticket", async () => {
    const fixture = await society({ memberPrice: 1500 });
    const member = await createMember();
    await membership(fixture.organisation.id, member.id, member.email);
    expect(await buy(fixture, member.id, 1500, 3)).toMatchObject({ status: "redirect" });
    expect(await prisma.order.findFirstOrThrow({ where: { userId: member.id } })).toMatchObject({ quantity: 3, membershipGrantId: null });
    expect(await memberPriceUnused(fixture.event.id, member.id)).toBe(true);
    const detail = (await getPublishedEventDetail(fixture.event.id))!;
    expect(priceForViewer(detail.ticketTypes, true)[0]).not.toHaveProperty("memberPriced");
  });

  test("members-only access doesn't depend on the member price: a second checkout gets in at the standard price", async () => {
    const fixture = await society();
    await prisma.event.update({ where: { id: fixture.event.id }, data: { visibility: "members_only" } });
    const member = await createMember();
    await membership(fixture.organisation.id, member.id, member.email, { entitlements: ["member_prices", "members_only_events"] });
    expect(await buy(fixture, member.id, 1000, 1)).toMatchObject({ status: "redirect" });
    expect(await buy(fixture, member.id, 1500, 2)).toMatchObject({ status: "redirect" });
  });

  test("a membership revoked before payment lands sends the payment to review; one that simply ended during the hold keeps the price", async () => {
    const fixture = await society();
    const revokedMember = await createMember();
    const revoked = await membership(fixture.organisation.id, revokedMember.id, revokedMember.email);
    await buy(fixture, revokedMember.id, 1000, 1);
    const revokedOrder = await prisma.order.findFirstOrThrow({ where: { userId: revokedMember.id } });
    await prisma.membershipGrant.update({ where: { id: revoked.id }, data: { revokedAt: new Date(), revocationReason: "Synthetic test revocation" } });
    const paid = (order: { id: string; stripeSessionId: string | null }) =>
      reconcileCompletedCheckoutSession(checkoutSession({ id: order.stripeSessionId as string, orderId: order.id, eventId: fixture.event.id, organisationId: fixture.organisation.id, ticketTypeId: fixture.ticketType.id, quantity: 1, amountTotal: 1000 }));
    await paid(revokedOrder);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: revokedOrder.id } })).toMatchObject({ requiresCompensationReview: true, fulfilledAt: null });
    expect(await prisma.ticket.count({ where: { orderId: revokedOrder.id } })).toBe(0);

    const lapsingMember = await createMember();
    const lapsing = await membership(fixture.organisation.id, lapsingMember.id, lapsingMember.email, { endsAt: new Date(Date.now() + 60_000) });
    await buy(fixture, lapsingMember.id, 1000, 1);
    const lapsingOrder = await prisma.order.findFirstOrThrow({ where: { userId: lapsingMember.id } });
    // The term reaches its end while the tickets are held.
    await prisma.$executeRawUnsafe(`ALTER TABLE "MembershipGrant" DISABLE TRIGGER "MembershipGrant_preserve_facts"`);
    try {
      await prisma.membershipGrant.update({ where: { id: lapsing.id }, data: { endsAt: new Date(Date.now() - 1000) } });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "MembershipGrant" ENABLE TRIGGER "MembershipGrant_preserve_facts"`);
    }
    await paid(lapsingOrder);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: lapsingOrder.id } })).toMatchObject({ status: "paid", requiresCompensationReview: false, unitPrice: 1000 });
    expect(await prisma.ticket.count({ where: { orderId: lapsingOrder.id } })).toBe(1);
  });

  test("the public page shows members what they pay and everyone else what members pay; prices are checked on save", async () => {
    const fixture = await society();
    const detail = (await getPublishedEventDetail(fixture.event.id))!;
    expect(detail.ticketTypes[0]).toMatchObject({ price: 1500, memberPrice: 1000 });
    expect(priceForViewer(detail.ticketTypes, true)[0]).toMatchObject({ price: 1000, standardPrice: 1500, memberPriced: true });
    expect(priceForViewer(detail.ticketTypes, false)[0]).toMatchObject({ price: 1500 });
    const free = await society({ memberPrice: 0, stripeReady: false });
    const freeDetail = (await getPublishedEventDetail(free.event.id))!;
    expect(freeDetail.ticketTypes[0].unavailable).toBe("payments_unavailable");
    expect(priceForViewer(freeDetail.ticketTypes, true)[0].unavailable).toBeNull();

    setMockSession({ userId: fixture.user.id, email: fixture.user.email, accountRole: "organisation" });
    const start = new Date(now + 14 * day);
    const body = { organisationId: fixture.organisation.id, title: "Night", description: "Night", location: "Hall", startTime: start.toISOString(), endTime: new Date(start.getTime() + 3_600_000).toISOString() };
    const tooHigh = await createEventRoute(jsonRequest("http://localhost:3000/api/events", { ...body, ticketTypes: [{ name: "General", price: 1000, memberPrice: 1200, quantity: 5 }] }));
    expect(tooHigh.status).toBe(400);
    expect(JSON.stringify(await parseJsonResponse(tooHigh))).toContain("memberPrice");
    const saved = await createEventRoute(jsonRequest("http://localhost:3000/api/events", { ...body, ticketTypes: [{ name: "General", price: 1000, memberPrice: 800, quantity: 5 }] }));
    expect(saved.status).toBe(201);
    await expect(prisma.ticketType.update({ where: { id: fixture.ticketType.id }, data: { memberPrice: 2000 } })).rejects.toThrow();
  });
});
