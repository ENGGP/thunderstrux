import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { loadTicketDeliveryOrder, renderTicketEmail } from "@/lib/email/ticket-delivery";
import { getGroupedOrganisationOrdersWithContext } from "@/lib/orders/grouped-orders";
import { getMemberTicketOrders } from "@/lib/orders/member-tickets";
import { getOrganisationOrderDetail } from "@/lib/orders/order-detail";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { purchasedTicketTypeLabel, ticketOrderProjection } from "@/lib/purchases/projection";
import { calculatePlatformFee, PLATFORM_FEE_POLICY_VERSION } from "@/lib/stripe/fees";
import {
  checkInOrganisationTicket,
  getOrganisationEventTickets,
  OrganisationTicketAccessError
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
    getStripe: () => ({ checkout: { sessions: { create: stripeMocks.createSession } } })
  };
});

const page = { limit: 25, direction: "next" as const };

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
      feeAmount: 400,
      feePolicyVersion: PLATFORM_FEE_POLICY_VERSION,
      snapshotVersion: 1,
      buyerEmailSnapshot: member.email,
      buyerFirstNameSnapshot: "Test",
      buyerIdentityProvenance: "purchase",
      fulfilledAt: null
    });
    expect(order.feeAmount).toBe(calculatePlatformFee(3998));
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

    const wallet = await getMemberTicketOrders(member.id, page);
    expect(wallet.items[0].purchasedTicketTypeName).toBe("Early bird");

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
    const walletOrder = (await getMemberTicketOrders(member.id, page)).items[0];
    expect(purchasedTicketTypeLabel(walletOrder.purchasedTicketTypeName, walletOrder.ticketType.name)).toBe(label);
    // The unknown name is never written back.
    expect((await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } })).purchasedTicketTypeName).toBeNull();
  });

  test("void and under-review tickets leave the wallet, the email, the door list and check-in", async () => {
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

    expect((await getMemberTicketOrders(member.id, page)).items[0].tickets.map((ticket) => ticket.id)).toEqual([valid.id]);
    const mail = renderTicketEmail(await loadTicketDeliveryOrder(order.id)).text;
    expect(mail).toContain(valid.id);
    expect(mail).not.toContain(voided.id);
    expect(mail).not.toContain(review.id);

    const door = await getOrganisationEventTickets(owner.organisation.id, event.id);
    expect(door.tickets.map((ticket) => ticket.id)).toEqual([valid.id]);
    expect(door.counts).toEqual({ total: 1, unused: 1, checkedIn: 0 });
    await expect(checkInOrganisationTicket(owner.organisation.id, voided.id, owner.user.id)).rejects.toBeInstanceOf(OrganisationTicketAccessError);
    await expect(checkInOrganisationTicket(owner.organisation.id, review.id, owner.user.id)).rejects.toBeInstanceOf(OrganisationTicketAccessError);
    await expect(checkInOrganisationTicket(owner.organisation.id, valid.id, owner.user.id)).resolves.toMatchObject({ status: "checked-in" });
  });

  test("the projection reads free orders as Free and charged-but-unfulfilled orders as Payment review", async () => {
    expect(ticketOrderProjection({ status: "paid", paymentKind: "free", requiresCompensationReview: false })).toBe("free");
    expect(ticketOrderProjection({ status: "paid", paymentKind: "stripe", requiresCompensationReview: false })).toBe("paid");
    expect(ticketOrderProjection({ status: "failed", paymentKind: "stripe", requiresCompensationReview: true })).toBe("review");
    expect(ticketOrderProjection({ status: "pending", paymentKind: "stripe", requiresCompensationReview: false })).toBe("processing");
    expect(ticketOrderProjection({ status: "expired", paymentKind: "stripe", requiresCompensationReview: false })).toBe("expired");

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
