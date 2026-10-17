import Stripe from "stripe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as reviewRoute } from "@/app/api/orders/[orderId]/review/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { prisma } from "@/lib/db";
import { enqueueOrganisationOrderTicketEmail } from "@/lib/orders/order-detail";
import { orderReference, requestOrderRefund } from "@/lib/payments/order-refunds";
import { reconcileDisputeEvent, reconcileExternalRefundEvent } from "@/lib/payments/purchase-disputes";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { createEvent, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const webhookSecret = "whsec_disputes_test";
const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), refunds: vi.fn(), create: vi.fn(), dispute: vi.fn() }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => "whsec_disputes_test",
    getStripe: () => ({
      checkout: { sessions: { retrieve: stripe.retrieve, list: stripe.list } },
      refunds: { list: stripe.refunds, create: stripe.create },
      disputes: { retrieve: stripe.dispute },
      // Real signature checking, so the route is exercised as Stripe calls it.
      webhooks: new RealStripe("sk_test_disputes").webhooks
    })
  };
});

afterEach(() => { for (const mock of Object.values(stripe)) mock.mockReset(); });

// A paid two-ticket order, $30.00, and a Stripe that agrees about its payment.
async function paidOrder() {
  const owner = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
  const created = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
  const order = await prisma.order.update({ where: { id: created.id }, data: { sellerStripeAccountId: owner.organisation.stripeAccountId } });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: owner.organisation.id })) });
  const intentId = unique("pi");
  const chargeId = unique("ch");
  stripe.list.mockResolvedValue({ data: [{ id: order.stripeSessionId, metadata: { orderId: order.id } }] });
  stripe.retrieve.mockResolvedValue({
    payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: order.id },
    payment_intent: { id: intentId, currency: "aud", amount_received: 3000, transfer_data: { destination: owner.organisation.stripeAccountId }, latest_charge: { id: chargeId, disputed: false } }
  });
  stripe.refunds.mockResolvedValue({ data: [] });
  return { owner, event, order, intentId, chargeId };
}

type Fixture = Awaited<ReturnType<typeof paidOrder>>;

const signedEvent = (type: string, object: unknown, created = Math.floor(Date.now() / 1000)) =>
  ({ id: unique("evt"), object: "event", type, livemode: false, created, data: { object } }) as unknown as Stripe.Event;

const disputeObject = (fixture: Fixture, status: string, extra: Record<string, unknown> = {}) => ({
  id: `dp_${fixture.order.id}`, object: "dispute", charge: fixture.chargeId, payment_intent: fixture.intentId, amount: 3000, currency: "aud",
  status, reason: "fraudulent", evidence_details: { due_by: Math.floor(Date.UTC(2026, 10, 4) / 1000) }, ...extra
});

// Stripe's dispute as it stands now, whatever event is being delivered.
const disputeNow = (fixture: Fixture, status: string) => stripe.dispute.mockResolvedValue(disputeObject(fixture, status));

async function postSigned(event: Stripe.Event) {
  const body = JSON.stringify(event);
  const signature = new Stripe("sk_test_disputes").webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  return webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

const orderState = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { tickets: { orderBy: { issueSequence: "asc" }, select: { validity: true, validityReason: true } } } });
const historyOf = async (orderId: string) => (await prisma.orderLifecycleEvent.findMany({ where: { orderId }, orderBy: { sequence: "asc" } })).map((event) => event.type);

const reviewAs = (fixture: Fixture, body: Record<string, string>) => {
  setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });
  return reviewRoute(jsonRequest(`http://localhost:3000/api/orders/${fixture.order.id}/review`, body), routeContext({ orderId: fixture.order.id }));
};

const refundInput = (fixture: Fixture) => ({
  organisationId: fixture.owner.organisation.id, orderId: fixture.order.id, actor: { id: fixture.owner.user.id },
  reason: "Refunding what is left of the order.", confirmation: orderReference(fixture.order.id)
});

describe("disputes", () => {
  test("a verified dispute puts the tickets under review and pauses refunds and resends; replays and late events change nothing; a lost one voids them", async () => {
    const fixture = await paidOrder();
    disputeNow(fixture, "needs_response");
    // Stripe's updated event can arrive before created; both read the dispute as it stands.
    expect((await postSigned(signedEvent("charge.dispute.updated", disputeObject(fixture, "needs_response")))).status).toBe(200);
    const created = signedEvent("charge.dispute.created", disputeObject(fixture, "needs_response"));
    await reconcileDisputeEvent(created);
    await reconcileDisputeEvent(created);

    const disputed = await orderState(fixture.order.id);
    expect(disputed).toMatchObject({ status: "paid", disputeStatus: "open", stripePaymentIntentId: fixture.intentId });
    expect(disputed.tickets).toEqual([{ validity: "refund_review", validityReason: "disputed" }, { validity: "refund_review", validityReason: "disputed" }]);
    expect(ticketOrderProjection(disputed)).toBe("disputed");
    expect(await prisma.purchaseDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${fixture.order.id}` } })).toMatchObject({
      orderId: fixture.order.id, stripeChargeId: fixture.chargeId, providerStatus: "needs_response", evidenceDueBy: new Date(Date.UTC(2026, 10, 4))
    });
    await expect(requestOrderRefund(refundInput(fixture))).rejects.toMatchObject({ kind: "disputed" });
    await expect(enqueueOrganisationOrderTicketEmail(fixture.owner.organisation.id, fixture.order.id)).rejects.toThrow("disputed");
    expect(stripe.create).not.toHaveBeenCalled();

    disputeNow(fixture, "lost");
    await reconcileDisputeEvent(signedEvent("charge.dispute.closed", disputeObject(fixture, "lost")));
    // A stale "needs response" event delivered late reads Stripe's current state: still lost.
    await reconcileDisputeEvent(signedEvent("charge.dispute.updated", disputeObject(fixture, "needs_response"), Math.floor(Date.now() / 1000) - 3600));
    const lost = await orderState(fixture.order.id);
    expect(lost.disputeStatus).toBe("lost");
    expect(lost.tickets).toEqual([{ validity: "void", validityReason: "dispute_lost" }, { validity: "void", validityReason: "dispute_lost" }]);
    expect(await historyOf(fixture.order.id)).toEqual(["dispute_opened", "dispute_closed"]);
    expect(await prisma.auditLog.count({ where: { targetId: fixture.order.id, action: { startsWith: "order.dispute_" } } })).toBe(2);
  });

  test("a won dispute keeps the tickets under review until staff restore them with a reason", async () => {
    const fixture = await paidOrder();
    disputeNow(fixture, "needs_response");
    await reconcileDisputeEvent(signedEvent("charge.dispute.created", disputeObject(fixture, "needs_response")));
    expect((await reviewAs(fixture, { action: "restore_tickets", reason: "We won the dispute." })).status).toBe(409);

    disputeNow(fixture, "won");
    await reconcileDisputeEvent(signedEvent("charge.dispute.closed", disputeObject(fixture, "won")));
    expect((await orderState(fixture.order.id)).tickets.every((ticket) => ticket.validity === "refund_review")).toBe(true);
    expect((await reviewAs(fixture, { action: "restore_tickets", reason: "short" })).status).toBe(400);
    expect((await reviewAs(fixture, { action: "restore_tickets", reason: "Stripe closed it in our favour." })).status).toBe(200);

    const restored = await orderState(fixture.order.id);
    expect(restored.disputeStatus).toBeNull();
    expect(restored.tickets).toEqual([{ validity: "active", validityReason: null }, { validity: "active", validityReason: null }]);
    expect(ticketOrderProjection(restored)).toBe("paid");
    expect(await prisma.purchaseDispute.findFirstOrThrow({ where: { orderId: fixture.order.id } })).toMatchObject({ resolvedByUserId: fixture.owner.user.id, resolutionReason: "Stripe closed it in our favour." });
    expect(await historyOf(fixture.order.id)).toEqual(["dispute_opened", "dispute_closed", "dispute_resolved"]);
    // A late event after the restore is history only.
    await reconcileDisputeEvent(signedEvent("charge.dispute.updated", disputeObject(fixture, "won")));
    expect((await orderState(fixture.order.id)).disputeStatus).toBeNull();
    expect((await reviewAs(fixture, { action: "restore_tickets", reason: "Stripe closed it in our favour." })).status).toBe(409);
  });

  test("dispute and refund events that don't verify as the order's payment change nothing", async () => {
    const fixture = await paidOrder();
    const before = await orderState(fixture.order.id);
    const sold = stripe.list.getMockImplementation();
    const cases: Array<() => void> = [
      () => undefined, // another charge on the same payment (below)
      () => stripe.list.mockResolvedValue({ data: [] }), // a payment Thunderstrux never sold
      () => stripe.list.mockImplementation(sold!) && stripe.retrieve.mockResolvedValue({ metadata: { orderId: "another-order" }, payment_intent: { id: fixture.intentId, currency: "aud", latest_charge: { id: fixture.chargeId } } }),
      () => stripe.retrieve.mockResolvedValue({ metadata: { orderId: fixture.order.id }, payment_intent: { id: fixture.intentId, currency: "aud", transfer_data: { destination: "acct_someone_else" }, latest_charge: { id: fixture.chargeId } } })
    ];
    for (const [index, arrange] of cases.entries()) {
      arrange();
      await reconcileDisputeEvent(signedEvent("charge.dispute.created", disputeObject(fixture, "needs_response", index === 0 ? { charge: "ch_other" } : {})));
      if (index > 0) await reconcileExternalRefundEvent(signedEvent("refund.created", { id: unique("re"), payment_intent: fixture.intentId, amount: 3000, currency: "aud", status: "succeeded", metadata: {} }));
    }
    expect(stripe.dispute).not.toHaveBeenCalled();
    expect(stripe.refunds).not.toHaveBeenCalled();
    expect(await orderState(fixture.order.id)).toEqual(before);
    expect(await prisma.purchaseDispute.count()).toBe(0);
    expect(await prisma.stripeRefundWebhookEvent.count()).toBe(0);
  });
});

describe("refunds made outside Thunderstrux", () => {
  const dashboardRefund = (fixture: Fixture, amount: number, status = "succeeded") =>
    ({ id: `re_dash_${amount}`, object: "refund", payment_intent: fixture.intentId, amount, currency: "aud", status, metadata: {} });

  test("a partial refund is flagged for review, never treated as full; staff can review it and refund the rest", async () => {
    const fixture = await paidOrder();
    stripe.refunds.mockResolvedValue({ data: [dashboardRefund(fixture, 1500)] });
    expect((await postSigned(signedEvent("refund.created", dashboardRefund(fixture, 1500)))).status).toBe(200);
    await reconcileExternalRefundEvent(signedEvent("refund.updated", dashboardRefund(fixture, 1500)));

    const partial = await orderState(fixture.order.id);
    expect(partial).toMatchObject({ externalRefundedAmount: 1500, refundStatus: null, externalRefundReviewedAt: null });
    expect(partial.tickets.every((ticket) => ticket.validity === "active")).toBe(true);
    expect(ticketOrderProjection(partial)).toBe("review");
    expect(await historyOf(fixture.order.id)).toEqual(["external_refund_recorded"]);

    expect((await reviewAs(fixture, { action: "mark_reviewed" })).status).toBe(200);
    expect(ticketOrderProjection(await orderState(fixture.order.id))).toBe("paid");

    // Refund the rest: Stripe already holds the dashboard refund, which is exactly the part left out.
    stripe.create.mockImplementation(async (params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: params.amount, currency: "aud", payment_intent: fixture.intentId, metadata: params.metadata }));
    expect(await requestOrderRefund(refundInput(fixture))).toMatchObject({ status: "succeeded" });
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ amount: 1500, payment_intent: fixture.intentId });
    const rest = await orderState(fixture.order.id);
    expect(rest.refundStatus).toBe("refunded");
    expect(rest.tickets.every((ticket) => ticket.validity === "void")).toBe(true);
    expect(await historyOf(fixture.order.id)).toEqual(["external_refund_recorded", "external_refund_reviewed", "refund_requested", "refunded"]);
  });

  test("a pending refund counts for nothing; a full one voids the tickets and fences further refunds", async () => {
    const fixture = await paidOrder();
    stripe.refunds.mockResolvedValue({ data: [dashboardRefund(fixture, 3000, "pending")] });
    await reconcileExternalRefundEvent(signedEvent("refund.created", dashboardRefund(fixture, 3000, "pending")));
    expect((await orderState(fixture.order.id)).externalRefundedAmount).toBe(0);

    stripe.refunds.mockResolvedValue({ data: [dashboardRefund(fixture, 3000)] });
    await reconcileExternalRefundEvent(signedEvent("refund.updated", dashboardRefund(fixture, 3000)));
    const full = await orderState(fixture.order.id);
    expect(full).toMatchObject({ externalRefundedAmount: 3000, refundStatus: "refunded" });
    expect(full.tickets).toEqual([{ validity: "void", validityReason: "refunded_outside" }, { validity: "void", validityReason: "refunded_outside" }]);
    expect(ticketOrderProjection(full)).toBe("refunded");
    await expect(requestOrderRefund(refundInput(fixture))).rejects.toMatchObject({ kind: "already_refunded" });
  });
});
