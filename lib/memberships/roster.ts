import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { descendingCursorWhere, orderByForDirection, pageInfoForPage, readCursorOrFirstPage, type PaginationDirection } from "@/lib/pagination/cursor";
import { grantState, type GrantState } from "@/lib/memberships/grants";

// The society's membership roster (T23, members:read). Members, free joins and
// staff are different lists: a grant is a membership with dates, a join only
// follows the society, and neither is staff access.

export const rosterViews = ["active", "upcoming", "expired", "revoked"] as const;
export type RosterView = (typeof rosterViews)[number];
const pageSize = 25;

// The grants in one state, as grantState reads them.
export function grantViewWhere(view: RosterView, now: Date): Prisma.MembershipGrantWhereInput {
  if (view === "revoked") return { revokedAt: { not: null } };
  if (view === "upcoming") return { revokedAt: null, startsAt: { gt: now } };
  if (view === "expired") return { revokedAt: null, endsAt: { lte: now } };
  return { revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } };
}

function search(query: string): Prisma.UserWhereInput | undefined {
  if (!query) return undefined;
  return { OR: ["email", "firstName", "lastName"].map((field) => ({ [field]: { contains: query, mode: "insensitive" as const } })) };
}

export const memberName = (user: { firstName: string | null; lastName: string | null; email: string }) =>
  [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

// Newest grant first, a page either way; an unreadable cursor starts again from the first page.
export async function listRoster(organisationId: string, { view, query = "", cursor, direction, now = new Date() }: { view: RosterView; query?: string; cursor?: string; direction?: PaginationDirection; now?: Date }) {
  const user = search(query);
  const where: Prisma.MembershipGrantWhereInput = { organisationId, ...grantViewWhere(view, now), ...(user ? { user } : {}) };
  const from = readCursorOrFirstPage("grantedAt", cursor, direction);
  const [rows, ...counts] = await Promise.all([
    prisma.membershipGrant.findMany({
      where: { ...where, ...(from.at ? descendingCursorWhere("grantedAt", from.at, from.direction) : {}) },
      orderBy: orderByForDirection("grantedAt", from.direction, "desc"),
      take: pageSize + 1,
      select: {
        id: true, startsAt: true, endsAt: true, revokedAt: true, grantedAt: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        product: { select: { name: true } },
        line: { select: { order: { select: { id: true, paymentKind: true } } } }
      }
    }),
    ...rosterViews.map((name) => prisma.membershipGrant.count({ where: { organisationId, ...grantViewWhere(name, now) } })),
    prisma.organisationMember.count({ where: { organisationId, role: "member" } })
  ]);
  const page = pageInfoForPage({ items: rows, limit: pageSize, direction: from.direction, cursor: from.cursor, timestampField: "grantedAt" });
  return {
    members: page.items.map((grant) => ({
      id: grant.id,
      name: memberName(grant.user),
      email: grant.user.email,
      plan: grant.product.name,
      startsAt: grant.startsAt,
      endsAt: grant.endsAt,
      state: grantState(grant, now),
      paid: grant.line.order.paymentKind === "stripe",
      orderId: grant.line.order.id
    })),
    counts: { ...Object.fromEntries(rosterViews.map((name, index) => [name, counts[index]])), joins: counts[rosterViews.length] } as Record<RosterView | "joins", number>,
    nextCursor: page.pageInfo.nextCursor,
    previousCursor: page.pageInfo.previousCursor
  };
}

// People who joined the society for free. A join gives no member prices.
export async function listFreeJoins(organisationId: string, { query = "", cursor, direction }: { query?: string; cursor?: string; direction?: PaginationDirection }) {
  const user = search(query);
  const from = readCursorOrFirstPage("createdAt", cursor, direction);
  const rows = await prisma.organisationMember.findMany({
    where: { organisationId, role: "member", ...(user ? { user } : {}), ...(from.at ? descendingCursorWhere("createdAt", from.at, from.direction) : {}) },
    orderBy: orderByForDirection("createdAt", from.direction, "desc"),
    take: pageSize + 1,
    select: { id: true, createdAt: true, userId: true, user: { select: { firstName: true, lastName: true, email: true } } }
  });
  const page = pageInfoForPage({ items: rows, limit: pageSize, direction: from.direction, cursor: from.cursor, timestampField: "createdAt" });
  const members = await prisma.membershipGrant.findMany({
    where: { organisationId, revokedAt: null, endsAt: { gt: new Date() }, userId: { in: page.items.map((row) => row.userId) } },
    select: { userId: true }
  });
  const holders = new Set(members.map((grant) => grant.userId));
  return {
    joins: page.items.map((row) => ({ id: row.id, name: memberName(row.user), email: row.user.email, joinedAt: row.createdAt, member: holders.has(row.userId) })),
    nextCursor: page.pageInfo.nextCursor,
    previousCursor: page.pageInfo.previousCursor
  };
}

// One membership with what else this person has with the society. Another
// society's grant is null.
export async function readMembership(organisationId: string, grantId: string, now = new Date()) {
  const grant = await prisma.membershipGrant.findFirst({
    where: { id: grantId, organisationId },
    select: {
      id: true, userId: true, startsAt: true, endsAt: true, revokedAt: true, revocationReason: true, grantedAt: true, entitlements: true,
      user: { select: { firstName: true, lastName: true, email: true } },
      product: { select: { id: true, name: true } },
      line: { select: { order: { select: { id: true, paymentKind: true, cancelledAt: true, totalAmount: true, refundStatus: true, disputeStatus: true, externalRefundedAmount: true, externalRefundReviewedAt: true, disputes: { orderBy: { createdAt: "desc" }, take: 1, select: { stripeDisputeId: true, amount: true, providerStatus: true, evidenceDueBy: true, createdAt: true, closedAt: true } } } } } },
      revokedBy: { select: { firstName: true, lastName: true, email: true } }
    }
  });
  if (!grant) return null;
  const [join, others, staff] = await Promise.all([
    prisma.organisationMember.findFirst({ where: { organisationId, userId: grant.userId, role: "member" }, select: { createdAt: true } }),
    prisma.membershipGrant.findMany({
      where: { organisationId, userId: grant.userId, id: { not: grant.id } },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      take: 10,
      select: { id: true, startsAt: true, endsAt: true, revokedAt: true, product: { select: { name: true } } }
    }),
    prisma.organisationStaff.findFirst({ where: { organisationId, userId: grant.userId, status: "active" }, select: { role: true } })
  ]);
  return {
    id: grant.id,
    name: memberName(grant.user),
    email: grant.user.email,
    plan: grant.product,
    startsAt: grant.startsAt,
    endsAt: grant.endsAt,
    grantedAt: grant.grantedAt,
    entitlements: grant.entitlements,
    state: grantState(grant, now),
    revokedAt: grant.revokedAt,
    revocationReason: grant.revocationReason,
    revokedBy: grant.revokedBy ? memberName(grant.revokedBy) : null,
    paid: grant.line.order.paymentKind === "stripe",
    orderId: grant.line.order.id,
    cancelled: grant.line.order.cancelledAt !== null,
    amount: grant.line.order.totalAmount,
    refundStatus: grant.line.order.refundStatus,
    // What Stripe reported that Thunderstrux didn't do (PAY-003).
    stripeReview: { disputeStatus: grant.line.order.disputeStatus, externalRefundedAmount: grant.line.order.externalRefundedAmount, externalRefundReviewedAt: grant.line.order.externalRefundReviewedAt, totalAmount: grant.line.order.totalAmount, refundStatus: grant.line.order.refundStatus, dispute: grant.line.order.disputes[0] ?? null },
    joinedAt: join?.createdAt ?? null,
    staff: !!staff,
    others: others.map((other) => ({ id: other.id, plan: other.product.name, startsAt: other.startsAt, endsAt: other.endsAt, state: grantState(other, now) as GrantState }))
  };
}
