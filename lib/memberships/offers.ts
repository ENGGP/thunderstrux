import type { MembershipEntitlement } from "@prisma/client";
import { prisma } from "@/lib/db";
import { activeEntitlementGrant, grantState, type GrantState } from "@/lib/memberships/grants";

// What members see of memberships (T24a): a society's offers with the
// viewer's own standing, and their memberships across societies. Checkout
// re-checks everything under locks; these reads only decide what to show.

type Term = { startsAt: Date; endsAt: Date };
const overlaps = (a: Term, b: Term) => a.startsAt < b.endsAt && b.startsAt < a.endsAt;

export type OfferState =
  // The viewer holds this plan.
  | { kind: "held"; grant: { state: GrantState; endsAt: Date; startsAt: Date } }
  // Another membership of theirs already covers some of these dates.
  | { kind: "covered"; by: string }
  // A checkout of theirs for these dates is still waiting on Stripe.
  | { kind: "pending" }
  // On sale to them; `renew` when it follows a membership they hold.
  | { kind: "available"; renew: boolean };

export type Offer = {
  id: string;
  name: string;
  description: string;
  priceAmount: number;
  startsAt: Date;
  endsAt: Date;
  entitlements: MembershipEntitlement[];
  state: OfferState;
};

async function viewerTerms(userId: string, organisationId: string) {
  const [grants, pending] = await Promise.all([
    prisma.membershipGrant.findMany({
      where: { userId, organisationId, revokedAt: null },
      select: { membershipProductId: true, startsAt: true, endsAt: true, revokedAt: true, product: { select: { name: true } } }
    }),
    prisma.commerceOrderLine.findMany({
      where: { organisationId, kind: "membership", order: { userId, status: "pending" } },
      select: { termStartsAt: true, termEndsAt: true }
    })
  ]);
  return { grants, pending: pending.map((line) => ({ startsAt: line.termStartsAt as Date, endsAt: line.termEndsAt as Date })) };
}

function offerState(plan: Term & { id: string }, terms: Awaited<ReturnType<typeof viewerTerms>> | null, now: Date): OfferState {
  if (!terms) return { kind: "available", renew: false };
  const held = terms.grants.find((grant) => grant.membershipProductId === plan.id);
  if (held) return { kind: "held", grant: { state: grantState(held, now), startsAt: held.startsAt, endsAt: held.endsAt } };
  const covering = terms.grants.find((grant) => overlaps(grant, plan));
  if (covering) return { kind: "covered", by: covering.product.name };
  if (terms.pending.some((term) => overlaps(term, plan))) return { kind: "pending" };
  const renew = terms.grants.some((grant) => grant.endsAt > now && grant.endsAt <= plan.startsAt);
  return { kind: "available", renew };
}

// Published plans still to end, soonest first, each with the viewer's standing.
// `memberUntil` is the end of the viewer's running membership, for the badge.
export async function membershipOffers(organisationId: string, viewerId: string | null, now = new Date()) {
  const [plans, terms] = await Promise.all([
    prisma.membershipProduct.findMany({
      where: { organisationId, status: "published", endsAt: { gt: now } },
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      select: { id: true, name: true, description: true, priceAmount: true, startsAt: true, endsAt: true, entitlements: true }
    }),
    viewerId ? viewerTerms(viewerId, organisationId) : null
  ]);
  const running = terms?.grants.filter((grant) => grantState(grant, now) === "active") ?? [];
  return {
    offers: plans.map((plan): Offer => ({ ...plan, state: offerState(plan, terms, now) })),
    memberUntil: running.length ? new Date(Math.max(...running.map((grant) => grant.endsAt.getTime()))) : null
  };
}

// The one offer the review page shows, or null when it isn't on sale.
export async function membershipOffer(organisationId: string, planId: string, viewerId: string, now = new Date()) {
  const { offers } = await membershipOffers(organisationId, viewerId, now);
  const offer = offers.find((candidate) => candidate.id === planId) ?? null;
  if (!offer) return null;
  const terms = await viewerTerms(viewerId, organisationId);
  // The membership this one would follow, for "Your cover".
  const current = terms.grants
    .filter((grant) => grant.endsAt > now && grant.endsAt <= offer.startsAt)
    .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime())[0];
  return { offer, current: current ? { name: current.product.name, endsAt: current.endsAt } : null };
}

export const myMembershipViews = ["active", "upcoming", "expired", "revoked"] as const;
export type MyMembershipView = (typeof myMembershipViews)[number];

// The member's own memberships in every society, by state, newest term first,
// each with what ended it early and the next plan they could renew with.
export async function myMemberships(userId: string, view: MyMembershipView, now = new Date()) {
  const grants = await prisma.membershipGrant.findMany({
    where: { userId },
    orderBy: [{ startsAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true, organisationId: true, startsAt: true, endsAt: true, revokedAt: true, revocationReason: true, entitlements: true,
      product: { select: { name: true } },
      organisation: { select: { name: true, slug: true, timeZone: true } },
      line: { select: { order: { select: { id: true, paymentKind: true, totalAmount: true, cancelledAt: true, refundStatus: true } } } }
    }
  });
  const counts = Object.fromEntries(myMembershipViews.map((name) => [name, 0])) as Record<MyMembershipView, number>;
  for (const grant of grants) counts[grantState(grant, now)] += 1;
  const shown = grants.filter((grant) => grantState(grant, now) === view);

  // Renewal: the earliest published plan of that society starting at or after
  // this membership ends and overlapping none of the member's memberships there.
  const renewals = new Map<string, { id: string; name: string; priceAmount: number }>();
  if (view === "active" || view === "upcoming") {
    const societies = [...new Set(shown.map((grant) => grant.organisationId))];
    const plans = societies.length
      ? await prisma.membershipProduct.findMany({
          where: { organisationId: { in: societies }, status: "published", endsAt: { gt: now } },
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          select: { id: true, name: true, priceAmount: true, startsAt: true, endsAt: true, organisationId: true }
        })
      : [];
    for (const grant of shown) {
      const held = grants.filter((other) => other.organisationId === grant.organisationId && !other.revokedAt);
      const next = plans.find((plan) => plan.organisationId === grant.organisationId && plan.startsAt >= grant.endsAt && !held.some((other) => overlaps(other, plan)));
      if (next) renewals.set(grant.id, { id: next.id, name: next.name, priceAmount: next.priceAmount });
    }
  }

  return {
    counts,
    memberships: shown.map((grant) => {
      const order = grant.line.order;
      return {
        id: grant.id,
        plan: grant.product.name,
        society: grant.organisation,
        startsAt: grant.startsAt,
        endsAt: grant.endsAt,
        entitlements: grant.entitlements,
        state: grantState(grant, now),
        paidAmount: order.paymentKind === "stripe" ? order.totalAmount : 0,
        orderId: order.id,
        endedBy: !grant.revokedAt ? null : order.refundStatus === "refunded" ? "refund" as const : order.cancelledAt ? "cancellation" as const : "society" as const,
        revokedAt: grant.revokedAt,
        revocationReason: grant.revocationReason,
        renewal: renewals.get(grant.id) ?? null
      };
    })
  };
}

// The member's own membership order, for the page Stripe returns to. Another
// member's order, or a merchandise order, is null.
export function ownMembershipOrder(userId: string, orderId: string) {
  return prisma.commerceOrder.findFirst({
    where: { id: orderId, userId, kind: "membership" },
    select: {
      id: true, status: true, requiresCompensationReview: true, sellerName: true,
      organisation: { select: { slug: true, timeZone: true } },
      lines: { take: 1, select: { nameSnapshot: true, membershipGrant: { select: { startsAt: true, endsAt: true, revokedAt: true } } } }
    }
  });
}

// Whether a member price on this society's tickets can be used now: a
// published plan still to end unlocks member prices (the builder's warning).
export async function memberPricesOnSale(organisationId: string, now = new Date()) {
  return (await prisma.membershipProduct.count({ where: { organisationId, status: "published", endsAt: { gt: now }, entitlements: { has: "member_prices" } } })) > 0;
}

// The plan whose membership gives this member the society's member prices
// now, by society slug, or null (the event page and ticket checkout).
export async function memberPricePlan(organisationSlug: string, userId: string, now = new Date()) {
  const organisation = await prisma.organisation.findUnique({ where: { slug: organisationSlug }, select: { id: true } });
  if (!organisation) return null;
  return (await activeEntitlementGrant(prisma, userId, organisation.id, "member_prices", now))?.product.name ?? null;
}
