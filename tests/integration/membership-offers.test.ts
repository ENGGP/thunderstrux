import { describe, expect, test } from "vitest";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { getAccessibleOrganisationsForCurrentAccount } from "@/lib/auth/access";
import { membershipOffer, membershipOffers, myMemberships } from "@/lib/memberships/offers";
import { setMockSession } from "@/tests/helpers/auth";
import { createMember, createOrganisationAccount, joinOrganisation } from "@/tests/helpers/test-data";

const day = 86_400_000;
const now = Date.now();

async function society() {
  const account = await createOrganisationAccount({ stripeReady: true });
  const plan = (data: { name: string; priceAmount?: number; startsAt: Date; endsAt: Date; status?: "draft" | "published" }) =>
    prisma.membershipProduct.create({
      data: { organisationId: account.organisation.id, priceAmount: 0, entitlements: ["member_prices"], publishedAt: new Date(), status: "published", ...data }
    });
  return { ...account, plan };
}

// A grant as fulfilment leaves it, with its order paid (or free) and fulfilled.
async function hold(userId: string, email: string, plan: { id: string; organisationId: string; name: string; priceAmount: number; startsAt: Date; endsAt: Date }, extra: { revoked?: boolean } = {}) {
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: plan.organisationId, kind: "membership", buyer: { userId }, buyerEmail: email, paymentKind: plan.priceAmount ? "stripe" : "free", feeAmount: 0, source: "checkout",
    lines: [{ quantity: 1, unitAmount: plan.priceAmount, name: plan.name, termStartsAt: plan.startsAt, termEndsAt: plan.endsAt, membershipProductId: plan.id }]
  }));
  await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  return prisma.membershipGrant.create({
    data: {
      userId, organisationId: plan.organisationId, membershipProductId: plan.id, commerceOrderLineId: line.id, startsAt: plan.startsAt, endsAt: plan.endsAt,
      entitlements: ["member_prices"], entitlementVersion: 1, ...(extra.revoked ? { revokedAt: new Date(), revocationReason: "Synthetic test revocation" } : {})
    }
  });
}

describe("membership offers and My memberships", () => {
  test("offers show each viewer's own standing: anonymous, join only, holder, covered, renewal and an expired member", async () => {
    const { organisation, plan } = await society();
    const current = await plan({ name: "Semester 2", startsAt: new Date(now - 10 * day), endsAt: new Date(now + 50 * day) });
    const next = await plan({ name: "Next year", startsAt: current.endsAt, endsAt: new Date(now + 400 * day) });
    const overlapping = await plan({ name: "Summer", startsAt: new Date(now + 40 * day), endsAt: new Date(now + 60 * day) });
    await plan({ name: "Draft plan", startsAt: new Date(now), endsAt: new Date(now + day), status: "draft" });
    await plan({ name: "Ended", startsAt: new Date(now - 100 * day), endsAt: new Date(now - 11 * day) });

    const anonymous = await membershipOffers(organisation.id, null);
    expect(anonymous.offers.map((offer) => offer.name)).toEqual(["Semester 2", "Summer", "Next year"]);
    expect(anonymous.offers.every((offer) => offer.state.kind === "available" && !offer.state.renew)).toBe(true);
    expect(anonymous.memberUntil).toBeNull();

    // A free join is not a membership.
    const joiner = await createMember();
    await joinOrganisation(joiner.id, organisation.id);
    const joined = await membershipOffers(organisation.id, joiner.id);
    expect(joined.memberUntil).toBeNull();
    expect(joined.offers.map((offer) => offer.state.kind)).toEqual(["available", "available", "available"]);

    const holder = await createMember();
    await hold(holder.id, holder.email, current);
    const held = await membershipOffers(organisation.id, holder.id);
    expect(held.memberUntil).toEqual(current.endsAt);
    expect(Object.fromEntries(held.offers.map((offer) => [offer.name, offer.state]))).toEqual({
      "Semester 2": { kind: "held", grant: { state: "active", startsAt: current.startsAt, endsAt: current.endsAt } },
      Summer: { kind: "covered", by: "Semester 2" },
      "Next year": { kind: "available", renew: true }
    });
    expect(await membershipOffer(organisation.id, next.id, holder.id)).toMatchObject({ offer: { id: next.id }, current: { name: "Semester 2", endsAt: current.endsAt } });
    expect(await membershipOffer(organisation.id, overlapping.id, holder.id)).toMatchObject({ offer: { state: { kind: "covered" } } });

    // An expired or revoked membership no longer counts.
    const lapsed = await createMember();
    const ended = await prisma.membershipProduct.findFirstOrThrow({ where: { name: "Ended", organisationId: organisation.id } });
    await hold(lapsed.id, lapsed.email, ended);
    await hold(lapsed.id, lapsed.email, current, { revoked: true });
    const expired = await membershipOffers(organisation.id, lapsed.id);
    expect(expired.memberUntil).toBeNull();
    expect(expired.offers.map((offer) => offer.state.kind)).toEqual(["available", "available", "available"]);

    // A checkout of theirs still waiting on Stripe.
    const waiting = await createMember();
    await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "membership", buyer: { userId: waiting.id }, buyerEmail: waiting.email, paymentKind: "stripe", feeAmount: 0, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 1000, name: "Summer", termStartsAt: overlapping.startsAt, termEndsAt: overlapping.endsAt, membershipProductId: overlapping.id }]
    }));
    expect((await membershipOffers(organisation.id, waiting.id)).offers.find((offer) => offer.id === overlapping.id)?.state).toEqual({ kind: "pending" });
    expect(await membershipOffer(organisation.id, "not-a-plan", holder.id)).toBeNull();
  });

  test("My memberships sorts by state, says what ended one early, and offers renewal only for a non-overlapping next term", async () => {
    const first = await society();
    const second = await society();
    const member = await createMember();
    const running = await first.plan({ name: "Semester 2", startsAt: new Date(now - day), endsAt: new Date(now + 30 * day) });
    const next = await first.plan({ name: "2027 membership", priceAmount: 2500, startsAt: running.endsAt, endsAt: new Date(now + 400 * day) });
    await hold(member.id, member.email, running);
    const other = await second.plan({ name: "Club year", priceAmount: 1500, startsAt: new Date(now - day), endsAt: new Date(now + 300 * day) });
    await hold(member.id, member.email, other);
    const upcoming = await second.plan({ name: "Club next", startsAt: new Date(now + 300 * day), endsAt: new Date(now + 600 * day) });
    await hold(member.id, member.email, upcoming);
    const refunded = await first.plan({ name: "Old", startsAt: new Date(now - 50 * day), endsAt: new Date(now - 2 * day) });
    const refundedGrant = await hold(member.id, member.email, { ...refunded, priceAmount: 900 }, { revoked: true });
    const refundedOrder = await prisma.commerceOrderLine.findFirstOrThrow({ where: { id: refundedGrant.commerceOrderLineId } });
    await prisma.commerceOrder.update({ where: { id: refundedOrder.orderId }, data: { refundStatus: "refunded" } });

    const active = await myMemberships(member.id, "active");
    expect(active.counts).toEqual({ active: 2, upcoming: 1, expired: 0, revoked: 1 });
    expect(Object.fromEntries(active.memberships.map((row) => [row.plan, row.renewal?.name ?? null]))).toEqual({ "Semester 2": "2027 membership", "Club year": null });
    expect(active.memberships.find((row) => row.plan === "Semester 2")?.renewal).toEqual({ id: next.id, name: "2027 membership", priceAmount: 2500, startsAt: next.startsAt });
    expect((await myMemberships(member.id, "upcoming")).memberships.map((row) => row.plan)).toEqual(["Club next"]);
    expect((await myMemberships(member.id, "revoked")).memberships).toEqual([expect.objectContaining({ plan: "Old", endedBy: "refund", paidAmount: 900 })]);
    // Another member sees none of these.
    expect((await myMemberships((await createMember()).id, "active")).memberships).toEqual([]);
  });

  test("the joined list shows Member until only beside a running membership", async () => {
    const { organisation, plan } = await society();
    const member = await createMember();
    await joinOrganisation(member.id, organisation.id);
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect((await getAccessibleOrganisationsForCurrentAccount())[0]).toMatchObject({ id: organisation.id, memberUntil: null });
    const current = await plan({ name: "Now", startsAt: new Date(now - day), endsAt: new Date(now + 30 * day) });
    await hold(member.id, member.email, current);
    expect((await getAccessibleOrganisationsForCurrentAccount())[0]).toMatchObject({ memberUntil: current.endsAt, timeZone: "Australia/Brisbane" });
  });
});
