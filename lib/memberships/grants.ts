import type { MembershipEntitlement, MembershipGrant, Prisma } from "@prisma/client";
import { z } from "zod";
import type { CommerceFamilyAdapter, CommerceOrderForHooks } from "@/lib/commerce/families";
import { enqueueNotification } from "@/lib/email/notification-outbox";
import { formatDate } from "@/lib/format";
import { zoneCity } from "@/lib/zoned-time";

// Membership grants (T23, database spec 8.2) and the membership commerce
// family. Loaded by the payments webhook and the stale-order worker through
// the family registry, so this module stays free of auth and request code.
//
// Lock order: buyer (User), then the society (Organisation), then the
// commerce order. Plan edits take the same Organisation lock, so a quote never
// reads a plan mid-edit, and two checkouts by one member run one at a time.

export type GrantState = "upcoming" | "active" | "expired" | "revoked";

// The only rule for a grant's state: computed from the clock, never stored.
export function grantState(grant: Pick<MembershipGrant, "startsAt" | "endsAt" | "revokedAt">, now = new Date()): GrantState {
  if (grant.revokedAt) return "revoked";
  if (now < grant.startsAt) return "upcoming";
  return now < grant.endsAt ? "active" : "expired";
}

// The member's running membership in a society that carries a right, if any:
// unrevoked, started and not yet ended at `now` (T24b). Several can overlap
// only across rights versions; the latest ending one is used.
export function activeEntitlementGrant(
  tx: Pick<Prisma.TransactionClient, "membershipGrant">,
  userId: string,
  organisationId: string,
  entitlement: MembershipEntitlement,
  now: Date
) {
  return tx.membershipGrant.findFirst({
    where: { userId, organisationId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now }, entitlements: { has: entitlement } },
    orderBy: [{ endsAt: "desc" }, { id: "asc" }],
    select: { id: true, entitlementVersion: true, product: { select: { name: true } } }
  });
}

export class MembershipUnavailableError extends Error {
  constructor(readonly reason: "plan_unavailable" | "term_overlap" | "purchase_in_progress", message: string) {
    super(message);
    this.name = "MembershipUnavailableError";
  }
}

async function lockMemberAndSociety(tx: Prisma.TransactionClient, userId: string, organisationId: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
}

// An unrevoked grant of this member in this society whose term meets [startsAt, endsAt).
function overlappingGrant(tx: Prisma.TransactionClient, userId: string, organisationId: string, term: { startsAt: Date; endsAt: Date }) {
  return tx.membershipGrant.findFirst({
    where: { userId, organisationId, revokedAt: null, startsAt: { lt: term.endsAt }, endsAt: { gt: term.startsAt } },
    select: { id: true }
  });
}

const selection = z.object({ planId: z.string().trim().min(1).max(100) }).strict();

export const membershipFamily: CommerceFamilyAdapter<z.infer<typeof selection>> = {
  selection,
  guests: false,

  async quote(tx, { organisationId, buyer, selection: { planId }, now }) {
    if (!("userId" in buyer)) throw new MembershipUnavailableError("plan_unavailable", "Memberships need a member account");
    // Checkout has already locked the buyer.
    await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${organisationId} FOR UPDATE`;
    const plan = await tx.membershipProduct.findFirst({
      where: { id: planId, organisationId, status: "published", endsAt: { gt: now } },
      select: { id: true, name: true, priceAmount: true, startsAt: true, endsAt: true }
    });
    if (!plan) throw new MembershipUnavailableError("plan_unavailable", "This membership is no longer on sale");
    if (await overlappingGrant(tx, buyer.userId, organisationId, plan)) {
      throw new MembershipUnavailableError("term_overlap", "You already have a membership for these dates");
    }
    // An earlier checkout for overlapping dates still waiting on Stripe: finish or let it expire first.
    const pending = await tx.commerceOrderLine.findFirst({
      where: {
        organisationId, kind: "membership", termStartsAt: { lt: plan.endsAt }, termEndsAt: { gt: plan.startsAt },
        order: { userId: buyer.userId, status: "pending" }
      },
      select: { id: true }
    });
    if (pending) throw new MembershipUnavailableError("purchase_in_progress", "You already have a checkout in progress for these dates");
    return {
      lines: [{ quantity: 1, unitAmount: plan.priceAmount, name: plan.name, termStartsAt: plan.startsAt, termEndsAt: plan.endsAt, membershipProductId: plan.id }]
    };
  },

  async lock(tx, order) {
    if (order.userId) await lockMemberAndSociety(tx, order.userId, order.organisationId);
    else await tx.$queryRaw`SELECT "id" FROM "Organisation" WHERE "id" = ${order.organisationId} FOR UPDATE`;
  },

  // Under the member, society and order locks, after payment is verified (or
  // for a free total, in checkout's transaction): one grant for the line,
  // unless the member meanwhile got a membership for overlapping dates.
  async fulfil(tx, order: CommerceOrderForHooks, now) {
    if (!order.userId) return { fulfilled: false, reason: "buyer_missing" };
    const line = await tx.commerceOrderLine.findFirst({
      where: { orderId: order.id, kind: "membership" },
      include: { membershipProduct: { select: { name: true, entitlements: true, entitlementVersion: true } }, membershipGrant: { select: { id: true } } }
    });
    if (!line?.membershipProduct || !line.termStartsAt || !line.termEndsAt) return { fulfilled: false, reason: "plan_missing" };
    if (line.membershipGrant) return { fulfilled: true };
    const term = { startsAt: line.termStartsAt, endsAt: line.termEndsAt };
    if (await overlappingGrant(tx, order.userId, order.organisationId, term)) return { fulfilled: false, reason: "term_overlap" };

    const grant = await tx.membershipGrant.create({
      data: {
        userId: order.userId,
        organisationId: order.organisationId,
        membershipProductId: line.membershipProductId as string,
        commerceOrderLineId: line.id,
        ...term,
        entitlements: line.membershipProduct.entitlements,
        entitlementVersion: line.membershipProduct.entitlementVersion,
        grantedAt: now
      }
    });
    const purchase = await tx.commerceOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { buyerEmailSnapshot: true, sellerName: true, organisation: { select: { timeZone: true } } }
    });
    const { timeZone } = purchase.organisation;
    const lastDay = formatDate(new Date(term.endsAt.getTime() - 1), timeZone);
    const starts = term.startsAt > now ? ` It starts on ${formatDate(term.startsAt, timeZone)}.` : "";
    await enqueueNotification(tx, {
      eventKey: `membership-receipt/${grant.id}`,
      recipient: purchase.buyerEmailSnapshot,
      template: "business_notice",
      organisationId: order.organisationId,
      payload: {
        message: `Your ${line.membershipProduct.name} membership with ${purchase.sellerName} is confirmed. It runs from ${formatDate(term.startsAt, timeZone)} to ${lastDay}, ${zoneCity(timeZone)}.${starts} Memberships don't renew automatically.`
      }
    });
    return { fulfilled: true };
  },

  // Memberships hold no stock, so a failed or expired order has nothing to release.
  async release() {}
};
