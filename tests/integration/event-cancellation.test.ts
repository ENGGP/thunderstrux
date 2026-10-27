import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { POST as cancelRoute } from "@/app/api/events/[eventId]/cancel/route";
import { POST as releaseRoute } from "@/app/api/purchases/tickets/[orderId]/cancel-registration/route";
import { prisma } from "@/lib/db";
import { setOrganisationEventSaleState } from "@/lib/events/event-lifecycle";
import { getPublishedEvents } from "@/lib/events/public-events";
import { guestCookieName } from "@/lib/guest/guest-access";
import { guestCsrfToken } from "@/lib/guest/guest-csrf";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { processOrderRefundBatch } from "@/lib/payments/order-refunds";
import { pendingCheckoutState } from "@/lib/purchases/pending-checkout";
import { createTestRateLimitBackend, setRateLimitTestBackend } from "@/lib/security/rate-limit";
import { clearMockSession, selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { guestSession } from "@/tests/helpers/guest";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { enrolStaffMfa } from "@/tests/helpers/mfa";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createOrder, createOrganisationAccount, createOrganisationStaff, createReservation, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), expire: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { retrieve: stripe.retrieve, expire: stripe.expire } }, refunds: { list: stripe.list, create: stripe.create } })
}));

beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });
afterEach(() => { stripe.retrieve.mockReset(); stripe.expire.mockReset(); stripe.list.mockReset(); stripe.create.mockReset(); });

type Society = Awaited<ReturnType<typeof createOrganisationAccount>>;
type Event = Awaited<ReturnType<typeof createEvent>>;

// A fulfilled order with valid tickets and a captured buyer email.
async function heldOrder(society: Society, event: Event, input: { paymentKind: "stripe" | "free"; quantity?: number; userId?: string; email?: string }) {
  const quantity = input.quantity ?? 1;
  const ticketType = event.ticketTypes[input.paymentKind === "free" ? 1 : 0];
  const created = await createOrder({
    organisationId: society.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: input.userId, status: "paid", paidAt: new Date(),
    paymentKind: input.paymentKind, unitPrice: ticketType.price, quantity
  });
  await prisma.ticket.createMany({ data: Array.from({ length: quantity }, (_, index) => ({ issueSequence: index + 1, orderId: created.id, eventId: event.id, ticketTypeId: ticketType.id, organisationId: society.organisation.id })) });
  return prisma.order.update({
    where: { id: created.id },
    data: {
      buyerEmailSnapshot: input.email ?? `${unique("holder")}@example.com`, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase",
      ...(input.paymentKind === "stripe" ? { sellerStripeAccountId: society.organisation.stripeAccountId } : {})
    }
  });
}

async function societyEvent() {
  const society = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({
    organisationId: society.organisation.id, status: "published",
    ticketTypes: [{ name: "Standard", price: 1500, quantity: 50 }, { name: "Free entry", price: 0, quantity: 50 }]
  });
  return { society, event };
}

const cancel = (society: Society, eventId: string, body: Record<string, string>) => {
  clearMockSession();
  setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
  return cancelRoute(jsonRequest(`http://localhost:3000/api/events/${eventId}/cancel`, body), routeContext({ eventId }));
};
const reason = "The venue flooded and we can't move the date.";

describe("cancelling an event (EVT-004)", () => {
  // PAY-022: Stripe holds manual-payout money at most 90 days, so sales older than 80 were already sent to the society.
  test("names refunds of sale money already released for payout, and alerts the platform", async () => {
    const { society, event } = await societyEvent();
    const early = await heldOrder(society, event, { paymentKind: "stripe" });
    await prisma.order.update({ where: { id: early.id }, data: { paidAt: new Date(Date.now() - 81 * 86_400_000), feeAmount: 145 } });
    // Just as old, but disputed: no refund is opened, so nothing is taken back for it.
    const disputed = await heldOrder(society, event, { paymentKind: "stripe" });
    await prisma.order.update({ where: { id: disputed.id }, data: { paidAt: new Date(Date.now() - 90 * 86_400_000), feeAmount: 145, disputeStatus: "open" } });
    await heldOrder(society, event, { paymentKind: "stripe" });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await parseJsonResponse(await cancel(society, event.id, { reason, confirmation: event.title }));
    expect(result).toMatchObject({ status: "cancelled", refundsQueued: 2, releasedEarly: { amount: 1500 - 145, orders: 1 } });
    const alerts = error.mock.calls.map(([line]) => { try { return JSON.parse(String(line)); } catch { return {}; } }).filter((entry) => entry.event === "event_cancelled_after_release");
    expect(alerts).toEqual([expect.objectContaining({ organisationId: society.organisation.id, eventId: event.id, amount: 1355, orders: 1 })]);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "event.cancelled", targetId: event.id } }))
      .toMatchObject({ metadata: expect.objectContaining({ releasedEarly: { amount: 1355, orders: 1 } }) });
  });

  test("closes sales, queues one refund per paid order, cancels free ones, skips disputed and refunded orders, and emails each holder once", async () => {
    const { society, event } = await societyEvent();
    const paid = await heldOrder(society, event, { paymentKind: "stripe", quantity: 2 });
    const disputed = await heldOrder(society, event, { paymentKind: "stripe" });
    await prisma.order.update({ where: { id: disputed.id }, data: { disputeStatus: "open" } });
    const refunded = await heldOrder(society, event, { paymentKind: "stripe" });
    await prisma.order.update({ where: { id: refunded.id }, data: { refundStatus: "refunded" } });
    await prisma.ticket.updateMany({ where: { orderId: refunded.id }, data: { validity: "void", validityReason: "refunded", validityChangedAt: new Date() } });
    const free = await heldOrder(society, event, { paymentKind: "free", quantity: 2 });
    const pending = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, unitPrice: 1500 });
    const stockBefore = await prisma.ticketType.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" }, select: { quantity: true } });

    const response = await cancel(society, event.id, { reason, confirmation: ` ${event.title.toUpperCase()} ` });
    expect(response.status).toBe(200);
    const result = await parseJsonResponse(response);
    expect(result).toMatchObject({ status: "cancelled", refundsQueued: 1, freeCancelled: 1, notified: 3 });
    expect(result.skipped).toEqual(expect.arrayContaining([{ orderId: disputed.id, reason: "disputed" }, { orderId: refunded.id, reason: "already_refunded" }]));
    expect(result.skipped).toHaveLength(2);

    const after = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(after).toMatchObject({ status: "published", saleState: "closed", cancellationReason: reason, version: event.version + 1 });
    expect(after.cancelledAt).toBeInstanceOf(Date);

    // The paid order is fenced and left for the refund worker; its tickets stay until Stripe confirms.
    const request = await prisma.refundRequest.findFirstOrThrow({ where: { orderId: paid.id } });
    expect(request).toMatchObject({ status: "pending", amount: 3000, attempts: 0, processingToken: null, actorUserId: society.user.id });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ refundStatus: "processing" });
    expect(await prisma.refundRequest.count({ where: { orderId: { in: [disputed.id, refunded.id, free.id, pending.id] } } })).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: disputed.id } })).toMatchObject({ refundStatus: null, disputeStatus: "open" });

    // The free registration is cancelled without its own "cancelled by the society" email; places aren't restored.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: free.id } })).toMatchObject({ cancelledByUserId: society.user.id });
    expect(await prisma.ticket.count({ where: { orderId: free.id, validity: "void", validityReason: "cancelled" } })).toBe(2);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `cancellation/${free.id}` } })).toBe(0);
    expect(await prisma.ticketType.findMany({ where: { eventId: event.id }, orderBy: { createdAt: "asc" }, select: { quantity: true } })).toEqual(stockBefore);

    // One notice per holder: paid, disputed and free; not the refunded order or the unpaid checkout.
    const notices = await prisma.notificationOutbox.findMany({ where: { template: "event_cancelled" } });
    expect(notices.map((notice) => notice.eventKey).sort()).toEqual([paid.id, disputed.id, free.id].map((id) => `event-cancelled/${event.id}/${id}`).sort());
    expect(notices.every((notice) => notice.privacy === "business" && notice.organisationId === society.organisation.id)).toBe(true);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "event.cancelled", targetId: event.id } }))
      .toMatchObject({ actorUserId: society.user.id, metadata: expect.objectContaining({ reason, refundsQueued: 1, freeCancelled: 1 }) });

    // A repeat changes nothing, and the event can't be put back on sale or listed.
    expect(await parseJsonResponse(await cancel(society, event.id, { reason, confirmation: event.title }))).toMatchObject({ status: "already_cancelled" });
    expect(await prisma.refundRequest.count({ where: { orderId: paid.id } })).toBe(1);
    await expect(setOrganisationEventSaleState(society.organisation.id, event.id, { saleState: "open", version: after.version }, society.user.id)).rejects.toThrow("cancelled");
    expect((await getPublishedEvents({ societySlug: society.organisation.slug })).events).toEqual([]);

    // The worker sends the refund through the existing path, which voids the tickets.
    const intentId = unique("pi");
    stripe.retrieve.mockResolvedValue({
      payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: paid.id },
      payment_intent: { id: intentId, amount_received: 3000, transfer_data: { destination: society.organisation.stripeAccountId }, latest_charge: { disputed: false } }
    });
    stripe.list.mockResolvedValue({ data: [] });
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => ({
      id: unique("re"), status: "succeeded", amount: 3000, currency: "aud", payment_intent: intentId, metadata: { ...params.metadata }
    }));
    expect(await processOrderRefundBatch()).toMatchObject({ processed: 1 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: paid.id } })).toMatchObject({ refundStatus: "refunded" });
    expect(await prisma.ticket.count({ where: { orderId: paid.id, validity: "void" } })).toBe(2);
  });

  test("closes every unpaid order's Stripe page, so nobody can pay for the cancelled event, and never offers it again (EVT-006)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { society, event } = await societyEvent();
    const unpaid = async () => {
      const order = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, unitPrice: 1500 });
      await createReservation({ orderId: order.id, organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, expiresAt: new Date(Date.now() + 20 * 60_000) });
      const session = { ...checkoutSession({ id: order.stripeSessionId as string, orderId: order.id, eventId: event.id, organisationId: society.organisation.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, amountTotal: 1500, paymentStatus: "unpaid" }), status: "open", url: "https://checkout.stripe.test/pay", expires_at: Math.floor(Date.now() / 1000) + 15 * 60 };
      return { order, session };
    };
    const closed = await unpaid();
    const unreachable = await unpaid();
    stripe.retrieve.mockImplementation(async (id: string) => (id === closed.session.id ? closed.session : unreachable.session));
    stripe.expire.mockImplementation(async (id: string) => {
      if (id === unreachable.session.id) throw Object.assign(new Error("An error occurred with our connection to Stripe."), { type: "StripeConnectionError" });
      return { ...closed.session, status: "expired" };
    });

    const response = await cancel(society, event.id, { reason, confirmation: event.title });
    expect(await parseJsonResponse(response)).toMatchObject({ status: "cancelled", checkoutsClosed: 1 });
    expect(stripe.expire).toHaveBeenCalledWith(closed.session.id);
    // The closed page's order expires, recorded as the society's doing.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: closed.order.id }, include: { reservation: true } })).toMatchObject({ status: "expired", reservation: { status: "expired" } });
    expect(await prisma.orderLifecycleEvent.findFirst({ where: { orderId: closed.order.id, type: "order_expired" } })).toMatchObject({ source: "staff_action" });

    // Stripe couldn't close the other page: the cancellation still stands, and the
    // order page offers no payment, though Stripe still shows the page open.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: unreachable.order.id } })).toMatchObject({ status: "pending" });
    expect(await pendingCheckoutState({ kind: "ticket", id: unreachable.order.id })).toEqual({ state: "ended" });
    stripe.retrieve.mockRejectedValue(new Error("Stripe is down"));
    expect(await pendingCheckoutState({ kind: "ticket", id: unreachable.order.id })).toEqual({ state: "ended" });

    // A repeat tries the page it couldn't reach before.
    stripe.retrieve.mockReset();
    stripe.retrieve.mockResolvedValue(unreachable.session);
    stripe.expire.mockReset();
    stripe.expire.mockResolvedValue({ ...unreachable.session, status: "expired" });
    expect(await parseJsonResponse(await cancel(society, event.id, { reason, confirmation: event.title }))).toMatchObject({ status: "already_cancelled", checkoutsClosed: 1 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: unreachable.order.id } })).toMatchObject({ status: "expired" });
  });

  test("the longest message still fits each order's own reason", async () => {
    const { society, event } = await societyEvent();
    const paid = await heldOrder(society, event, { paymentKind: "stripe" });
    const free = await heldOrder(society, event, { paymentKind: "free" });
    const response = await cancel(society, event.id, { reason: "x".repeat(500), confirmation: event.title });
    expect(await parseJsonResponse(response)).toMatchObject({ status: "cancelled", refundsQueued: 1, freeCancelled: 1 });
    expect((await prisma.refundRequest.findFirstOrThrow({ where: { orderId: paid.id } })).reason).toHaveLength(500);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: free.id } })).cancellationReason).toHaveLength(500);
  });

  test("a payment that lands after the cancellation issues no tickets and goes to compensation", async () => {
    const { society, event } = await societyEvent();
    const buyer = await createMember();
    const order = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, quantity: 1, unitPrice: 1500 });
    await prisma.ticketReservation.create({ data: { orderId: order.id, organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, quantity: 1, expiresAt: new Date(Date.now() + 20 * 60_000) } });
    expect((await cancel(society, event.id, { reason, confirmation: event.title })).status).toBe(200);

    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const session = checkoutSession({ id: order.stripeSessionId!, orderId: order.id, eventId: event.id, organisationId: society.organisation.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1, amountTotal: 1500 });
    await expect(reconcileCompletedCheckoutSession(session, { stripeEventId: unique("evt_late") })).resolves.toMatchObject({ status: "compensation_required" });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ requiresCompensationReview: true, fulfilmentFailureReason: "event_cancelled_before_fulfilment" });
  });

  test("the wrong title, a draft, an event manager without refunds and a missing authenticator code are refused before anything changes", async () => {
    const { society, event } = await societyEvent();
    const wrong = await cancel(society, event.id, { reason, confirmation: "Some other event" });
    expect(wrong.status).toBe(400);
    expect((await parseJsonResponse(wrong)).error.details[0].path).toEqual(["confirmation"]);

    const draft = await createEvent({ organisationId: society.organisation.id });
    expect((await cancel(society, draft.id, { reason, confirmation: draft.title })).status).toBe(400);
    expect((await cancel(society, event.id, { reason: "short", confirmation: event.title })).status).toBe(400);

    const manager = await createMember();
    await createOrganisationStaff({ organisationId: society.organisation.id, userId: manager.id, role: "event_manager" });
    setMockSession({ userId: manager.id, email: manager.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: society.organisation.id });
    expect((await cancelRoute(jsonRequest(`http://localhost:3000/api/events/${event.id}/cancel`, { reason, confirmation: event.title }), routeContext({ eventId: event.id }))).status).toBe(403);

    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enroll");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    const missing = await cancel(society, event.id, { reason, confirmation: event.title });
    expect(missing.status).toBe(400);
    expect((await parseJsonResponse(missing)).error.details[0].path).toEqual(["mfaCode"]);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).cancelledAt).toBeNull();

    setRateLimitTestBackend(createTestRateLimitBackend());
    onTestFinished(() => setRateLimitTestBackend(null));
    const { code } = await enrolStaffMfa(society.user);
    const response = await cancelRoute(jsonRequest(`http://localhost:3000/api/events/${event.id}/cancel`, { reason, confirmation: event.title, mfaCode: code() }), routeContext({ eventId: event.id }));
    expect(response.status).toBe(200);
  });
});

describe("a buyer releasing their free registration (EVT-005)", () => {
  const release = (orderId: string, init: RequestInit = {}) =>
    releaseRoute(jsonRequest(`http://localhost:3000/api/purchases/tickets/${orderId}/cancel-registration`, {}, init), routeContext({ orderId }));

  test("voids the tickets, returns the places to stock once, and records the buyer as the actor", async () => {
    const { society, event } = await societyEvent();
    const buyer = await createMember();
    const order = await heldOrder(society, event, { paymentKind: "free", quantity: 2, userId: buyer.id, email: buyer.email });
    const freeType = event.ticketTypes[1];
    const stock = async () => (await prisma.ticketType.findUniqueOrThrow({ where: { id: freeType.id } })).quantity;
    const before = await stock();

    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    const response = await release(order.id);
    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({ status: "cancelled" });
    expect(await parseJsonResponse(await release(order.id))).toEqual({ status: "already_cancelled" });

    expect(await stock()).toBe(before + 2);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ cancelledByUserId: buyer.id, cancellationReason: "Cancelled by the buyer" });
    expect(await prisma.ticket.count({ where: { orderId: order.id, validity: "void" } })).toBe(2);
    expect(await prisma.orderLifecycleEvent.findFirstOrThrow({ where: { orderId: order.id, type: "free_cancelled" } })).toMatchObject({ source: "buyer_action", actorUserId: buyer.id });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "order.free_cancelled", targetId: order.id } })).toMatchObject({ actorUserId: buyer.id, metadata: expect.objectContaining({ by: "buyer" }) });
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `cancellation/${order.id}`, recipient: buyer.email } })).toBe(1);
  });

  test("a guest releases with their session and CSRF token; without the token, as another member, for a paid order or after the start it is refused", async () => {
    const { society, event } = await societyEvent();
    const guest = await guestSession();
    const order = await heldOrder(society, event, { paymentKind: "free", email: guest.email });
    await prisma.order.update({ where: { id: order.id }, data: { guestIdentityId: guest.guest.guestIdentityId } });
    // The guest's checkout session bought it, so that session may open it.
    await prisma.checkoutAttempt.create({ data: {
      family: "ticket", actorKind: "guest", actorId: guest.guest.grantId, operationType: "ticket_checkout", requestHash: "synthetic",
      clientIdempotencyKey: unique("key"), providerOperationKey: unique("op"), orderId: order.id
    } });
    clearMockSession();
    const cookie = `${guestCookieName}=${guest.sessionId}`;
    expect((await release(order.id, { headers: { cookie } })).status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).cancelledAt).toBeNull();
    const response = await release(order.id, { headers: { cookie, "x-thunderstrux-guest-csrf": guestCsrfToken(guest.sessionId) } });
    expect(response.status).toBe(200);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ cancelledByUserId: null });

    const buyer = await createMember();
    const mine = await heldOrder(society, event, { paymentKind: "free", userId: buyer.id });
    const stranger = await createMember();
    setMockSession({ userId: stranger.id, email: stranger.email, accountRole: "member" });
    expect((await release(mine.id)).status).toBe(404);

    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    const paid = await heldOrder(society, event, { paymentKind: "stripe", userId: buyer.id });
    expect((await release(paid.id)).status).toBe(409);
    await prisma.event.update({ where: { id: event.id }, data: { startTime: new Date(Date.now() - 60_000) } });
    const started = await release(mine.id);
    expect(started.status).toBe(409);
    expect((await parseJsonResponse(started)).error.details[0].reason).toBe("event_started");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: mine.id } })).cancelledAt).toBeNull();
  });
});
