import { describe, expect, test, vi } from "vitest";
import OrganiserEventPage from "@/app/(dashboard)/dashboard/events/[eventId]/page";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { engagementMetrics, membershipMetrics, merchandiseMetrics, societySales, ticketAttendance, ticketMetrics } from "@/lib/analytics/metrics";
import { AnalyticsRangeError, analyticsRange, bucketStarts } from "@/lib/analytics/range";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createMembershipGrant, createOrder, createOrganisationAccount, createOrganisationStaff, joinOrganisation, unique } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/events",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

// T31: readiness plan §6 definitions, checked against facts placed on both
// sides of the boundaries that matter.

const sydney = "Australia/Sydney";
const finance = { financial: true };
const october = { from: "2026-10-01", to: "2026-10-31", bucket: "day" as const, timeZone: sydney };

async function ticketed() {
  const { organisation, user } = await createOrganisationAccount();
  const event = await createEvent({ organisationId: organisation.id, status: "published", ticketTypes: [{ name: "General", price: 1000, quantity: 50 }] });
  const ticketTypeId = event.ticketTypes[0].id;
  const sale = async (at: string, extra: Partial<Parameters<typeof createOrder>[0]> = {}, tickets = 2, validity: "active" | "void" = "active") => {
    const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, status: "paid", quantity: tickets, unitPrice: 1000, paidAt: new Date(at), createdAt: new Date(at), ...extra });
    await prisma.order.update({ where: { id: order.id }, data: { feeAmount: extra.paymentKind === "free" ? 0 : 100 } });
    for (let index = 1; index <= tickets; index += 1) {
      await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, ticketTypeId, organisationId: organisation.id, issueSequence: index, validity } });
    }
    return order;
  };
  return { organisation, user, event, ticketTypeId, sale };
}

describe("analytics ranges", () => {
  test("ranges are whole local days, at most 366, grouped by day, Monday week or month", () => {
    expect(analyticsRange({ to: "2026-10-31" }, sydney)).toEqual({ from: "2026-10-02", to: "2026-10-31", bucket: "day", timeZone: sydney });
    expect(() => analyticsRange({ from: "2026-01-01", to: "2027-01-02" }, sydney)).toThrow(AnalyticsRangeError);
    expect(analyticsRange({ from: "2026-01-01", to: "2027-01-01" }, sydney).to).toBe("2027-01-01");
    for (const bad of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-03-02", to: "2026-03-01" }, { from: "2026-03-01", to: "2026-03-02", bucket: "hour" }]) {
      expect(() => analyticsRange(bad, sydney)).toThrow(AnalyticsRangeError);
    }
    expect(bucketStarts({ from: "2026-10-01", to: "2026-10-14", bucket: "week", timeZone: sydney })).toEqual(["2026-09-28", "2026-10-05", "2026-10-12"]);
    expect(bucketStarts({ from: "2026-01-31", to: "2026-03-01", bucket: "month", timeZone: sydney })).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });
});

describe("ticket metrics", () => {
  test("gross, refunds, net and fees count only fulfilled paid money, by local day across daylight saving, with zero fill", async () => {
    const { organisation, event, ticketTypeId, sale } = await ticketed();
    // 00:30 on 1 October in Sydney (AEST): October, not September.
    await sale("2026-09-30T14:30:00.000Z");
    // 23:30 on 3 October (AEST) and 03:30 on 4 October, after clocks went forward at 2am.
    await sale("2026-10-03T13:30:00.000Z");
    const refunded = await sale("2026-10-03T16:30:00.000Z");
    // 23:30 on 30 September in Sydney: September, outside the range.
    await sale("2026-09-30T13:30:00.000Z");
    // Not money: free, pending, failed, expired, payment review.
    await sale("2026-10-05T01:00:00.000Z", { paymentKind: "free", unitPrice: 0 }, 3);
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, status: "pending", unitPrice: 1000, createdAt: new Date("2026-10-05T01:00:00.000Z") });
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, status: "failed", unitPrice: 1000, failedAt: new Date("2026-10-05T01:00:00.000Z"), createdAt: new Date("2026-10-05T01:00:00.000Z") });
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, status: "expired", unitPrice: 1000, failedAt: new Date("2026-10-05T01:00:00.000Z"), createdAt: new Date("2026-10-05T01:00:00.000Z") });
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, status: "failed", unitPrice: 1000, failedAt: new Date("2026-10-05T01:00:00.000Z"), requiresCompensationReview: true, paidAt: new Date("2026-10-05T01:00:00.000Z"), createdAt: new Date("2026-10-05T01:00:00.000Z") });
    // Stripe confirmed the refund on 10 October; one still pending is not a refund.
    await prisma.ticket.updateMany({ where: { orderId: refunded.id }, data: { validity: "void", validityReason: "refunded" } });
    await prisma.refundRequest.create({ data: { orderId: refunded.id, organisationId: organisation.id, amount: 2000, reason: "Can't come.", operationKey: unique("refund"), status: "succeeded", resolvedAt: new Date("2026-10-10T02:00:00.000Z") } });
    const other = await sale("2026-10-06T01:00:00.000Z");
    await prisma.refundRequest.create({ data: { orderId: other.id, organisationId: organisation.id, amount: 2000, reason: "Not yet.", operationKey: unique("refund"), status: "pending" } });

    const { totals, series } = await ticketMetrics(organisation.id, october, finance);
    expect(series).toHaveLength(31);
    const day = (start: string) => series.find((bucket) => bucket.start === start);
    expect(day("2026-10-01")).toMatchObject({ gross: 2000, tickets: 2 });
    expect(day("2026-10-03")).toMatchObject({ gross: 2000 });
    expect(day("2026-10-04")).toMatchObject({ gross: 2000 });
    expect(day("2026-10-10")).toMatchObject({ gross: 0, refunded: 2000, net: -2000 });
    expect(day("2026-10-20")).toMatchObject({ gross: 0, refunded: 0, net: 0, orders: 0 });
    expect(totals).toMatchObject({
      gross: 8000, refunded: 2000, net: 6000, platformFees: 300,
      fulfilledOrders: 5, freeOrders: 1, refunds: 1,
      ticketsIssued: 11, ticketsValid: 9, ticketsFree: 3, ordersStarted: 9,
      ordersInReview: 1, ordersPending: 1, ordersAbandoned: 2
    });

    // A week bucket starts on Monday in the society's zone.
    const weeks = await ticketMetrics(organisation.id, { ...october, bucket: "week" }, finance);
    expect(weeks.series.map((bucket) => bucket.start)).toEqual(["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
    expect(weeks.series[0]).toMatchObject({ gross: 6000 });
    // Months: September holds the 23:30 sale only.
    const months = await ticketMetrics(organisation.id, { from: "2026-09-01", to: "2026-10-31", bucket: "month", timeZone: sydney }, finance);
    expect(months.series).toEqual([expect.objectContaining({ start: "2026-09-01", gross: 2000 }), expect.objectContaining({ start: "2026-10-01", gross: 8000 })]);
  });

  test("money is left out without finance access, and another society's facts never count", async () => {
    const { organisation, event, sale } = await ticketed();
    await sale("2026-10-02T01:00:00.000Z");
    const foreign = await ticketed();
    await foreign.sale("2026-10-02T01:00:00.000Z");
    const attendanceOnly = await ticketMetrics(organisation.id, october, { financial: false });
    expect(attendanceOnly.totals).toMatchObject({ gross: null, refunded: null, net: null, platformFees: null, ticketsIssued: 2 });
    expect(attendanceOnly.series.every((bucket) => bucket.gross === null && bucket.net === null)).toBe(true);
    expect(await societySales(organisation.id, october, { financial: false })).toBeNull();
    expect(await societySales(organisation.id, october, finance)).toEqual({ tickets: 2000, memberships: 0, merchandise: 0, total: 2000 });
    // An event filter never reaches into another society.
    expect((await ticketMetrics(foreign.organisation.id, october, finance, event.id)).totals.ticketsIssued).toBe(0);
  });

  test("a partial refund reverses its share of the fee, and a refund of an order never fulfilled is not a refund of sales (PAY-011)", async () => {
    const { organisation, sale } = await ticketed();
    const resolvedAt = new Date("2026-10-05T01:00:00.000Z");
    const refund = (orderId: string, amount: number) => prisma.refundRequest.create({ data: { orderId, organisationId: organisation.id, amount, reason: "Refund the rest.", operationKey: unique("refund"), status: "succeeded", resolvedAt } });
    // $20.00 with a $1.00 fee; "Refund the rest" after $15.00 went back in Stripe.
    await refund((await sale("2026-10-02T01:00:00.000Z")).id, 500);
    await refund((await sale("2026-10-03T01:00:00.000Z", { status: "expired", paidAt: null, fulfilledAt: null })).id, 2000);
    const metrics = await ticketMetrics(organisation.id, october, finance);
    expect(metrics.totals).toMatchObject({ gross: 2000, refunded: 500, net: 1500, platformFees: 75, refunds: 1 });
  });

  test("check-in rate is valid checked-in over valid issued, not applicable with none, and keeps refunded admissions apart", async () => {
    const { event, sale, organisation } = await ticketed();
    expect(await ticketAttendance(organisation.id, { eventId: event.id })).toEqual({ valid: 0, checkedIn: 0, checkInRate: null, checkedInNoLongerValid: 0 });
    const kept = await sale("2026-10-02T01:00:00.000Z", {}, 4);
    const refunded = await sale("2026-10-02T02:00:00.000Z", {}, 1, "void");
    await prisma.ticket.updateMany({ where: { orderId: kept.id, issueSequence: { lte: 3 } }, data: { checkedInAt: new Date() } });
    await prisma.ticket.updateMany({ where: { orderId: refunded.id }, data: { checkedInAt: new Date() } });
    expect(await ticketAttendance(organisation.id, { eventId: event.id })).toEqual({ valid: 4, checkedIn: 3, checkInRate: 0.75, checkedInNoLongerValid: 1 });
  });
});

describe("membership, merchandise and engagement metrics", () => {
  test("memberships, merchandise and joins are counted separately, without multiplying lines or confusing a join with a membership", async () => {
    const { organisation } = await createOrganisationAccount();
    const buyer = await createMember();
    const joiner = await createMember();
    await joinOrganisation(joiner.id, organisation.id);
    await joinOrganisation(buyer.id, organisation.id);
    const at = new Date("2026-10-08T01:00:00.000Z");

    // A free membership, then a renewal starting when it ends.
    const first = await createMembershipGrant(organisation.id, buyer.id, buyer.email, { startsAt: new Date("2026-01-01T00:00:00.000Z"), endsAt: new Date("2026-10-15T00:00:00.000Z"), grantedAt: new Date("2026-01-01T00:00:00.000Z") });
    await createMembershipGrant(organisation.id, buyer.id, buyer.email, { startsAt: first.endsAt, endsAt: new Date("2027-01-01T00:00:00.000Z"), grantedAt: at });
    const paidPlanOrder = await prisma.commerceOrderLine.findFirstOrThrow({ where: { membershipGrant: { id: first.id } } });
    await prisma.commerceOrder.update({ where: { id: paidPlanOrder.orderId }, data: { status: "paid", fulfilledAt: at, paidAt: at } });

    // One merchandise order with two lines of three items, and a refund of it.
    const now = new Date();
    const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Hoodie", status: "published", publishedAt: now, firstPublishedAt: now } });
    const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: unique("SKU").toUpperCase(), priceAmount: 2500, remaining: 9 } });
    const merch = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 250, source: "checkout",
      lines: [{ quantity: 2, unitAmount: 2500, name: "Hoodie", merchandiseVariantId: variant.id }, { quantity: 1, unitAmount: 0, name: "Sticker" }]
    }));
    await prisma.commerceOrder.update({ where: { id: merch.id }, data: { status: "paid", paidAt: at, fulfilledAt: at, stripeSessionId: unique("cs"), pickupStatus: "ready" } });
    await prisma.refundRequest.create({ data: { commerceOrderId: merch.id, organisationId: organisation.id, amount: 5000, reason: "Wrong size.", operationKey: unique("refund"), status: "succeeded", resolvedAt: at } });
    await prisma.commerceOrder.update({ where: { id: merch.id }, data: { refundStatus: "refunded" } });
    // PAY-011: a compensation refund of a payment that came too late was never a sale.
    const late = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 125, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 2500, name: "Hoodie" }]
    }));
    await prisma.commerceOrder.update({ where: { id: late.id }, data: { status: "expired", stripeSessionId: unique("cs") } });
    await prisma.refundRequest.create({ data: { commerceOrderId: late.id, organisationId: organisation.id, amount: 2500, reason: "Paid after expiry.", operationKey: unique("refund"), status: "succeeded", resolvedAt: at } });

    const memberships = await membershipMetrics(organisation.id, october, finance, new Date("2026-10-20T00:00:00.000Z"));
    expect(memberships.totals).toMatchObject({ granted: 1, renewals: 1, activeMembers: 1, fulfilledOrders: 1, freeOrders: 1, gross: 0 });
    const merchandise = await merchandiseMetrics(organisation.id, october, finance);
    expect(merchandise.totals).toMatchObject({
      gross: 5000, refunded: 5000, net: 0, platformFees: 0, itemsSold: 3, fulfilledOrders: 1,
      pickups: { preparing: 0, ready: 0, collected: 0 }, stock: { remaining: 9, held: 0 }
    });

    const engagement = await engagementMetrics(organisation.id, october, new Date("2026-10-20T00:00:00.000Z"));
    // Joins are counted by when they happened (today), not in October 2026.
    expect(engagement.totals).toMatchObject({ joinedNow: 2, buyers: { total: 1, joined: 1, members: 1 }, attendees: { total: 0 } });
    const joinedToday = await engagementMetrics(organisation.id, analyticsRange({}, sydney));
    expect(joinedToday.totals.joins).toBe(2);
  });
});

describe("the event Summary", () => {
  test("shows net sales and check-ins to the owner, and check-ins without money to an event manager", async () => {
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
    const { organisation, user, event, sale } = await ticketed();
    const order = await sale("2026-10-02T01:00:00.000Z", {}, 2);
    await prisma.ticket.updateMany({ where: { orderId: order.id, issueSequence: 1 }, data: { checkedInAt: new Date() } });
    const render = async () => renderPage(await OrganiserEventPage({ params: Promise.resolve({ eventId: event.id }) }));

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const owner = await render();
    expect(owner).toContain("Net sales");
    expect(owner).toContain("1 of 2");
    expect(owner).toContain("50% of valid tickets");

    const manager = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: manager.id, role: "event_manager" });
    setMockSession({ userId: manager.id, email: manager.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: organisation.id });
    const attendance = await render();
    expect(attendance).toContain("Checked in");
    expect(attendance).not.toContain("Net sales");
    expect(attendance).not.toContain("$20.00");
  });
});
