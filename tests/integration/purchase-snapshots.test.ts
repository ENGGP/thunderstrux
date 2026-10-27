import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { loadTicketDeliveryOrder, renderTicketEmail } from "@/lib/email/ticket-delivery";
import { ticketReference } from "@/lib/format";
import { getGroupedOrganisationOrdersWithContext } from "@/lib/orders/grouped-orders";
import { getWalletTickets } from "@/lib/purchases/ticket-purchases";
import { getOrganisationOrderDetail } from "@/lib/orders/order-detail";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { buyerPurchaseBadge, justIssued, purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { calculatePlatformFee, PLATFORM_FEE_POLICY_VERSION } from "@/lib/stripe/fees";
import {
  checkInOrganisationTicket,
  getOrganisationEventTickets,
  TicketNotValidError
} from "@/lib/tickets/check-in";
import { setMockSession } from "@/tests/helpers/auth";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  unique
} from "@/tests/helpers/test-data";

const stripeMocks = vi.hoisted(() => ({ createSession: vi.fn() }));

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripe: () => ({ checkout: { sessions: { create: stripeMocks.createSession } } })
  };
});


// A real purchase through checkout and the webhook: 2 x $19.99 makes the fee round (399.8 -> 400).
async function buyTwoEarlyBirdTickets() {
  const owner = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember();
  const event = await createEvent({
    organisationId: owner.organisation.id,
    status: "published",
    ticketTypes: [{ name: "Early bird", price: 1999, quantity: 10 }]
  });
  const ticketType = event.ticketTypes[0];
  const sessionId = `cs_${ticketType.id}`;
  stripeMocks.createSession.mockResolvedValueOnce({ id: sessionId, url: "https://checkout.stripe.test/session" });

  await createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 2, expectedUnitPrice: ticketType.price, idempotencyKey: unique("checkout") });
  const order = await prisma.order.findFirstOrThrow({ where: { eventId: event.id } });
  const session = checkoutSession({
    id: sessionId,
    orderId: order.id,
    eventId: event.id,
    organisationId: owner.organisation.id,
    ticketTypeId: ticketType.id,
    quantity: 2,
    amountTotal: 3998
  });

  return { owner, member, event, ticketType, order, session };
}

describe("purchase snapshots and ticket validity", () => {
  test("checkout records what was bought and fulfilment numbers each ticket once", async () => {
    const { owner, member, order, session } = await buyTwoEarlyBirdTickets();

    expect(order).toMatchObject({
      status: "pending",
      paymentKind: "stripe",
      purchasedTicketTypeName: "Early bird",
      sellerName: owner.organisation.name,
      sellerStripeAccountId: owner.organisation.stripeAccountId,
      currency: "aud",
      totalAmount: 3998,
      // Two tickets: 3.75% of $39.98 rounded once, plus $0.89 each.
      feeAmount: 328,
      feePolicyVersion: PLATFORM_FEE_POLICY_VERSION,
      snapshotVersion: 1,
      buyerEmailSnapshot: member.email,
      buyerFirstNameSnapshot: "Test",
      buyerIdentityProvenance: "purchase",
      fulfilledAt: null
    });
    expect(order.feeAmount).toBe(calculatePlatformFee(3998, 2));
    expect(stripeMocks.createSession.mock.calls.at(-1)?.[0].payment_intent_data.application_fee_amount).toBe(order.feeAmount);

    await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: "evt_snap" })).resolves.toEqual({
      status: "fulfilled",
      orderId: order.id
    });
    await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: "evt_snap_replay" })).resolves.toEqual({
      status: "already_paid",
      orderId: order.id
    });

    const fulfilled = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { tickets: { orderBy: { issueSequence: "asc" } } }
    });
    expect(fulfilled.status).toBe("paid");
    expect(fulfilled.fulfilledAt).toEqual(fulfilled.paidAt);
    expect(fulfilled.tickets.map((ticket) => [ticket.issueSequence, ticket.validity])).toEqual([
      [1, "active"],
      [2, "active"]
    ]);
  });

  test("renaming or repricing later never changes the purchase in organiser, member or email views", async () => {
    const { owner, member, event, ticketType, order, session } = await buyTwoEarlyBirdTickets();
    await reconcileCompletedCheckoutSession(session);
    await prisma.ticketType.update({ where: { id: ticketType.id }, data: { name: "Renamed", price: 5000 } });
    await prisma.organisation.update({ where: { id: owner.organisation.id }, data: { name: "Renamed society" } });
    await prisma.user.update({ where: { id: member.id }, data: { firstName: "Changed" } });
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });

    const listed = await getGroupedOrganisationOrdersWithContext(owner.organisation.id);
    expect(listed.groups[0].orders[0]).toMatchObject({ ticketType: "Early bird", projection: "paid", totalAmount: 3998 });

    const detail = await getOrganisationOrderDetail(owner.organisation.id, order.id);
    expect(detail).toMatchObject({ purchasedTicketType: "Early bird", unitPrice: 1999, buyerIdentityProvenance: "purchase" });
    expect(detail.user).toMatchObject({ email: member.email, firstName: "Test" });

    const wallet = await getWalletTickets(member.id, "upcoming");
    expect(wallet.tickets[0].order.purchasedTicketTypeName).toBe("Early bird");

    const mail = renderTicketEmail(await loadTicketDeliveryOrder(order.id));
    expect(mail.text).toContain("Ticket: Early bird");
    expect(mail.text).toContain(`Organiser: ${owner.organisation.name}`);
    expect(mail.text).toContain("Hi Test Member,");

    const door = await getOrganisationEventTickets(owner.organisation.id, event.id);
    expect(door.tickets.map((ticket) => ticket.ticketTypeName)).toEqual(["Early bird", "Early bird"]);
  });

  test("orders from before snapshots show today's name and say the original is unknown", async () => {
    const owner = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const legacy = await createOrder({
      organisationId: owner.organisation.id,
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: 1200
    });
    await prisma.ticket.create({
      data: { issueSequence: 1, orderId: legacy.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: owner.organisation.id }
    });
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    const label = "General (historical label unavailable)";

    expect((await getGroupedOrganisationOrdersWithContext(owner.organisation.id)).groups[0].orders[0].ticketType).toBe(label);
    expect((await getOrganisationOrderDetail(owner.organisation.id, legacy.id)).purchasedTicketType).toBe(label);
    expect(renderTicketEmail(await loadTicketDeliveryOrder(legacy.id)).text).toContain(`Ticket: ${label}`);
    expect((await getOrganisationEventTickets(owner.organisation.id, event.id)).tickets[0].ticketTypeName).toBe(label);
    const walletTicket = (await getWalletTickets(member.id, "upcoming")).tickets[0];
    expect(purchasedTicketTypeLabel(walletTicket.order.purchasedTicketTypeName, walletTicket.ticketType.name)).toBe(label);
    // The unknown name is never written back.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } })).purchasedTicketTypeName).toBeNull();
  });

  test("void and under-review tickets move to Not valid and leave the email, the door list and check-in", async () => {
    const owner = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const ticketTypeId = event.ticketTypes[0].id;
    const order = await createOrder({
      organisationId: owner.organisation.id,
      eventId: event.id,
      ticketTypeId,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      quantity: 3,
      unitPrice: 1200
    });
    const units = [];
    for (const issueSequence of [1, 2, 3]) {
      units.push(await prisma.ticket.create({
        data: { issueSequence, orderId: order.id, eventId: event.id, ticketTypeId, organisationId: owner.organisation.id }
      }));
    }
    const [valid, voided, review] = units;
    const changedAt = new Date();
    await prisma.ticket.update({ where: { id: voided.id }, data: { validity: "void", validityReason: "refunded", validityChangedAt: changedAt } });
    await prisma.ticket.update({ where: { id: review.id }, data: { validity: "refund_review", validityReason: "dispute", validityChangedAt: changedAt } });
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });

    expect((await getWalletTickets(member.id, "upcoming")).tickets.map((ticket) => ticket.id)).toEqual([valid.id]);
    expect((await getWalletTickets(member.id, "not-valid")).tickets.map((ticket) => ticket.id).sort()).toEqual([voided.id, review.id].sort());
    const mail = renderTicketEmail(await loadTicketDeliveryOrder(order.id)).text;
    // The email names tickets by the same short reference as the wallet and the door.
    expect(mail).toContain(ticketReference(valid.id));
    expect(mail).not.toContain(ticketReference(voided.id));
    expect(mail).not.toContain(ticketReference(review.id));
    expect(mail).not.toContain("MVP");

    const door = await getOrganisationEventTickets(owner.organisation.id, event.id);
    expect(door.tickets.map((ticket) => ticket.id)).toEqual([valid.id]);
    expect(door.counts).toEqual({ total: 1, unused: 1, checkedIn: 0 });
    await expect(checkInOrganisationTicket(owner.organisation.id, voided.id, owner.user.id)).rejects.toMatchObject({ validity: "void", validityReason: "refunded" });
    await expect(checkInOrganisationTicket(owner.organisation.id, review.id, owner.user.id)).rejects.toBeInstanceOf(TicketNotValidError);
    await expect(checkInOrganisationTicket(owner.organisation.id, valid.id, owner.user.id)).resolves.toMatchObject({ status: "checked-in" });
  });

  test("only tickets issued in the last two minutes get the arrival entrance", () => {
    const now = Date.parse("2026-10-27T10:00:00Z");
    expect(justIssued(null, now)).toBe(false);
    expect(justIssued(new Date(now - 30_000), now)).toBe(true);
    expect(justIssued(new Date(now - 119_999), now)).toBe(true);
    expect(justIssued(new Date(now - 120_000), now)).toBe(false);
    expect(justIssued(new Date(now - 180_000), now)).toBe(false);
  });

  test("one status per order, by the UX spec's precedence, and buyers read each in their own words", async () => {
    // UX spec 9.6: cancellation, dispute and refund outrank review, which outranks fulfilment; failed and expired come last.
    const paid = { status: "paid", paymentKind: "stripe", requiresCompensationReview: false } as const;
    const at = new Date();
    const rows: Array<[string, Parameters<typeof ticketOrderProjection>[0], string, string | undefined]> = [
      ["cancelled outranks a dispute and a refund", { ...paid, paymentKind: "free", cancelledAt: at, disputeStatus: "open", refundStatus: "refunded" }, "cancelled", "Cancelled by the society"],
      ["a dispute outranks a refund and review", { ...paid, disputeStatus: "lost", refundStatus: "refunded", requiresCompensationReview: true }, "disputed", undefined],
      ["refunded outranks review", { ...paid, refundStatus: "refunded", externalRefundedAmount: 500 }, "refunded", undefined],
      ["a refund in progress outranks review", { ...paid, refundStatus: "processing", externalRefundedAmount: 500 }, "refund-processing", undefined],
      ["a charge that couldn't be fulfilled", { ...paid, status: "failed", requiresCompensationReview: true }, "review", "Payment issue"],
      ["a partial refund made in Stripe, until reviewed", { ...paid, externalRefundedAmount: 500 }, "review", "Partly refunded"],
      ["a reviewed partial refund", { ...paid, externalRefundedAmount: 500, externalRefundReviewedAt: at }, "paid", undefined],
      ["waiting for Stripe", { ...paid, status: "pending" }, "processing", "Waiting for payment"],
      ["paid", paid, "paid", undefined],
      ["free, though stored as paid", { ...paid, paymentKind: "free" }, "free", undefined],
      ["failed", { ...paid, status: "failed" }, "failed", "Didn't complete"],
      ["expired", { ...paid, status: "expired" }, "expired", "Didn't complete"]
    ];
    for (const [why, order, projection, label] of rows) {
      expect(ticketOrderProjection(order), why).toBe(projection);
      expect(buyerPurchaseBadge(order).label, why).toBe(label);
    }

    const owner = await createOrganisationAccount();
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    await createOrder({
      organisationId: owner.organisation.id,
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: 0,
      paymentKind: "free"
    });
    const listed = await getGroupedOrganisationOrdersWithContext(owner.organisation.id);
    expect(listed.groups[0].orders[0]).toMatchObject({ projection: "free", totalAmount: 0 });
  });

  test("the ticket email gives the time in the society's zone and words a free registration as one (DEF-047, DEF-050)", async () => {
    const { organisation } = await createOrganisationAccount();
    await prisma.organisation.update({ where: { id: organisation.id }, data: { timeZone: "Australia/Perth" } });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    // 7:00 pm in Perth (UTC+8 all year) is 9:00 pm in Brisbane.
    await prisma.event.update({ where: { id: event.id }, data: { startTime: new Date("2027-03-05T11:00:00Z"), endTime: new Date("2027-03-05T14:00:00Z") } });
    const base = { organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid" as const, paidAt: new Date() };
    const paid = renderTicketEmail(await loadTicketDeliveryOrder((await createOrder(base)).id));
    const free = renderTicketEmail(await loadTicketDeliveryOrder((await createOrder({ ...base, paymentKind: "free", unitPrice: 0, stripeSessionId: null })).id));
    expect(paid.text).toMatch(/Date: .*5 March 2027.*7:00\spm/);
    expect(paid.text).not.toMatch(/9:00\spm/);
    expect(paid.text).toContain("Your payment is confirmed");
    expect(free.text).toContain("Your registration is confirmed");
    expect(free.text + free.html).not.toContain("payment");
  });

  test("the database refuses purchase facts that cannot be true", async () => {
    const owner = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const base = { organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: member.id };

    await expect(createOrder({ ...base, status: "paid", paidAt: new Date(), unitPrice: 1200, paymentKind: "free" })).rejects.toThrow();
    await expect(createOrder({ ...base, status: "pending", unitPrice: 1200, fulfilledAt: new Date() })).rejects.toThrow();

    const order = await createOrder({ ...base, status: "paid", paidAt: new Date(), unitPrice: 1200 });
    await expect(prisma.order.update({ where: { id: order.id }, data: { feeAmount: 1201 } })).rejects.toThrow();
    await expect(prisma.order.update({ where: { id: order.id }, data: { feeAmount: -1 } })).rejects.toThrow();

    const unit = { orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: owner.organisation.id };
    await prisma.ticket.create({ data: { ...unit, issueSequence: 1 } });
    await expect(prisma.ticket.create({ data: { ...unit, issueSequence: 1 } })).rejects.toThrow();
    await expect(prisma.ticket.create({ data: { ...unit, issueSequence: 0 } })).rejects.toThrow();

    await expect(prisma.order.update({
      where: { id: order.id },
      data: { buyerEmailSnapshot: member.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "typed_in_browser" }
    })).rejects.toThrow();
    await prisma.order.update({
      where: { id: order.id },
      data: { buyerEmailSnapshot: member.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" }
    });
    // A purchase-time capture is as immutable as one taken at account closure.
    await expect(prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: "other@example.com" } })).rejects.toThrow();
  });
});
