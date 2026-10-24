import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as membershipCheckout } from "@/app/api/payments/checkout/membership/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { prisma } from "@/lib/db";
import { grantState } from "@/lib/memberships/grants";
import { listFreeJoins, listRoster, readMembership } from "@/lib/memberships/roster";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, joinOrganisation, unique } from "@/tests/helpers/test-data";

const webhookSecret = "whsec_membership_test";
const stripe = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => "whsec_membership_test",
    getStripe: () => ({ checkout: { sessions: { create: stripe.create } }, webhooks: new RealStripe("sk_test_membership").webhooks })
  };
});
beforeEach(() => {
  stripe.create.mockImplementation(async () => ({ id: unique("cs_membership"), url: "https://checkout.stripe.test/pay" }));
});
afterEach(() => {
  stripe.create.mockReset();
});

const day = 86_400_000;
const now = Date.now();
async function society() {
  const account = await createOrganisationAccount({ stripeReady: true });
  const plan = (data: { name?: string; priceAmount?: number; startsAt?: Date; endsAt?: Date; status?: "draft" | "published" | "archived" } = {}) =>
    prisma.membershipProduct.create({
      data: {
        organisationId: account.organisation.id, name: data.name ?? unique("Plan"), priceAmount: data.priceAmount ?? 0,
        startsAt: data.startsAt ?? new Date(now - day), endsAt: data.endsAt ?? new Date(now + 100 * day),
        entitlements: ["member_prices", "members_only_events"], status: data.status ?? "published",
        publishedAt: data.status === "draft" ? null : new Date(), archivedAt: data.status === "archived" ? new Date() : null
      }
    });
  return { ...account, plan };
}
async function member() {
  const user = await createMember();
  setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  return user;
}
async function buy(organisationId: string, planId: string, expectedTotal = 0, idempotencyKey = unique("membership-key-00")) {
  const response = await membershipCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/membership", { organisationId, selection: { planId }, expectedTotal, idempotencyKey }));
  return { status: response.status, body: await parseJsonResponse(response) };
}
async function deliverPaid(commerceOrderId: string, id = unique("evt")) {
  const order = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: commerceOrderId } });
  const session = {
    id: order.stripeSessionId, object: "checkout.session", payment_status: "paid", amount_total: order.totalAmount, currency: "aud",
    payment_intent: { id: unique("pi"), transfer_data: { destination: order.sellerStripeAccountId } },
    metadata: { family: "membership", commerceOrderId: order.id, organisationId: order.organisationId }
  };
  const body = JSON.stringify({ id, object: "event", type: "checkout.session.completed", livemode: false, created: Math.floor(Date.now() / 1000), data: { object: session } });
  const signature = new Stripe("sk_test_membership").webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  expect((await webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }))).status).toBe(200);
}

describe("membership grants", () => {
  test("a free plan grants its term and rights at once with a receipt; a replay changes nothing; the next term can follow it but not overlap it", async () => {
    const { organisation, plan } = await society();
    const current = await plan({ name: "Semester 2" });
    const buyer = await member();
    const key = unique("membership-free-key");
    const first = await buy(organisation.id, current.id, 0, key);
    expect(first.body).toMatchObject({ kind: "fulfilled" });
    expect(await buy(organisation.id, current.id, 0, key)).toMatchObject({ status: 200, body: { kind: "fulfilled", commerceOrderId: first.body.commerceOrderId } });

    const grant = await prisma.membershipGrant.findFirstOrThrow({ where: { userId: buyer.id }, include: { line: true } });
    expect(grant).toMatchObject({ organisationId: organisation.id, membershipProductId: current.id, startsAt: current.startsAt, endsAt: current.endsAt, entitlements: ["member_prices", "members_only_events"], entitlementVersion: 1, revokedAt: null });
    expect(grant.line).toMatchObject({ orderId: first.body.commerceOrderId, membershipProductId: current.id });
    expect(grantState(grant)).toBe("active");
    const receipt = await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: `membership-receipt/${grant.id}` } });
    expect(receipt).toMatchObject({ recipient: buyer.email, template: "business_notice", organisationId: organisation.id });
    expect(await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: first.body.commerceOrderId }, select: { type: true }, orderBy: { sequence: "asc" } })).toEqual([{ type: "order_created" }, { type: "free_fulfilled" }]);

    // Overlapping dates: refused before anything is written, whether the same plan or another.
    const overlapping = await plan({ name: "Full year", startsAt: new Date(now + 10 * day), endsAt: new Date(now + 300 * day) });
    for (const planId of [current.id, overlapping.id]) {
      const refused = await buy(organisation.id, planId);
      expect(refused.status).toBe(409);
      expect(refused.body.error.details[0]).toMatchObject({ reason: "term_overlap" });
    }
    // Renewal: the next term starts the instant this one ends ([start, end)).
    const next = await plan({ name: "Next year", startsAt: current.endsAt, endsAt: new Date(current.endsAt.getTime() + 365 * day) });
    expect((await buy(organisation.id, next.id)).body).toMatchObject({ kind: "fulfilled" });
    expect(await prisma.membershipGrant.count({ where: { userId: buyer.id } })).toBe(2);
    expect(grantState(await prisma.membershipGrant.findFirstOrThrow({ where: { userId: buyer.id, membershipProductId: next.id } }))).toBe("upcoming");
    expect(await prisma.commerceOrder.count()).toBe(2);
  });

  test("Stripe returns the member to the trusted address they bought from, and to the app URL otherwise", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://thunderstrux.example");
    vi.stubEnv("TRUSTED_APP_ORIGINS", "http://127.0.0.1:3080");
    const { organisation, plan } = await society();
    const paid = await plan({ priceAmount: 2500 });
    await member();
    const from = (origin: string) => membershipCheckout(jsonRequest("http://127.0.0.1:3080/api/payments/checkout/membership", { organisationId: organisation.id, selection: { planId: paid.id }, expectedTotal: 2500, idempotencyKey: unique("membership-origin") }, { headers: { origin } }));
    expect((await from("http://127.0.0.1:3080")).status).toBe(200);
    expect(stripe.create.mock.calls[0][0].success_url).toMatch(/^http:\/\/127\.0\.0\.1:3080\/memberships\/orders\//);
    expect(stripe.create.mock.calls[0][0].cancel_url).toMatch(/^http:\/\/127\.0\.0\.1:3080\/memberships\/orders\/.+\?left=1$/);
    // An address that isn't trusted never reaches Stripe: the request is refused first.
    expect((await from("https://evil.example")).status).toBe(403);
    expect(stripe.create).toHaveBeenCalledTimes(1);
  });

  test("a paid plan grants only from the verified webhook, once, and a second checkout for the same dates waits", async () => {
    const { organisation, plan } = await society();
    const paid = await plan({ priceAmount: 2500 });
    const buyer = await member();
    const started = await buy(organisation.id, paid.id, 2500);
    expect(started.body).toEqual({ kind: "stripe", url: "https://checkout.stripe.test/pay" });
    const order = await prisma.commerceOrder.findFirstOrThrow({ where: { userId: buyer.id } });
    expect(order).toMatchObject({ kind: "membership", status: "pending", totalAmount: 2500, feeAmount: 183 });
    expect(stripe.create.mock.calls[0][0]).toMatchObject({
      metadata: { family: "membership", commerceOrderId: order.id }, line_items: [{ quantity: 1, price_data: { unit_amount: 2500, product_data: { name: paid.name } } }],
      // Stripe returns the member to the order's own page, which shows its real state (T24a).
      success_url: `http://localhost:3000/memberships/orders/${order.id}`, cancel_url: `http://localhost:3000/memberships/orders/${order.id}?left=1`
    });
    expect(await prisma.membershipGrant.count()).toBe(0);

    const waiting = await buy(organisation.id, paid.id, 2500);
    expect(waiting.status).toBe(409);
    expect(waiting.body.error.details[0]).toMatchObject({ reason: "purchase_in_progress" });
    // A changed price is refused as a quote change, not charged.
    expect((await buy(organisation.id, (await plan({ priceAmount: 900, startsAt: new Date(now + 200 * day), endsAt: new Date(now + 300 * day) })).id, 500)).status).toBe(409);

    const event = unique("evt");
    await deliverPaid(order.id, event);
    await deliverPaid(order.id, event);
    await deliverPaid(order.id);
    expect(await prisma.membershipGrant.count({ where: { userId: buyer.id } })).toBe(1);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "paid", requiresCompensationReview: false });
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: "membership-receipt/" } } })).toBe(1);
  });

  test("a payment for dates the member meanwhile got another way goes to compensation review, with no second grant", async () => {
    const { organisation, plan } = await society();
    const paid = await plan({ priceAmount: 2500 });
    const buyer = await member();
    await buy(organisation.id, paid.id, 2500);
    const order = await prisma.commerceOrder.findFirstOrThrow({ where: { userId: buyer.id } });
    // The checkout expired and the member then took an overlapping free plan.
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "expired" } });
    const free = await plan({ startsAt: new Date(now + day), endsAt: new Date(now + 50 * day) });
    expect((await buy(organisation.id, free.id)).body).toMatchObject({ kind: "fulfilled" });
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "pending" } });

    await deliverPaid(order.id);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ requiresCompensationReview: true, reviewReason: "term_overlap", fulfilledAt: null });
    expect(await prisma.membershipGrant.count({ where: { userId: buyer.id } })).toBe(1);
  });

  test("two checkouts for one term with different keys make exactly one grant", async () => {
    const { organisation, plan } = await society();
    const free = await plan();
    const buyer = await member();
    const results = await Promise.all([buy(organisation.id, free.id), buy(organisation.id, free.id), buy(organisation.id, free.id)]);
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409)).toHaveLength(2);
    expect(await prisma.membershipGrant.count({ where: { userId: buyer.id } })).toBe(1);
  });

  test("drafts, archived, ended and other societies' plans can't be bought, and unverified members can't buy", async () => {
    const { organisation, plan } = await society();
    const other = await society();
    const refused = [
      await plan({ status: "draft" }),
      await plan({ status: "archived" }),
      await plan({ startsAt: new Date(now - 100 * day), endsAt: new Date(now - day) }),
      await other.plan()
    ];
    await member();
    for (const target of refused) {
      const result = await buy(organisation.id, target.id);
      expect(result.status, target.name).toBe(409);
      expect(result.body.error.details[0]).toMatchObject({ reason: "plan_unavailable" });
    }
    const unverified = await createMember();
    await prisma.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: null } });
    setMockSession({ userId: unverified.id, email: unverified.email, accountRole: "member" });
    expect((await buy(organisation.id, (await plan()).id)).status).toBe(403);
    expect(await prisma.membershipGrant.count()).toBe(0);
    expect(await prisma.commerceOrder.count()).toBe(0);
  });

  test("state follows the clock and revocation exactly at the term's edges", () => {
    const startsAt = new Date("2027-01-01T00:00:00Z");
    const endsAt = new Date("2027-07-01T00:00:00Z");
    expect(grantState({ startsAt, endsAt, revokedAt: null }, new Date(startsAt.getTime() - 1))).toBe("upcoming");
    expect(grantState({ startsAt, endsAt, revokedAt: null }, startsAt)).toBe("active");
    expect(grantState({ startsAt, endsAt, revokedAt: null }, new Date(endsAt.getTime() - 1))).toBe("active");
    expect(grantState({ startsAt, endsAt, revokedAt: null }, endsAt)).toBe("expired");
    expect(grantState({ startsAt, endsAt, revokedAt: new Date() }, startsAt)).toBe("revoked");
  });

  test("the roster splits members by state, keeps free joins apart, searches, pages, and never shows another society's members", async () => {
    const { organisation, plan } = await society();
    const current = await plan({ name: "Now" });
    const later = await plan({ name: "Later", startsAt: new Date(now + 200 * day), endsAt: new Date(now + 300 * day) });
    const sam = await member();
    await prisma.user.update({ where: { id: sam.id }, data: { firstName: "Sam", lastName: "Lee" } });
    await buy(organisation.id, current.id);
    await buy(organisation.id, later.id);
    const priya = await member();
    await buy(organisation.id, current.id);
    const joiner = await createMember();
    await joinOrganisation(joiner.id, organisation.id);
    await joinOrganisation(sam.id, organisation.id);
    const revoked = await prisma.membershipGrant.findFirstOrThrow({ where: { userId: priya.id } });
    await prisma.membershipGrant.update({ where: { id: revoked.id }, data: { revokedAt: new Date(), revocationReason: "Synthetic test revocation" } });
    const other = await society();
    await member();
    await buy(other.organisation.id, (await other.plan()).id);

    const active = await listRoster(organisation.id, { view: "active" });
    expect(active.members.map((row) => row.name)).toEqual(["Sam Lee"]);
    expect(active.counts).toEqual({ active: 1, upcoming: 1, expired: 0, revoked: 1, joins: 2 });
    expect(active.members[0]).toMatchObject({ plan: "Now", state: "active", paid: false });
    expect((await listRoster(organisation.id, { view: "upcoming" })).members.map((row) => row.plan)).toEqual(["Later"]);
    expect((await listRoster(organisation.id, { view: "revoked" })).members.map((row) => row.email)).toEqual([priya.email]);
    expect((await listRoster(organisation.id, { view: "active", query: "nobody" })).members).toEqual([]);
    expect((await listRoster(organisation.id, { view: "active", query: "sam l" })).members).toHaveLength(0);
    expect((await listRoster(organisation.id, { view: "active", query: "LEE" })).members).toHaveLength(1);

    const joins = await listFreeJoins(organisation.id, {});
    expect(Object.fromEntries(joins.joins.map((join) => [join.email, join.member]))).toEqual({ [joiner.email]: false, [sam.email]: true });

    const detail = await readMembership(organisation.id, active.members[0].id);
    expect(detail).toMatchObject({ name: "Sam Lee", state: "active", staff: false, others: [{ plan: "Later", state: "upcoming" }] });
    expect(detail?.joinedAt).toBeInstanceOf(Date);
    expect(await readMembership(other.organisation.id, active.members[0].id)).toBeNull();
  });

  test("roster pages are stable when grants share a time", async () => {
    const { organisation, plan } = await society();
    const plans = await Promise.all(Array.from({ length: 26 }, (_, index) => plan({ startsAt: new Date(now + index * 2 * day), endsAt: new Date(now + (index * 2 + 1) * day) })));
    const buyer = await member();
    for (const target of plans) await buy(organisation.id, target.id);
    await prisma.$executeRawUnsafe(`ALTER TABLE "MembershipGrant" DISABLE TRIGGER "MembershipGrant_preserve_facts"`);
    try {
      await prisma.membershipGrant.updateMany({ where: { userId: buyer.id }, data: { grantedAt: new Date("2026-10-01T00:00:00Z") } });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "MembershipGrant" ENABLE TRIGGER "MembershipGrant_preserve_facts"`);
    }
    const first = await listRoster(organisation.id, { view: "upcoming" });
    const second = await listRoster(organisation.id, { view: "upcoming", cursor: first.nextCursor ?? undefined });
    const ids = [...first.members, ...second.members].map((row) => row.id);
    expect(first.members).toHaveLength(25);
    expect(new Set(ids).size).toBe(first.counts.upcoming);
    expect(second.nextCursor).toBeNull();
    expect((await listRoster(organisation.id, { view: "upcoming", cursor: "not-a-cursor" })).members).toHaveLength(25);
  }, 90_000);
});
