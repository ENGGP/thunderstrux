import Stripe from "stripe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as reviewRoute } from "@/app/api/orders/[orderId]/review/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { prisma } from "@/lib/db";
import { enqueueOrganisationOrderTicketEmail, markOrganisationOrderManuallyRefunded } from "@/lib/orders/order-detail";
import { processDisputeReversalBatch } from "@/lib/payments/dispute-reversals";
import { orderReference, requestOrderRefund } from "@/lib/payments/order-refunds";
import { reconcileDisputeEvent, reconcileExternalRefundEvent } from "@/lib/payments/purchase-disputes";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { createEvent, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const webhookSecret = "whsec_disputes_test";
const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), refunds: vi.fn(), create: vi.fn(), dispute: vi.fn(), disputeUpdate: vi.fn(), charge: vi.fn(), transfer: vi.fn(), reversals: vi.fn(), reverse: vi.fn(), intent: vi.fn() }));
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
      disputes: { retrieve: stripe.dispute, update: stripe.disputeUpdate },
      charges: { retrieve: stripe.charge },
      paymentIntents: { retrieve: stripe.intent },
      transfers: { retrieve: stripe.transfer, listReversals: stripe.reversals, createReversal: stripe.reverse },
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
  // Refunds Thunderstrux sends reverse the transfer, so nothing is owed back by default (PAY-027).
  stripe.intent.mockResolvedValue({ id: intentId, latest_charge: null });
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
  // PAY-037: a bank's inquiry moves no money; only a chargeback puts tickets under review.
  test("an inquiry leaves the tickets valid and the order refundable; a chargeback that follows puts them under review", async () => {
    const fixture = await paidOrder();
    vi.spyOn(console, "error").mockImplementation(() => {});
    disputeNow(fixture, "warning_needs_response");
    expect((await postSigned(signedEvent("charge.dispute.created", disputeObject(fixture, "warning_needs_response")))).status).toBe(200);
    const inquiry = await orderState(fixture.order.id);
    expect(inquiry.disputeStatus).toBeNull();
    expect(inquiry.tickets.every((ticket) => ticket.validity === "active")).toBe(true);

    disputeNow(fixture, "needs_response");
    await postSigned(signedEvent("charge.dispute.updated", disputeObject(fixture, "needs_response")));
    const chargeback = await orderState(fixture.order.id);
    expect(chargeback.disputeStatus).toBe("open");
    expect(chargeback.tickets.every((ticket) => ticket.validity === "refund_review")).toBe(true);
  });

  // PAY-036: the society kept a won dispute's money, so the order can still be refunded.
  test("a won dispute doesn't block a refund", async () => {
    const fixture = await paidOrder();
    vi.spyOn(console, "error").mockImplementation(() => {});
    disputeNow(fixture, "won");
    await postSigned(signedEvent("charge.dispute.closed", disputeObject(fixture, "won")));
    expect((await orderState(fixture.order.id)).disputeStatus).toBe("won");
    stripe.create.mockImplementation(async (params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: params.amount, currency: "aud", payment_intent: fixture.intentId, metadata: params.metadata }));
    expect(await requestOrderRefund(refundInput(fixture))).toMatchObject({ status: "succeeded" });
    const refunded = await orderState(fixture.order.id);
    expect(refunded.refundStatus).toBe("refunded");
    expect(refunded.tickets.every((ticket) => ticket.validity === "void")).toBe(true);
  });

  // PAY-039: the buyer hears that their tickets were cancelled.
  test("marking an order refunded outside Thunderstrux emails the buyer once", async () => {
    const fixture = await paidOrder();
    await prisma.order.update({ where: { id: fixture.order.id }, data: { buyerEmailSnapshot: "buyer@example.com", buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });
    await markOrganisationOrderManuallyRefunded(fixture.owner.organisation.id, fixture.order.id, fixture.owner.user.id);
    await markOrganisationOrderManuallyRefunded(fixture.owner.organisation.id, fixture.order.id, fixture.owner.user.id);
    expect(await prisma.notificationOutbox.findMany({ where: { eventKey: `refund-marked/${fixture.order.id}` }, select: { recipient: true } })).toEqual([{ recipient: "buyer@example.com" }]);
  });

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

  test("a newly opened dispute gets a draft answer staged in Stripe once, never submitted: check-ins, the ticket email and money already refunded", async () => {
    const fixture = await paidOrder();
    const [first] = await prisma.ticket.findMany({ where: { orderId: fixture.order.id }, orderBy: { issueSequence: "asc" } });
    await prisma.ticket.update({ where: { id: first.id }, data: { checkedInAt: new Date() } });
    await prisma.order.update({ where: { id: fixture.order.id }, data: { ticketEmailSentAt: new Date(), externalRefundedAmount: 500 } });
    await prisma.organisation.update({ where: { id: fixture.owner.organisation.id }, data: { refundPolicy: "Refunds up to 7 days before the event." } });
    disputeNow(fixture, "needs_response");
    const created = signedEvent("charge.dispute.created", disputeObject(fixture, "needs_response"));
    await reconcileDisputeEvent(created);
    await reconcileDisputeEvent(created);
    await reconcileDisputeEvent(signedEvent("charge.dispute.updated", disputeObject(fixture, "needs_response")));

    expect(stripe.disputeUpdate).toHaveBeenCalledTimes(1);
    const [disputeId, params] = stripe.disputeUpdate.mock.calls[0];
    expect(disputeId).toBe(`dp_${fixture.order.id}`);
    // Stripe's default would send it to the bank; the operator submits it.
    expect(params.submit).toBe(false);
    expect(params.evidence.product_description).toContain(fixture.event.title);
    expect(params.evidence.access_activity_log).toContain(`Ticket ${first.id.slice(-6).toUpperCase()} was scanned in at the door`);
    expect(params.evidence.refund_policy_disclosure).toContain("\"Refund policy: Refunds up to 7 days before the event.\"");
    expect(params.evidence.uncategorized_text).toContain(`Order ${orderReference(fixture.order.id)}: $30.00 paid`);
    expect(params.evidence.uncategorized_text).toContain("The tickets were emailed to the buyer");
    expect(params.evidence.uncategorized_text).toContain("Refunded $5.00 to the buyer's card outside Thunderstrux.");

    // A dispute already answered is left alone.
    const answered = await paidOrder();
    stripe.dispute.mockResolvedValue(disputeObject(answered, "needs_response", { evidence_details: { due_by: Math.floor(Date.UTC(2026, 10, 4) / 1000), has_evidence: true } }));
    await reconcileDisputeEvent(signedEvent("charge.dispute.created", disputeObject(answered, "needs_response")));
    expect(stripe.disputeUpdate).toHaveBeenCalledTimes(1);

    // Stripe refusing the draft (a key without Disputes write) alerts; the dispute is still recorded.
    const refused = await paidOrder();
    disputeNow(refused, "needs_response");
    stripe.disputeUpdate.mockRejectedValueOnce(Object.assign(new Error("The provided key does not have the required permissions"), { type: "StripePermissionError" }));
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await reconcileDisputeEvent(signedEvent("charge.dispute.created", disputeObject(refused, "needs_response")));
    expect((await orderState(refused.order.id)).disputeStatus).toBe("open");
    const alerts = error.mock.calls.map(([line]) => { try { return JSON.parse(String(line)); } catch { return {}; } }).filter((entry) => entry.event === "dispute_evidence_not_staged");
    expect(alerts).toEqual([expect.objectContaining({ disputeId: `dp_${refused.order.id}`, orderId: refused.order.id })]);
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
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "order.dispute_resolved", targetId: fixture.order.id } }))
      .toMatchObject({ organisationId: fixture.owner.organisation.id, actorUserId: fixture.owner.user.id, metadata: expect.objectContaining({ reason: "Stripe closed it in our favour." }) });
    // A late event after the restore is history only.
    await reconcileDisputeEvent(signedEvent("charge.dispute.updated", disputeObject(fixture, "won")));
    expect((await orderState(fixture.order.id)).disputeStatus).toBeNull();
    expect((await reviewAs(fixture, { action: "restore_tickets", reason: "Stripe closed it in our favour." })).status).toBe(409);
  });

  test("with two disputes on one charge, the order shows the worse one and restores only when both closed in the society's favour (SEC-024)", async () => {
    const twoDisputes = async () => {
      const fixture = await paidOrder();
      const now: Record<string, string> = {};
      stripe.dispute.mockImplementation(async (id: string) => disputeObject(fixture, now[id], { id }));
      const deliver = async (name: string, status: string) => {
        const id = `${name}_${fixture.order.id}`;
        now[id] = status;
        await reconcileDisputeEvent(signedEvent(status === "needs_response" ? "charge.dispute.created" : "charge.dispute.closed", disputeObject(fixture, status, { id })));
      };
      await deliver("dp_a", "needs_response");
      await deliver("dp_b", "needs_response");
      return { fixture, deliver };
    };

    // A closing in the society's favour (prevented counts) leaves B open: no restore yet.
    const first = await twoDisputes();
    await first.deliver("dp_a", "prevented");
    expect((await orderState(first.fixture.order.id)).disputeStatus).toBe("open");
    expect((await reviewAs(first.fixture, { action: "restore_tickets", reason: "Stripe closed it in our favour." })).status).toBe(409);
    // B's later loss still voids the tickets.
    await first.deliver("dp_b", "lost");
    const lost = await orderState(first.fixture.order.id);
    expect(lost.disputeStatus).toBe("lost");
    expect(lost.tickets.every((ticket) => ticket.validity === "void")).toBe(true);

    // Both won: one restore resolves both.
    const second = await twoDisputes();
    await second.deliver("dp_a", "won");
    await second.deliver("dp_b", "warning_closed");
    expect((await orderState(second.fixture.order.id)).disputeStatus).toBe("won");
    expect((await reviewAs(second.fixture, { action: "restore_tickets", reason: "Stripe closed both in our favour." })).status).toBe(200);
    expect(await prisma.purchaseDispute.count({ where: { orderId: second.fixture.order.id, resolvedAt: null } })).toBe(0);
    expect((await orderState(second.fixture.order.id)).tickets.every((ticket) => ticket.validity === "active")).toBe(true);
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
    // Stripe's report is recorded as no one's step; the review as the staff member's.
    const audit = (action: string) => prisma.auditLog.findFirstOrThrow({ where: { action, targetId: fixture.order.id } });
    expect(await audit("order.external_refund_recorded")).toMatchObject({ organisationId: fixture.owner.organisation.id, actorUserId: null });
    expect(await audit("order.external_refund_reviewed")).toMatchObject({ organisationId: fixture.owner.organisation.id, actorUserId: fixture.owner.user.id });

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
  // PAY-027: Thunderstrux paid the buyer back, so the society's share is owed until Stripe shows it reversed.
  test("a refund in Stripe that didn't reverse the transfer is recorded as owed by the society and alerts once", async () => {
    const fixture = await paidOrder();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    stripe.refunds.mockResolvedValue({ data: [dashboardRefund(fixture, 3000)] });
    stripe.intent.mockResolvedValue({ id: fixture.intentId, latest_charge: { id: fixture.chargeId, amount_refunded: 3000, transfer: "tr_not_reversed" } });
    stripe.transfer.mockResolvedValue({ id: "tr_not_reversed", amount_reversed: 0 });
    await reconcileExternalRefundEvent(signedEvent("refund.created", dashboardRefund(fixture, 3000)));
    await reconcileExternalRefundEvent(signedEvent("refund.updated", dashboardRefund(fixture, 3000)));

    expect(await orderState(fixture.order.id)).toMatchObject({ externalRefundedAmount: 3000, externalUnreversedAmount: 3000, refundStatus: "refunded" });
    const alerts = () => error.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"event":"outside_refund_not_reversed"')).map((line) => JSON.parse(line));
    expect(alerts()).toEqual([expect.objectContaining({ orderId: fixture.order.id, unreversed: 3000 })]);

    // Reversed by hand in Stripe: the next refund event records it, with no new alert.
    stripe.transfer.mockResolvedValue({ id: "tr_not_reversed", amount_reversed: 3000 });
    await reconcileExternalRefundEvent(signedEvent("refund.updated", dashboardRefund(fixture, 3000)));
    expect(await orderState(fixture.order.id)).toMatchObject({ externalUnreversedAmount: 0 });
    expect(alerts()).toHaveLength(1);
  });
});

// PAY-004: Stripe takes a lost dispute from the platform; the refunds worker
// takes it back from the society by reversing the transfer.
describe("lost dispute recovery", () => {
  // The order's transfer to the society, as Stripe holds it.
  function transferIs(fixture: Fixture, extra: Record<string, unknown> = {}) {
    const transferId = `tr_${fixture.order.id}`;
    stripe.charge.mockResolvedValue({ id: fixture.chargeId, transfer: transferId });
    stripe.transfer.mockResolvedValue({ id: transferId, amount: 3000, amount_reversed: 0, currency: "aud", destination: fixture.owner.organisation.stripeAccountId, ...extra });
    stripe.reversals.mockResolvedValue({ data: [] });
    stripe.reverse.mockImplementation(async (_transfer: string, params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("trr"), amount: params.amount, metadata: params.metadata }));
    return transferId;
  }

  async function loseDispute(fixture: Fixture, extra: Record<string, unknown> = {}) {
    stripe.dispute.mockResolvedValue(disputeObject(fixture, "lost", extra));
    await reconcileDisputeEvent(signedEvent("charge.dispute.closed", disputeObject(fixture, "lost", extra)));
  }

  const disputeRow = (fixture: Fixture) => prisma.purchaseDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${fixture.order.id}` } });

  test("a lost dispute is taken back from the society once, by the disputed amount, and recorded", async () => {
    const fixture = await paidOrder();
    const transferId = transferIs(fixture);
    await loseDispute(fixture);
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "pending", reversalAmount: null });

    const now = new Date(Date.now() + 1000);
    expect(await processDisputeReversalBatch(25, now)).toMatchObject({ processed: 1, results: [{ status: "succeeded" }] });
    expect(stripe.reverse).toHaveBeenCalledWith(transferId, { amount: 3000, metadata: { disputeId: `dp_${fixture.order.id}`, orderId: fixture.order.id } }, { idempotencyKey: `dispute-reversal:dp_${fixture.order.id}` });
    const recovered = await disputeRow(fixture);
    expect(recovered).toMatchObject({ reversalStatus: "succeeded", reversalAmount: 3000, reversalProcessingToken: null });
    expect(recovered.stripeTransferReversalId).toMatch(/^trr/);
    expect(await historyOf(fixture.order.id)).toEqual(["dispute_opened", "dispute_closed", "dispute_funds_recovered"]);
    expect(await prisma.auditLog.findFirst({ where: { targetId: fixture.order.id, action: "order.dispute_funds_recovered" } })).toMatchObject({ actorUserId: null, metadata: expect.objectContaining({ amount: 3000 }) });

    // Nothing is sent twice, and a late "lost" event queues nothing new.
    await loseDispute(fixture);
    expect(await processDisputeReversalBatch(25, new Date(Date.now() + 2000))).toMatchObject({ processed: 0 });
    expect(stripe.reverse).toHaveBeenCalledTimes(1);
  });

  test("a won dispute takes nothing back", async () => {
    const fixture = await paidOrder();
    transferIs(fixture);
    stripe.dispute.mockResolvedValue(disputeObject(fixture, "won"));
    await reconcileDisputeEvent(signedEvent("charge.dispute.closed", disputeObject(fixture, "won")));
    expect((await disputeRow(fixture)).reversalStatus).toBeNull();
    expect(await processDisputeReversalBatch(25, new Date(Date.now() + 1000))).toMatchObject({ processed: 0 });
    expect(stripe.reverse).not.toHaveBeenCalled();
  });

  test("only what is left of the transfer is reversed when a refund already took part of it", async () => {
    const fixture = await paidOrder();
    transferIs(fixture, { amount_reversed: 1000 });
    await loseDispute(fixture);
    await processDisputeReversalBatch(25, new Date(Date.now() + 1000));
    expect(stripe.reverse).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ amount: 2000 }), expect.anything());
    expect((await disputeRow(fixture)).reversalAmount).toBe(2000);
  });

  test("a transfer to another account is never reversed; a person is alerted instead", async () => {
    const fixture = await paidOrder();
    transferIs(fixture, { destination: "acct_someone_else" });
    await loseDispute(fixture);
    expect(await processDisputeReversalBatch(25, new Date(Date.now() + 1000))).toMatchObject({ results: [{ status: "failed" }] });
    expect(stripe.reverse).not.toHaveBeenCalled();
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "failed", reversalLastError: "destination_mismatch" });
    expect(await historyOf(fixture.order.id)).toEqual(["dispute_opened", "dispute_closed"]);
  });

  test("an unknown outcome retries later and finds the reversal Stripe already made instead of sending again", async () => {
    const fixture = await paidOrder();
    transferIs(fixture);
    await loseDispute(fixture);
    stripe.reverse.mockRejectedValueOnce(new Error("socket hang up"));
    const first = new Date(Date.now() + 1000);
    expect(await processDisputeReversalBatch(25, first)).toMatchObject({ results: [{ status: "uncertain" }] });
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "uncertain", reversalLastError: "provider_unknown" });
    // Not due again until the retry delay passes.
    expect(await processDisputeReversalBatch(25, first)).toMatchObject({ processed: 0 });

    stripe.reversals.mockResolvedValue({ data: [{ id: "trr_made_by_stripe", amount: 3000, metadata: { disputeId: `dp_${fixture.order.id}`, orderId: fixture.order.id } }] });
    expect(await processDisputeReversalBatch(25, new Date(first.getTime() + 2 * 60_000))).toMatchObject({ results: [{ status: "succeeded" }] });
    expect(stripe.reverse).toHaveBeenCalledTimes(1);
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "succeeded", stripeTransferReversalId: "trr_made_by_stripe", reversalAmount: 3000 });
  });

  // Failure paths (2026-10-26 test audit). Each ends with a person alerted,
  // never with money moved from the wrong place or sent twice.
  const unresolvedAlerts = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls
    .map((call: unknown[]) => JSON.parse(String(call[0])))
    .filter((entry: { event?: string }) => entry.event === "dispute_reversal_unresolved");

  test("a charge Stripe can't load is retried; one with no transfer fails to a person with an alert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = await paidOrder();
    transferIs(fixture);
    await loseDispute(fixture);
    stripe.charge.mockRejectedValueOnce(new Error("socket hang up"));
    const first = new Date(Date.now() + 1000);
    expect(await processDisputeReversalBatch(25, first)).toMatchObject({ results: [{ status: "uncertain" }] });
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "uncertain", reversalLastError: "provider_unknown", reversalAttempts: 1 });

    stripe.charge.mockResolvedValue({ id: fixture.chargeId, transfer: null });
    expect(await processDisputeReversalBatch(25, new Date(first.getTime() + 2 * 60_000))).toMatchObject({ results: [{ status: "failed" }] });
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "failed", reversalLastError: "no_transfer", reversalNextAttemptAt: null, reversalProcessingToken: null });
    expect(unresolvedAlerts(error)).toEqual([expect.objectContaining({ disputeId: `dp_${fixture.order.id}`, orderId: fixture.order.id, reason: "no_transfer" })]);
    expect(stripe.reverse).not.toHaveBeenCalled();
  });

  test("a transfer that refunds already reversed in full leaves nothing to take back", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = await paidOrder();
    transferIs(fixture, { amount_reversed: 3000 });
    await loseDispute(fixture);
    expect(await processDisputeReversalBatch(25, new Date(Date.now() + 1000))).toMatchObject({ results: [{ status: "failed" }] });
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "failed", reversalLastError: "nothing_to_reverse" });
    expect(unresolvedAlerts(error)).toHaveLength(1);
    expect(stripe.reverse).not.toHaveBeenCalled();
  });

  test("a reversal Stripe refuses is failed for a person, not retried", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = await paidOrder();
    transferIs(fixture);
    await loseDispute(fixture);
    stripe.reverse.mockRejectedValue(Object.assign(new Error("Insufficient funds in the connected account"), { type: "StripeInvalidRequestError" }));
    const first = new Date(Date.now() + 1000);
    expect(await processDisputeReversalBatch(25, first)).toMatchObject({ results: [{ status: "failed" }] });
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "failed", reversalLastError: "provider_refused" });
    expect(unresolvedAlerts(error)).toEqual([expect.objectContaining({ reason: "provider_refused" })]);
    expect(await processDisputeReversalBatch(25, new Date(first.getTime() + 60 * 60_000))).toMatchObject({ processed: 0 });
    expect(stripe.reverse).toHaveBeenCalledTimes(1);
    expect(await historyOf(fixture.order.id)).toEqual(["dispute_opened", "dispute_closed"]);
  });

  test("after six unknown outcomes the worker alerts and keeps looking the reversal up at Stripe hourly until it settles (PAY-013)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = await paidOrder();
    transferIs(fixture);
    await loseDispute(fixture);
    await prisma.purchaseDispute.update({
      where: { stripeDisputeId: `dp_${fixture.order.id}` },
      data: { reversalStatus: "uncertain", reversalAttempts: 6, reversalLastError: "provider_unknown" }
    });
    stripe.charge.mockClear();
    stripe.charge.mockRejectedValueOnce(new Error("socket hang up"));
    const now = new Date(Date.now() + 1000);
    expect(await processDisputeReversalBatch(25, now)).toMatchObject({ results: [{ status: "unresolved" }] });
    const row = await disputeRow(fixture);
    expect(row).toMatchObject({ reversalStatus: "uncertain", reversalLastError: "provider_unresolved", reversalProcessingToken: null, reversalAttempts: 7 });
    expect(row.reversalNextAttemptAt).toEqual(new Date(now.getTime() + 60 * 60_000));
    expect(unresolvedAlerts(error)).toEqual([expect.objectContaining({ reason: "provider_unresolved" })]);
    expect(stripe.charge).toHaveBeenCalledTimes(1);
    expect(stripe.reverse).not.toHaveBeenCalled();

    // An hour later Stripe answers, and the reversal an earlier attempt made is found, not sent again.
    stripe.reversals.mockResolvedValue({ data: [{ id: "trr_late", amount: 3000, metadata: { disputeId: `dp_${fixture.order.id}`, orderId: fixture.order.id } }] });
    expect(await processDisputeReversalBatch(25, new Date(now.getTime() + 60 * 60_000))).toMatchObject({ results: [{ status: "succeeded" }] });
    expect(stripe.reverse).not.toHaveBeenCalled();
    expect(await disputeRow(fixture)).toMatchObject({ reversalStatus: "succeeded", stripeTransferReversalId: "trr_late" });
  });
});
