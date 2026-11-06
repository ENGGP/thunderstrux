import { beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { POST as cancelRoute } from "@/app/api/orders/[orderId]/cancel/route";
import { prisma } from "@/lib/db";
import { enqueueOrganisationOrderTicketEmail } from "@/lib/orders/order-detail";
import { cancelFreeOrder, cancelFreePurchase } from "@/lib/payments/free-cancellation";
import { lockOrder } from "@/lib/payments/order-lifecycle";
import { checkInOrganisationTicket, TicketNotValidError } from "@/lib/tickets/check-in";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { createTestRateLimitBackend, setRateLimitTestBackend } from "@/lib/security/rate-limit";
import { setMockSession } from "@/tests/helpers/auth";
import { enrolStaffMfa } from "@/tests/helpers/mfa";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createEvent, createOrder, createOrganisationAccount } from "@/tests/helpers/test-data";

// Most cases test the cancellation; the authenticator requirement has its own case.
beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });

// A confirmed two-ticket free registration, one ticket already used at the door.
async function freeOrder() {
  const owner = await createOrganisationAccount();
  const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, status: "paid", paidAt: new Date(), paymentKind: "free", unitPrice: 0, quantity: 2 });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: ticketType.id, organisationId: owner.organisation.id, checkedInAt: issueSequence === 1 ? new Date() : null })) });
  await prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: "buyer@example.com", buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });
  return { owner, event, ticketType, order };
}

type Fixture = Awaited<ReturnType<typeof freeOrder>>;

const send = (fixture: Fixture, body: Record<string, string>, orderId = fixture.order.id) => {
  setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });
  return cancelRoute(jsonRequest(`http://localhost:3000/api/orders/${orderId}/cancel`, body), routeContext({ orderId }));
};

const input = (fixture: Fixture) => ({ organisationId: fixture.owner.organisation.id, orderId: fixture.order.id, actor: { id: fixture.owner.user.id }, reason: "Duplicate registration." });

describe("cancelling a free registration", () => {
  test("voids the tickets, keeps the fulfilment and attendance, emails the buyer once and touches no stock or refund", async () => {
    const fixture = await freeOrder();
    const stockBefore = (await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketType.id } })).quantity;
    const response = await send(fixture, { reason: "Duplicate registration." });
    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toMatchObject({ status: "cancelled" });
    // A replay through the route or the service answers without doing it again.
    expect(await parseJsonResponse(await send(fixture, { reason: "Duplicate registration." }))).toMatchObject({ status: "already_cancelled" });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id }, include: { tickets: { orderBy: { issueSequence: "asc" } } } });
    expect(order).toMatchObject({ status: "paid", paymentKind: "free", fulfilledAt: fixture.order.fulfilledAt, cancelledByUserId: fixture.owner.user.id, cancellationReason: "Duplicate registration." });
    expect(order.cancelledAt).toBeInstanceOf(Date);
    expect(order.tickets.map((ticket) => [ticket.validity, ticket.validityReason, Boolean(ticket.checkedInAt)])).toEqual([["void", "cancelled", true], ["void", "cancelled", false]]);
    expect(ticketOrderProjection(order)).toBe("cancelled");
    expect(await prisma.orderLifecycleEvent.count({ where: { orderId: order.id, type: "free_cancelled" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { targetId: order.id, action: "order.free_cancelled" } })).toBe(1);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `cancellation/${order.id}`, recipient: "buyer@example.com" } })).toBe(1);
    expect(await prisma.refundRequest.count()).toBe(0);
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.ticketType.id } })).quantity).toBe(stockBefore);
    await expect(enqueueOrganisationOrderTicketEmail(fixture.owner.organisation.id, order.id)).rejects.toThrow("cancelled");
  });

  test("a buyer can't give back a registration already used at the door; staff still can (#67)", async () => {
    const fixture = await freeOrder();
    await expect(prisma.$transaction((tx) => cancelFreeOrder(tx, { organisationId: fixture.owner.organisation.id, orderId: fixture.order.id, by: { kind: "buyer", actorUserId: fixture.owner.user.id }, reason: "I can't make it.", now: new Date() })))
      .rejects.toThrow("already used at the door");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).cancelledAt).toBeNull();
    expect(await cancelFreePurchase(input(fixture))).toMatchObject({ status: "cancelled" });
  });

  test("a check-in while the buyer cancels waits for the cancellation and is refused, never voided after the fact (DEF-100)", async () => {
    const fixture = await freeOrder();
    await prisma.ticket.updateMany({ where: { orderId: fixture.order.id }, data: { checkedInAt: null } });
    const [, second] = await prisma.ticket.findMany({ where: { orderId: fixture.order.id }, orderBy: { issueSequence: "asc" } });
    let locked!: () => void; const hasLock = new Promise<void>((resolve) => { locked = resolve; });
    let go!: () => void; const proceed = new Promise<void>((resolve) => { go = resolve; });
    // The buyer's cancellation holds the order lock while it counts check-ins.
    const cancellation = prisma.$transaction(async (tx) => {
      await lockOrder(tx, fixture.order.id, fixture.owner.organisation.id); locked(); await proceed;
      return cancelFreeOrder(tx, { organisationId: fixture.owner.organisation.id, orderId: fixture.order.id, by: { kind: "buyer", actorUserId: null }, reason: "I can't make it.", now: new Date() });
    }, { timeout: 15000 });
    await hasLock;
    setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });
    let settled = false;
    const checkIn = checkInOrganisationTicket(fixture.owner.organisation.id, fixture.event.id, second.id, fixture.owner.user.id)
      .then(() => "checked-in", (error: unknown) => error).finally(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(settled).toBe(false);
    go();
    await expect(cancellation).resolves.toMatchObject({ status: "cancelled" });
    expect(await checkIn).toBeInstanceOf(TicketNotValidError);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: second.id } })).checkedInAt).toBeNull();
  });

  test("two cancellations at once record one", async () => {
    const fixture = await freeOrder();
    const results = await Promise.all([cancelFreePurchase(input(fixture)), cancelFreePurchase(input(fixture))]);
    expect(results.map((result) => result.status).sort()).toEqual(["already_cancelled", "cancelled"]);
    expect(await prisma.orderLifecycleEvent.count({ where: { orderId: fixture.order.id, type: "free_cancelled" } })).toBe(1);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `cancellation/${fixture.order.id}` } })).toBe(1);
  });

  test("a paid order, another society's order and a short reason are refused before anything changes", async () => {
    const fixture = await freeOrder();
    const paid = await createOrder({ organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, status: "paid", paidAt: new Date() });
    const paidResponse = await send(fixture, { reason: "Duplicate registration." }, paid.id);
    expect(paidResponse.status).toBe(409);
    expect((await parseJsonResponse(paidResponse)).error.details[0].reason).toBe("not_cancellable");

    const other = await freeOrder();
    expect((await send(fixture, { reason: "Duplicate registration." }, other.order.id)).status).toBe(404);
    expect((await send(fixture, { reason: "short" })).status).toBe(400);
    expect(await prisma.order.count({ where: { cancelledAt: { not: null } } })).toBe(0);
    // The database refuses a cancellation fact on a paid order or without a reason.
    await expect(prisma.order.update({ where: { id: paid.id }, data: { cancelledAt: new Date(), cancellationReason: "Duplicate registration." } })).rejects.toThrow();
    await expect(prisma.order.update({ where: { id: fixture.order.id }, data: { cancelledAt: new Date() } })).rejects.toThrow();
    const dispute = await prisma.purchaseDispute.create({ data: { orderId: paid.id, organisationId: fixture.owner.organisation.id, stripeDisputeId: "dp_reason_check", stripeChargeId: "ch_reason_check", amount: 100, currency: "aud", providerStatus: "won" } });
    await expect(prisma.purchaseDispute.update({ where: { id: dispute.id }, data: { resolvedAt: new Date() } })).rejects.toThrow();
  });

  test("with staff MFA on, a verified sign-in cancels with no further code; an unverified one is refused", async () => {
    const fixture = await freeOrder();
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    expect((await send(fixture, { reason: "Duplicate registration." })).status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).cancelledAt).toBeNull();

    setRateLimitTestBackend(createTestRateLimitBackend());
    onTestFinished(() => setRateLimitTestBackend(null));
    await enrolStaffMfa(fixture.owner.user);
    expect((await send(fixture, { reason: "Duplicate registration." })).status).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).cancelledAt).not.toBeNull();
  });
});
