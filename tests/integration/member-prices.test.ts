import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as createEventRoute } from "@/app/api/events/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { getPublishedEventDetail, priceForViewer } from "@/lib/events/public-events";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { readGuestSession, redeemGuestAccess, requestGuestAccess } from "@/lib/guest/guest-access";
import { memberPricePlan } from "@/lib/memberships/offers";
import { CheckoutCreationError, createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { create: stripe.create } } })
}));
beforeEach(() => {
  stripe.create.mockImplementation(async () => ({ id: unique("cs_member"), url: "https://checkout.stripe.test/pay" }));
  setRateLimitTestEnabled(true);
  setRateLimitTestBackend(createTestRateLimitBackend());
});
afterEach(() => {
  stripe.create.mockReset();
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

// A membership as fulfilment leaves it.
async function membership(organisationId: string, userId: string, email: string, { startsAt = new Date(now - day), endsAt = new Date(now + 100 * day), entitlements = ["member_prices"] as Array<"member_prices" | "members_only_events"> } = {}) {
  const plan = await prisma.membershipProduct.create({ data: { organisationId, name: unique("Plan"), priceAmount: 0, startsAt, endsAt, entitlements, status: "published", publishedAt: new Date() } });
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId, kind: "membership", buyer: { userId }, buyerEmail: email, paymentKind: "free", source: "checkout",
    lines: [{ quantity: 1, unitAmount: 0, name: plan.name, termStartsAt: startsAt, termEndsAt: endsAt, membershipProductId: plan.id }]
  }));
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  return prisma.membershipGrant.create({ data: { userId, organisationId, membershipProductId: plan.id, commerceOrderLineId: line.id, startsAt, endsAt, entitlements, entitlementVersion: 3 } });
}

const buy = (fixture: Awaited<ReturnType<typeof society>>, userId: string, expectedUnitPrice: number, quantity = 2) =>
  createEventCheckout({ userId, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity, expectedUnitPrice, idempotencyKey: unique("member-price-key") });

describe("member prices", () => {
  test("a member with member prices pays the member price; the order records the membership and Stripe charges it", async () => {
    const fixture = await society();
    const member = await createMember();
    const grant = await membership(fixture.organisation.id, member.id, member.email);

    const refused = await buy(fixture, member.id, 1500).catch((error) => error);
    expect(refused).toBeInstanceOf(CheckoutCreationError);
    expect(refused).toMatchObject({ kind: "quote_changed", details: [{ value: 1000 }] });

    await buy(fixture, member.id, 1000);
    const order = await prisma.order.findFirstOrThrow({ where: { userId: member.id } });
    expect(order).toMatchObject({ unitPrice: 1000, totalAmount: 2000, membershipGrantId: grant.id, membershipEntitlementVersion: 3, paymentKind: "stripe" });
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ line_items: [{ quantity: 2, price_data: { unit_amount: 1000 } }] });
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
    const result = await buy(fixture, member.id, 0);
    expect(result).toMatchObject({ status: "fulfilled" });
    expect(await prisma.order.findFirstOrThrow({ where: { userId: member.id } })).toMatchObject({ paymentKind: "free", unitPrice: 0, membershipGrantId: grant.id, membershipEntitlementVersion: 3 });
    expect(stripe.create).not.toHaveBeenCalled();
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
    expect(priceForViewer(detail.ticketTypes, true)[0]).toMatchObject({ price: 1000, standardPrice: 1500 });
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
