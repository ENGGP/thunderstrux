import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as cancelRoute } from "@/app/api/orders/[orderId]/cancel/route";
import { prisma } from "@/lib/db";
import { enqueueOrganisationOrderTicketEmail } from "@/lib/orders/order-detail";
import { cancelFreePurchase } from "@/lib/payments/free-cancellation";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { setMockSession } from "@/tests/helpers/auth";
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

  test("with staff MFA on, the route needs a fresh authenticator code before anything is recorded", async () => {
    const fixture = await freeOrder();
    // "enroll" lets the dashboard through without a grant, so the route's own code check answers.
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enroll");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    const missing = await send(fixture, { reason: "Duplicate registration." });
    expect(missing.status).toBe(400);
    expect((await parseJsonResponse(missing)).error.details[0].path).toEqual(["mfaCode"]);
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    expect((await send(fixture, { reason: "Duplicate registration." })).status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).cancelledAt).toBeNull();
  });
});
