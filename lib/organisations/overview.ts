import { prisma } from "@/lib/db";
import { ticketAttendance } from "@/lib/analytics/metrics";
import { addDays } from "@/lib/analytics/range";
import { readCalendar } from "@/lib/events/calendar";
import { buyerIdentitySelect, retainedBuyerIdentity } from "@/lib/orders/buyer-identity";
import { hasOrganisationPermission, type OrganisationPermission, type OrganisationStaffRole } from "@/lib/permissions";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import { toZonedInput } from "@/lib/zoned-time";

// Reads for the society Overview (T34, design round C1). Each part is read
// only for a role that may see it and act on it; the rest stay null, so a
// page never receives money, orders or members it would have to hide.

const day = 86_400_000;
export const membershipEndingWindowMs = 7 * day;
export const draftSoonWindowMs = 7 * day;

export async function getOrganisationOverview(organisationId: string, staffRole: OrganisationStaffRole, now = new Date()) {
  const can = (permission: OrganisationPermission) => hasOrganisationPermission(staffRole, permission);
  const ownedOrder = { event: { is: { organisationId } } };
  const unsettled = { refundStatus: null, cancelledAt: null };
  const [setup, eventCount, reviews, pickups, ending, failedEmails, drafts, ticketOrders, commerceOrders, membersNow] = await Promise.all([
    prisma.organisation.findUnique({ where: { id: organisationId }, select: { onboardingCompletedAt: true, stripeAccountId: true, stripeChargesEnabled: true } }),
    prisma.event.count({ where: { organisationId } }),
    can("orders:read")
      ? Promise.all([
          prisma.order.count({ where: { ...ownedOrder, requiresCompensationReview: true } }),
          prisma.commerceOrder.count({ where: { organisationId, requiresCompensationReview: true } })
        ]).then(([tickets, commerce]) => tickets + commerce)
      : null,
    can("merchandise:fulfil")
      ? Promise.all([
          prisma.commerceOrder.aggregate({ where: { organisationId, kind: "merchandise", status: "paid", pickupStatus: "pending", requiresCompensationReview: false, ...unsettled }, _count: { _all: true }, _min: { fulfilledAt: true } }),
          prisma.commerceOrder.count({ where: { organisationId, kind: "merchandise", status: "paid", pickupStatus: "ready", ...unsettled } })
        ]).then(([preparing, ready]) => ({ preparing: preparing._count._all, oldest: preparing._min.fulfilledAt, ready }))
      : null,
    can("members:read")
      ? Promise.all([
          prisma.membershipGrant.count({ where: { organisationId, revokedAt: null, endsAt: { gt: now, lte: new Date(now.getTime() + membershipEndingWindowMs) } } }),
          // A plan members could move to: published and not over yet.
          prisma.membershipProduct.count({ where: { organisationId, status: "published", endsAt: { gt: new Date(now.getTime() + membershipEndingWindowMs) } } })
        ]).then(([count, nextPlans]) => ({ count, nextOnSale: nextPlans > 0 }))
      : null,
    can("orders:email_resend") ? prisma.notificationOutbox.count({ where: { organisationId, privacy: "business", status: "failed" } }) : null,
    can("events:manage")
      ? (() => {
          const where = { organisationId, status: "draft" as const, startTime: { gt: now, lte: new Date(now.getTime() + draftSoonWindowMs) } };
          // The three soonest, and how many there are, so the rest are a link away (UI-025).
          return Promise.all([
            prisma.event.findMany({ where, orderBy: [{ startTime: "asc" }, { id: "asc" }], take: 3, select: { id: true, title: true, startTime: true } }),
            prisma.event.count({ where })
          ]).then(([rows, count]) => ({ rows, count }));
        })()
      : { rows: [], count: 0 },
    can("orders:read")
      ? prisma.order.findMany({
          // Abandoned and failed checkouts stay on Orders, not in this summary.
          where: { ...ownedOrder, status: { notIn: ["expired", "failed"] } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true, status: true, paymentKind: true, requiresCompensationReview: true, refundStatus: true, disputeStatus: true,
            externalRefundedAmount: true, externalRefundReviewedAt: true, cancelledAt: true, isManuallyRefunded: true, quantity: true, totalAmount: true,
            createdAt: true, paidAt: true, event: { select: { title: true } }, ...buyerIdentitySelect,
            user: { select: { email: true, firstName: true, lastName: true, displayName: true } }
          }
        })
      : [],
    can("orders:read")
      ? prisma.commerceOrder.findMany({
          // Checkouts still waiting on Stripe, abandoned or failed are left out.
          where: { organisationId, status: { notIn: ["pending", "expired", "failed"] } },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true, kind: true, status: true, paymentKind: true, requiresCompensationReview: true, refundStatus: true, disputeStatus: true, externalRefundedAmount: true, externalRefundReviewedAt: true, cancelledAt: true,
            totalAmount: true, createdAt: true, buyerNameSnapshot: true, buyerEmailSnapshot: true,
            lines: { orderBy: { lineNumber: "asc" }, select: { nameSnapshot: true, quantity: true, membershipGrant: { select: { id: true } } } }
          }
        })
      : [],
    can("members:read")
      ? prisma.membershipGrant.findMany({ where: { organisationId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, distinct: ["userId"], select: { userId: true } }).then((rows) => rows.length)
      : null
  ]);

  const buyerName = (buyer: { email: string; firstName?: string | null; lastName?: string | null; displayName?: string | null } | null) =>
    buyer ? buyer.displayName || [buyer.firstName, buyer.lastName].filter(Boolean).join(" ") || buyer.email : "Guest";
  const recentOrders = [
    ...ticketOrders.map((order) => ({ family: "ticket" as const, order, buyer: buyerName(retainedBuyerIdentity(order)), createdAt: order.createdAt })),
    ...commerceOrders.map((order) => ({ family: order.kind, order, buyer: order.buyerNameSnapshot || order.buyerEmailSnapshot || "Guest", createdAt: order.createdAt }))
  ]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5);

  return {
    profileComplete: !!setup?.onboardingCompletedAt,
    chargesReady: !!setup && isOrganisationStripeReady(setup),
    hasEvents: eventCount > 0,
    reviews,
    pickups,
    ending,
    failedEmails,
    drafts: drafts.rows,
    draftsSoon: drafts.count,
    recentOrders,
    membersNow
  };
}

export type RecentOrder = Awaited<ReturnType<typeof getOrganisationOverview>>["recentOrders"][number];

// Check-in staff land on today's door (design round C1): published events on
// today in the society's zone with their valid and checked-in tickets, then
// the rest of the next seven days.
export async function getDoorDay(organisationId: string, timeZone: string, now = new Date()) {
  const today = toZonedInput(now, timeZone).slice(0, 10);
  const { events } = await readCalendar(organisationId, "check_in_staff", { from: today, to: addDays(today, 6) }, timeZone);
  const localDay = (date: Date) => toZonedInput(date, timeZone).slice(0, 10);
  const onToday = events.filter((event) => localDay(event.startTime) <= today && localDay(new Date(event.endTime.getTime() - 1)) >= today);
  const todayEvents = await Promise.all(onToday.map(async (event) => ({ ...event, attendance: await ticketAttendance(organisationId, { eventId: event.id }) })));
  return { today, todayEvents, later: events.filter((event) => localDay(event.startTime) > today) };
}

// Published public events still to come, per society, for the personal Overview.
export async function upcomingEventCounts(organisationIds: string[], now = new Date()) {
  const rows = organisationIds.length
    ? await prisma.event.groupBy({ by: ["organisationId"], where: { organisationId: { in: organisationIds }, status: "published", visibility: "public", cancelledAt: null, startTime: { gt: now } }, _count: { _all: true } })
    : [];
  return new Map(rows.map((row) => [row.organisationId, row._count._all]));
}
