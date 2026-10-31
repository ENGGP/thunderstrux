import { renderPage } from "@/tests/helpers/render";
import { describe, expect, test, vi } from "vitest";
import { setMockSession } from "@/tests/helpers/auth";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import OrganisationOrderDetailPage from "@/app/(dashboard)/dashboard/orders/[orderId]/page";
import OrganisationOrdersPage from "@/app/(dashboard)/dashboard/orders/page";
import { prisma } from "@/lib/db";

vi.mock("next/navigation", async importOriginal => ({
  ...await importOriginal<typeof import("next/navigation")>(),
  usePathname: () => "/dashboard/orders",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

async function renderOrdersPage(
  searchParams: {
    status?: string;
    eventId?: string;
    includeSystem?: string;
    search?: string;
    startDate?: string;
    endDate?: string;
    limit?: string;
    cursor?: string;
    direction?: string;
  } = {}
) {
  const element = await OrganisationOrdersPage({
    searchParams: Promise.resolve(searchParams)
  });

  return renderPage(element);
}

describe("dashboard orders page", () => {
  // PAY-047: a checkout that didn't complete took no money.
  test("the order page offers Mark as refunded on a paid order, not on an expired one", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const order = (status: "paid" | "expired") => createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status, paidAt: status === "paid" ? new Date() : null });
    const detail = async (orderId: string) => renderPage(await OrganisationOrderDetailPage({ params: Promise.resolve({ orderId }), searchParams: Promise.resolve({}) }));
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect(await detail((await order("paid")).id)).toContain("Mark as refunded");
    const expired = await detail((await order("expired")).id);
    expect(expired).toContain("Manage this order");
    expect(expired).not.toContain("Mark as refunded");

    // PAY-049: a queued refund that closed because Stripe had already refunded it isn't a failure, and the tickets may be void by now.
    const closed = await order("paid");
    await prisma.refundRequest.create({ data: { orderId: closed.id, organisationId: organisation.id, amount: closed.totalAmount, reason: "Event cancelled: storm", operationKey: closed.id, status: "failed", lastErrorCode: "refunded_elsewhere", resolvedAt: new Date() } });
    const closedPage = await detail(closed.id);
    expect(closedPage).toContain("Already refunded in Stripe");
    expect(closedPage).not.toContain("The tickets are still valid");
  });

  // PAY-056: a compensation order has no tickets, so a won dispute leaves nothing to restore.
  test("a won dispute offers Restore tickets only on an order that has tickets", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const order = (status: "paid" | "failed") => createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status, paidAt: new Date() });
    const dispute = (orderId: string) => prisma.$transaction([
      prisma.order.update({ where: { id: orderId }, data: { disputeStatus: "won" } }),
      prisma.purchaseDispute.create({ data: { orderId, organisationId: organisation.id, stripeDisputeId: `dp_${orderId}`, stripeChargeId: `ch_${orderId}`, amount: 1200, currency: "aud", reason: "fraudulent", providerStatus: "won", closedAt: new Date() } })
    ]);
    const detail = async (orderId: string) => renderPage(await OrganisationOrderDetailPage({ params: Promise.resolve({ orderId }), searchParams: Promise.resolve({}) }));
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const sold = await order("paid");
    await dispute(sold.id);
    expect(await detail(sold.id)).toContain("Restore tickets");

    // An older order whose fulfilment recovered has tickets, whatever its job says.
    const recovered = await order("paid");
    await prisma.compensationRefundJob.create({ data: { orderId: recovered.id, state: "recovered", amount: recovered.totalAmount } });
    await dispute(recovered.id);
    expect(await detail(recovered.id)).toContain("Restore tickets");

    const unfilled = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "failed", paidAt: new Date(), failedAt: new Date(), requiresCompensationReview: true, fulfilmentFailedAt: new Date(), fulfilmentFailureReason: "sold_out" });
    await prisma.compensationRefundJob.create({ data: { orderId: unfilled.id, state: "auto_queued", amount: unfilled.totalAmount } });
    await dispute(unfilled.id);
    const page = await detail(unfilled.id);
    expect(page).toContain("the dispute no longer holds its refund");
    expect(page).not.toContain("Restore tickets");
  });

  // PAY-057: staff read how a closed review ended, and a compensation order has no tickets.
  test("a review the money closed says how, without tickets it never had", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const closed = async (data: { disputeStatus?: "lost"; refundStatus?: "refunded" }) => {
      const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "failed", paidAt: new Date(), failedAt: new Date() });
      await prisma.order.update({ where: { id: order.id }, data: { ...data, externalRefundedAmount: data.refundStatus ? order.totalAmount : 0 } });
      await prisma.compensationRefundJob.create({ data: { orderId: order.id, state: "refunded", amount: order.totalAmount } });
      if (data.disputeStatus) await prisma.purchaseDispute.create({ data: { orderId: order.id, organisationId: organisation.id, stripeDisputeId: `dp_${order.id}`, stripeChargeId: `ch_${order.id}`, amount: order.totalAmount, currency: "aud", reason: "fraudulent", providerStatus: "lost", closedAt: new Date() } });
      return renderPage(await OrganisationOrderDetailPage({ params: Promise.resolve({ orderId: order.id }), searchParams: Promise.resolve({}) }));
    };
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const lost = await closed({ disputeStatus: "lost" });
    expect(lost).toContain("The buyer won the dispute");
    expect(lost).toContain("No tickets were issued");
    expect(lost).not.toContain("no longer valid");
    expect(lost).not.toContain("Payment received, tickets not issued");
    const refunded = await closed({ refundStatus: "refunded" });
    expect(refunded).toContain("Fully refunded in Stripe");
    expect(refunded).toContain("No tickets were issued");
    expect(refunded).not.toContain("no longer valid");
  });

  test("ticket order times show in the society's zone, the zone its date filters use", async () => {
    const { user, organisation } = await createOrganisationAccount();
    await prisma.organisation.update({ where: { id: organisation.id }, data: { timeZone: "Australia/Perth" } });
    const event = await createEvent({ organisationId: organisation.id });
    // 11:30 pm on 4 March in Perth is 1:30 am on 5 March in Brisbane.
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(), createdAt: new Date("2027-03-04T15:30:00.000Z") });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await renderOrdersPage({ startDate: "2027-03-04", endDate: "2027-03-04" });
    expect(html).toMatch(/4 Mar 2027.{0,20}11:30/);
    expect(html).not.toMatch(/5 Mar 2027/);
  });

  test("malformed cursor falls back to first page with warning", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];

    for (let index = 0; index < 27; index += 1) {
      await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "paid",
        paidAt: new Date(),
        unitPrice: ticketType.price,
        createdAt: new Date(`2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`)
      });
    }

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await renderOrdersPage({
      cursor: "bad-cursor"
    });

    expect(html).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(html).toContain("Order pagination");
    expect(html).toContain("direction=next");
    expect(html).not.toContain("bad-cursor");
  });

  test("failed filter shows compensation-required failed orders", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      paidAt: new Date(),
      failedAt: new Date(),
      failureReason: "inventory_unavailable_after_payment",
      requiresCompensationReview: true,
      fulfilmentFailedAt: new Date(),
      fulfilmentFailureReason: "inventory_unavailable_after_payment",
      unitPrice: ticketType.price
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await renderOrdersPage({
      status: "failed"
    });

    expect(html).toContain("Payment received; fulfilment review required");
  });
});
