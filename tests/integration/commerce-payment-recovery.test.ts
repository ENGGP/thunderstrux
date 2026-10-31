import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import StaffMerchandiseOrderPage from "@/app/(dashboard)/dashboard/merchandise/orders/[orderId]/page";
import { POST as reviewRoute } from "@/app/api/orders/[orderId]/review/route";
import { POST as pickupRoute } from "@/app/api/orgs/[orgSlug]/merchandise/pickups/[orderId]/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import MembershipOrderPage from "@/app/memberships/orders/[orderId]/page";
import MerchandiseOrderPage from "@/app/merchandise/orders/[orderId]/page";
import { StripeReviewNotice } from "@/components/commerce/stripe-review-notice";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { reconcileCommerceCheckoutSession } from "@/lib/commerce/reconciliation";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { listPickups } from "@/lib/merchandise/pickups";
import { processDisputeReversalBatch } from "@/lib/payments/dispute-reversals";
import { openCommerceRefund, orderReference, processOrderRefundBatch, requestCommerceRefund } from "@/lib/payments/order-refunds";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createMember, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// PAY-003: disputes and refunds made in the Stripe dashboard on membership and
// merchandise orders, and the automatic refund of a payment that couldn't be filled.

const webhookSecret = "whsec_commerce_recovery_test";
const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), refunds: vi.fn(), create: vi.fn(), dispute: vi.fn(), disputeUpdate: vi.fn(), charge: vi.fn(), transfer: vi.fn(), reversals: vi.fn(), reverse: vi.fn(), intent: vi.fn() }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => "whsec_commerce_recovery_test",
    getStripe: () => ({
      checkout: { sessions: { retrieve: stripe.retrieve, list: stripe.list } },
      refunds: { list: stripe.refunds, create: stripe.create },
      disputes: { retrieve: stripe.dispute, update: stripe.disputeUpdate },
      charges: { retrieve: stripe.charge },
      paymentIntents: { retrieve: stripe.intent },
      transfers: { retrieve: stripe.transfer, listReversals: stripe.reversals, createReversal: stripe.reverse },
      webhooks: new RealStripe("sk_test_commerce_recovery").webhooks
    })
  };
});

vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), usePathname: () => "/dashboard/merchandise/orders", useRouter: () => ({ refresh: () => undefined }) }));

beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });
afterEach(() => { for (const mock of Object.values(stripe)) mock.mockReset(); });

const day = 86_400_000;

// A society's paid membership ($15.00) or merchandise order ($30.00), as the
// webhook leaves it, and a Stripe that agrees about its payment.
async function paid(kind: "membership" | "merchandise") {
  const society = await createOrganisationAccount({ stripeReady: true });
  const organisationId = society.organisation.id;
  const buyer = await createMember();
  const now = new Date();
  let order;
  let grantId: string | null = null;
  if (kind === "membership") {
    const term = { startsAt: new Date(Date.now() - day), endsAt: new Date(Date.now() + 100 * day) };
    const plan = await prisma.membershipProduct.create({ data: { organisationId, name: "Semester 2", priceAmount: 1500, ...term, entitlements: ["member_prices"], status: "published", publishedAt: now } });
    order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId, kind, buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 150, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 1500, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
    }));
    order = await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, stripeSessionId: unique("cs") } });
    const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
    grantId = (await prisma.membershipGrant.create({ data: { userId: buyer.id, organisationId, membershipProductId: plan.id, commerceOrderLineId: line.id, ...term, entitlements: plan.entitlements, entitlementVersion: 1 } })).id;
  } else {
    const product = await prisma.merchandiseProduct.create({ data: { organisationId, name: "Hoodie", status: "published", publishedAt: now, firstPublishedAt: now } });
    const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId, sku: unique("HOOD").toUpperCase(), priceAmount: 1500, remaining: 5 } });
    order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId, kind, buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 300, source: "checkout",
      lines: [{ quantity: 2, unitAmount: 1500, name: "Hoodie", merchandiseVariantId: variant.id }]
    }));
    order = await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, pickupStatus: "pending", stripeSessionId: unique("cs") } });
  }
  const intentId = unique("pi");
  const chargeId = unique("ch");
  stripe.list.mockResolvedValue({ data: [{ id: order.stripeSessionId, metadata: { family: kind, commerceOrderId: order.id } }] });
  stripe.retrieve.mockResolvedValue({
    payment_status: "paid", amount_total: order.totalAmount, currency: "aud", metadata: { family: kind, commerceOrderId: order.id, organisationId },
    payment_intent: { id: intentId, currency: "aud", amount_received: order.totalAmount, transfer_data: { destination: society.organisation.stripeAccountId }, latest_charge: { id: chargeId, disputed: false } }
  });
  stripe.refunds.mockResolvedValue({ data: [] });
  // Refunds Thunderstrux sends reverse the transfer, so nothing is owed back by default (PAY-027).
  stripe.intent.mockResolvedValue({ id: intentId, latest_charge: null });
  setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
  return { society, buyer, order, grantId, intentId, chargeId };
}
type Fixture = Awaited<ReturnType<typeof paid>>;

const signedEvent = (type: string, object: unknown) =>
  ({ id: unique("evt"), object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } }) as unknown as Stripe.Event;

async function postSigned(event: Stripe.Event) {
  const body = JSON.stringify(event);
  const signature = new Stripe("sk_test_commerce_recovery").webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  return webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

const dispute = (fixture: Fixture, status: string) => ({
  id: `dp_${fixture.order.id}`, object: "dispute", charge: fixture.chargeId, payment_intent: fixture.intentId, amount: fixture.order.totalAmount, currency: "aud",
  status, reason: "fraudulent", evidence_details: { due_by: Math.floor(Date.UTC(2026, 10, 20) / 1000) }
});
// Stripe's dispute as it stands now, then its event delivered.
async function disputeIs(fixture: Fixture, status: string, type = "charge.dispute.updated") {
  stripe.dispute.mockResolvedValue(dispute(fixture, status));
  expect((await postSigned(signedEvent(type, dispute(fixture, status)))).status).toBe(200);
}
const outsideRefund = (fixture: Fixture, amount: number) => ({ id: unique("re"), object: "refund", status: "succeeded", amount, currency: "aud", payment_intent: fixture.intentId, metadata: {} });

const order = (id: string) => prisma.commerceOrder.findUniqueOrThrow({ where: { id } });
const historyOf = async (commerceOrderId: string) => (await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId }, orderBy: { sequence: "asc" } })).map((event) => event.type);
const grantOf = (fixture: Fixture) => prisma.membershipGrant.findUniqueOrThrow({ where: { id: fixture.grantId as string } });
const refundInput = (fixture: Fixture) => ({
  organisationId: fixture.society.organisation.id, commerceOrderId: fixture.order.id, actor: { id: fixture.society.user.id },
  reason: "Refunding what is left of the order.", confirmation: orderReference(fixture.order.id)
});

describe("commerce disputes", () => {
  test("a membership's dispute pauses refunds and keeps the membership; replays change nothing; losing it ends the membership", async () => {
    const fixture = await paid("membership");
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    const replay = signedEvent("charge.dispute.created", dispute(fixture, "needs_response"));
    await postSigned(replay);
    await postSigned(replay);

    const disputed = await order(fixture.order.id);
    expect(disputed).toMatchObject({ status: "paid", disputeStatus: "open", stripePaymentIntentId: fixture.intentId });
    expect(ticketOrderProjection(disputed)).toBe("disputed");
    expect(await prisma.purchaseDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${fixture.order.id}` } })).toMatchObject({
      orderId: null, commerceOrderId: fixture.order.id, organisationId: fixture.society.organisation.id, stripeChargeId: fixture.chargeId, evidenceDueBy: new Date(Date.UTC(2026, 10, 20))
    });
    expect((await grantOf(fixture)).revokedAt).toBeNull();
    // A draft answer is staged once for the operator to submit.
    expect(stripe.disputeUpdate).toHaveBeenCalledTimes(1);
    expect(stripe.disputeUpdate).toHaveBeenCalledWith(`dp_${fixture.order.id}`, expect.objectContaining({
      submit: false,
      evidence: expect.objectContaining({ customer_email_address: fixture.order.buyerEmailSnapshot, uncategorized_text: expect.stringContaining(`Order ${orderReference(fixture.order.id)}`) })
    }));
    await expect(requestCommerceRefund(refundInput(fixture))).rejects.toMatchObject({ kind: "disputed" });
    expect(stripe.create).not.toHaveBeenCalled();

    await disputeIs(fixture, "lost", "charge.dispute.closed");
    expect(await order(fixture.order.id)).toMatchObject({ disputeStatus: "lost" });
    expect((await grantOf(fixture)).revocationReason).toBe("The buyer's bank returned the payment after a dispute");
    expect(await historyOf(fixture.order.id)).toEqual(["order_created", "dispute_opened", "dispute_closed"]);
    expect((await prisma.auditLog.findMany({ where: { targetId: fixture.order.id }, orderBy: { createdAt: "asc" } })).map((row) => row.action)).toEqual(["commerce_order.dispute_opened", "commerce_order.dispute_lost"]);
    // Ticket handling never saw it.
    expect(await prisma.order.count({ where: { disputeStatus: { not: null }, organisationId: fixture.society.organisation.id } })).toBe(0);

    // PAY-004: the refunds worker takes the lost $15.00 back from the society's transfer.
    stripe.charge.mockResolvedValue({ id: fixture.chargeId, transfer: "tr_membership" });
    stripe.transfer.mockResolvedValue({ id: "tr_membership", amount: 1500, amount_reversed: 0, currency: "aud", destination: fixture.society.organisation.stripeAccountId });
    stripe.reversals.mockResolvedValue({ data: [] });
    stripe.reverse.mockResolvedValue({ id: "trr_membership", amount: 1500, metadata: {} });
    expect(await processDisputeReversalBatch(25, new Date(Date.now() + 1000))).toMatchObject({ results: [{ status: "succeeded" }] });
    expect(stripe.reverse).toHaveBeenCalledWith("tr_membership", { amount: 1500, metadata: { disputeId: `dp_${fixture.order.id}`, commerceOrderId: fixture.order.id } }, { idempotencyKey: `dispute-reversal:dp_${fixture.order.id}` });
    expect(await historyOf(fixture.order.id)).toEqual(["order_created", "dispute_opened", "dispute_closed", "dispute_funds_recovered"]);
    expect(await prisma.auditLog.findFirst({ where: { targetId: fixture.order.id, action: "commerce_order.dispute_funds_recovered" } })).toMatchObject({ targetType: "CommerceOrder" });
  });

  test("a disputed merchandise order can't be handed over and waits under Review; a won dispute clears it", async () => {
    const fixture = await paid("merchandise");
    const slug = fixture.society.organisation.slug;
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    const handOver = await pickupRoute(jsonRequest(`http://localhost:3000/api/orgs/${slug}/merchandise/pickups/${fixture.order.id}`, { step: "ready", expectedVersion: fixture.order.version }), routeContext({ orgSlug: slug, orderId: fixture.order.id }));
    expect(handOver.status).toBe(409);
    expect((await order(fixture.order.id)).pickupStatus).toBe("pending");
    const review = await listPickups(fixture.society.organisation.id, { stage: "review" });
    expect(review.orders.map((row) => row.id)).toEqual([fixture.order.id]);
    expect((await listPickups(fixture.society.organisation.id, { stage: "prepare" })).orders).toEqual([]);

    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await order(fixture.order.id)).toMatchObject({ disputeStatus: null, refundStatus: null });
    expect((await prisma.purchaseDispute.findUniqueOrThrow({ where: { stripeDisputeId: `dp_${fixture.order.id}` } })).closedAt).not.toBeNull();
    expect((await listPickups(fixture.society.organisation.id, { stage: "prepare" })).orders.map((row) => row.id)).toEqual([fixture.order.id]);
  });

  test("dispute and refund events that don't verify as the order's payment change nothing; each dispute alerts a person", async () => {
    const fixture = await paid("membership");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await order(fixture.order.id);
    const verified = await stripe.retrieve();
    const cases: Array<[string, object, object?]> = [
      ["another charge on the same payment", {}, { charge: "ch_other" }],
      ["a Session naming another order", { metadata: { ...verified.metadata, commerceOrderId: "another-order" } }],
      ["money sent to another account", { payment_intent: { ...verified.payment_intent, transfer_data: { destination: "acct_someone_else" } } }]
    ];
    for (const [why, session, disputed] of cases) {
      stripe.retrieve.mockResolvedValue({ ...verified, ...session });
      expect((await postSigned(signedEvent("charge.dispute.created", { ...dispute(fixture, "needs_response"), ...disputed }))).status, why).toBe(200);
      // A refund names no charge, so it is checked only against the payment.
      if (!disputed) expect((await postSigned(signedEvent("refund.created", outsideRefund(fixture, 1500)))).status, why).toBe(200);
    }
    expect(stripe.dispute).not.toHaveBeenCalled();
    expect(stripe.refunds).not.toHaveBeenCalled();
    expect(await order(fixture.order.id)).toEqual(before);
    expect(await historyOf(fixture.order.id)).toEqual(["order_created"]);
    expect(await prisma.purchaseDispute.count({ where: { commerceOrderId: fixture.order.id } })).toBe(0);
    expect((await grantOf(fixture)).revokedAt).toBeNull();
    expect(error.mock.calls.filter(([line]) => String(line).includes('"event":"purchase_dispute_unmatched"'))).toHaveLength(3);
  });
});

describe("commerce refunds made in Stripe", () => {
  test("a partial refund is flagged until reviewed, and a refund here takes only the rest", async () => {
    const fixture = await paid("membership");
    const partial = outsideRefund(fixture, 500);
    stripe.refunds.mockResolvedValue({ data: [partial] });
    expect((await postSigned(signedEvent("refund.created", partial))).status).toBe(200);

    const flagged = await order(fixture.order.id);
    expect(flagged).toMatchObject({ externalRefundedAmount: 500, externalRefundReviewedAt: null, refundStatus: null });
    expect(ticketOrderProjection(flagged)).toBe("review");
    expect((await grantOf(fixture)).revokedAt).toBeNull();

    const reviewed = await reviewRoute(jsonRequest(`http://localhost:3000/api/orders/${fixture.order.id}/review`, { action: "mark_reviewed" }), routeContext({ orderId: fixture.order.id }));
    expect(reviewed.status).toBe(200);
    expect(ticketOrderProjection(await order(fixture.order.id))).toBe("paid");

    stripe.create.mockImplementation(async (params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: params.amount, currency: "aud", payment_intent: fixture.intentId, metadata: params.metadata }));
    expect(await requestCommerceRefund(refundInput(fixture))).toMatchObject({ status: "succeeded" });
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ amount: 1000, payment_intent: fixture.intentId });
    expect(await order(fixture.order.id)).toMatchObject({ refundStatus: "refunded" });
    expect(await historyOf(fixture.order.id)).toEqual(["order_created", "external_refund_recorded", "external_refund_reviewed", "refund_requested", "refunded"]);
    expect((await prisma.auditLog.findMany({ where: { targetId: fixture.order.id }, orderBy: { createdAt: "asc" } })).map((row) => [row.action, row.actorUserId])).toEqual([
      ["commerce_order.external_refund_recorded", null],
      ["commerce_order.external_refund_reviewed", fixture.society.user.id],
      ["commerce_order.refund_requested", fixture.society.user.id],
      ["commerce_order.refund_succeeded", null]
    ]);
  });

  test("a full refund in Stripe ends the membership once, however often it is delivered", async () => {
    const fixture = await paid("membership");
    const full = outsideRefund(fixture, 1500);
    stripe.refunds.mockResolvedValue({ data: [full] });
    await postSigned(signedEvent("refund.created", full));
    await postSigned(signedEvent("refund.updated", full));

    expect(await order(fixture.order.id)).toMatchObject({ externalRefundedAmount: 1500, refundStatus: "refunded", status: "paid" });
    expect((await grantOf(fixture)).revocationReason).toBe("Refunded in Stripe");
    expect(await historyOf(fixture.order.id)).toEqual(["order_created", "external_refund_recorded"]);
  });

  // PAY-027: Thunderstrux paid the buyer back, so the society's share is owed until Stripe shows it reversed.
  test("a refund in Stripe that didn't reverse the transfer is recorded as owed by the society and alerts", async () => {
    const fixture = await paid("merchandise");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const part = outsideRefund(fixture, 1000);
    stripe.refunds.mockResolvedValue({ data: [part] });
    stripe.intent.mockResolvedValue({ id: fixture.intentId, latest_charge: { id: fixture.chargeId, amount_refunded: 1000, transfer: "tr_merch" } });
    stripe.transfer.mockResolvedValue({ id: "tr_merch", amount_reversed: 0 });
    await postSigned(signedEvent("refund.created", part));

    expect(await order(fixture.order.id)).toMatchObject({ externalRefundedAmount: 1000, externalUnreversedAmount: 1000 });
    expect(error.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"event":"outside_refund_not_reversed"')).map((line) => JSON.parse(line)))
      .toEqual([expect.objectContaining({ commerceOrderId: fixture.order.id, unreversed: 1000 })]);
  });
});

describe("commerce compensation", () => {
  const compensation = (fixture: Fixture) => ({
    organisationId: fixture.society.organisation.id, commerceOrderId: fixture.order.id, actor: null, reason: "Paid but couldn't be filled (sold_out)", compensation: "sold_out"
  });
  // A paid Session for an order still pending, as a late webhook finds it.
  const pendingWith = async (fixture: Fixture, data: { disputeStatus?: "open" | "lost" | "won" } = {}) => {
    await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { status: "pending", paidAt: null, fulfilledAt: null, pickupStatus: null, ...data } });
    return {
      id: fixture.order.stripeSessionId, payment_status: "paid", amount_total: fixture.order.totalAmount, currency: "aud",
      metadata: { family: fixture.order.kind, commerceOrderId: fixture.order.id, organisationId: fixture.society.organisation.id },
      payment_intent: { id: fixture.intentId, transfer_data: { destination: fixture.society.organisation.stripeAccountId } }
    } as unknown as Stripe.Checkout.Session;
  };

  // PAY-038: part already refunded in Stripe; compensation refunds only the rest.
  test("compensation after a partial refund in Stripe refunds only what is left, and nothing once it is all back", async () => {
    const fixture = await paid("merchandise");
    await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { externalRefundedAmount: 1000 } });
    await prisma.$transaction((tx) => openCommerceRefund(tx, compensation(fixture)));
    expect(await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } })).toMatchObject({ amount: fixture.order.totalAmount - 1000 });

    const all = await paid("membership");
    await prisma.commerceOrder.update({ where: { id: all.order.id }, data: { externalRefundedAmount: all.order.totalAmount } });
    await expect(prisma.$transaction((tx) => openCommerceRefund(tx, compensation(all)))).rejects.toMatchObject({ kind: "not_refundable" });
    expect(await prisma.refundRequest.count({ where: { commerceOrderId: all.order.id } })).toBe(0);
  });

  // A buyer who paid for an order that couldn't be filled gets the money back, though it
  // is none of what a refund of a sale needs: paid, fulfilled, clear of review, bound to a Session.
  test("the checks on a sale never reach a compensation refund", async () => {
    const fixture = await paid("merchandise");
    await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { status: "failed", fulfilledAt: null, pickupStatus: null, requiresCompensationReview: true, reviewReason: "sold_out", stripeSessionId: null } });
    await prisma.$transaction((tx) => openCommerceRefund(tx, compensation(fixture)));
    expect(await prisma.refundRequest.findMany({ where: { commerceOrderId: fixture.order.id } })).toEqual([expect.objectContaining({ amount: 3000, status: "pending", attempts: 0, processingToken: null, actorUserId: null, operationKey: expect.stringMatching(new RegExp(`^commerce-compensation:${fixture.order.id}:`)) })]);
    expect(await order(fixture.order.id)).toMatchObject({ refundStatus: "processing" });
    expect(await prisma.commerceLifecycleEvent.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id, type: "refund_requested" } })).toMatchObject({ source: "stripe_webhook", actorUserId: null, reason: "compensation", facts: { amount: 3000 } });
    expect(await prisma.auditLog.findMany({ where: { targetId: fixture.order.id }, select: { action: true, actorUserId: true, targetType: true, metadata: true } })).toEqual([
      { action: "commerce_order.compensation_refund_queued", actorUserId: null, targetType: "CommerceOrder", metadata: { amount: 3000, reason: "sold_out" } }
    ]);
  });

  // PAY-036: Stripe refuses a refund of a disputed charge, and a lost one is already back with the buyer.
  test("an open or lost dispute holds the compensation refund and the order stays under review; a won one doesn't", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const disputeStatus of ["open", "lost"] as const) {
      const fixture = await paid("merchandise");
      expect(await reconcileCommerceCheckoutSession(await pendingWith(fixture, { disputeStatus }), { stripeEventId: unique("evt") })).toMatchObject({ status: "compensation_required" });
      expect(await prisma.refundRequest.count({ where: { commerceOrderId: fixture.order.id } })).toBe(0);
      expect(await order(fixture.order.id)).toMatchObject({ status: "failed", requiresCompensationReview: true, reviewReason: "refunded_or_disputed_before_fulfilment", refundStatus: null, disputeStatus });
      expect(await historyOf(fixture.order.id)).toEqual(["order_created", "compensation_required"]);
    }
    expect(warn.mock.calls.filter(([line]) => String(line).includes("commerce.compensation_refund.not_opened"))).toHaveLength(2);
    const won = await paid("merchandise");
    await reconcileCommerceCheckoutSession(await pendingWith(won, { disputeStatus: "won" }), { stripeEventId: unique("evt") });
    expect(await prisma.refundRequest.count({ where: { commerceOrderId: won.order.id } })).toBe(1);
    expect(await order(won.order.id)).toMatchObject({ requiresCompensationReview: true, refundStatus: "processing" });
  });

  // PAY-056: a dispute that reached the order before its late paid webhook, as Stripe delivers them.
  const heldByDispute = async (kind: "membership" | "merchandise" = "merchandise") => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await paid(kind);
    if (fixture.grantId) await prisma.membershipGrant.delete({ where: { id: fixture.grantId } });
    const session = await pendingWith(fixture);
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    expect(await reconcileCommerceCheckoutSession(session, { stripeEventId: unique("evt") })).toMatchObject({ status: "compensation_required" });
    return fixture;
  };
  const requests = (fixture: Fixture) => prisma.refundRequest.findMany({ where: { commerceOrderId: fixture.order.id } });
  const refundSucceeds = (fixture: Fixture) => stripe.create.mockImplementation(async (params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: params.amount, currency: "aud", payment_intent: fixture.intentId, metadata: params.metadata }));
  const reviewNotice = async (fixture: Fixture) => {
    const notice = await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: `payment-review/${fixture.order.id}` } });
    return JSON.stringify(decryptNotification(notice.encryptedPayload, notice.id));
  };
  // The buyer's order page, signed in as that buyer.
  const buyerPage = async (fixture: Fixture) => {
    setMockSession({ userId: fixture.buyer.id, email: fixture.buyer.email, accountRole: "member" });
    const props = { params: Promise.resolve({ orderId: fixture.order.id }), searchParams: Promise.resolve({}) };
    return renderPage(await (fixture.order.kind === "membership" ? MembershipOrderPage(props) : MerchandiseOrderPage(props)));
  };

  // What staff read about a dispute: the notice as the order page fills it.
  const staffNotice = async (fixture: Fixture) => {
    const [current, row] = await Promise.all([order(fixture.order.id), prisma.purchaseDispute.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } })]);
    return renderPage(StripeReviewNotice({ orderId: fixture.order.id, kind: "merchandise", canAct: false, review: { ...current, dispute: row } }));
  };

  test("a charge the bank is disputing or that was refunded never reads as nothing charged", async () => {
    for (const kind of ["merchandise", "membership"] as const) {
      const fixture = await paid(kind);
      if (fixture.grantId) await prisma.membershipGrant.delete({ where: { id: fixture.grantId } });
      await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { status: "expired", fulfilledAt: null, pickupStatus: null, disputeStatus: "open" } });
      expect(await buyerPage(fixture)).not.toContain("No payment taken");
      await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { disputeStatus: null, externalRefundedAmount: 500 } });
      expect(await buyerPage(fixture)).not.toContain("No payment taken");
      // The same order with nothing on it took no money.
      await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { externalRefundedAmount: 0 } });
      expect(await buyerPage(fixture)).toContain("No payment taken");
    }
  });

  test("the staff review notice says what a dispute means for a payment under review", async () => {
    const fixture = await heldByDispute();
    setMockSession({ userId: fixture.society.user.id, email: fixture.society.user.email, accountRole: "organisation" });
    const staffPage = async () => renderPage(await StaffMerchandiseOrderPage({ params: Promise.resolve({ orderId: fixture.order.id }) }));
    const open = await staffPage();
    expect(open).toContain("Stripe refuses a refund during a dispute");
    expect(open).not.toContain("finance sorts it out");
    // The refund it held is on its way.
    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await staffPage()).not.toContain("Stripe refuses a refund during a dispute");
  });

  test("winning the dispute opens the refund it held, once, and the worker sends it", async () => {
    const fixture = await heldByDispute();
    expect(await requests(fixture)).toEqual([]);

    const won = signedEvent("charge.dispute.closed", dispute(fixture, "won"));
    stripe.dispute.mockResolvedValue(dispute(fixture, "won"));
    // Two of Stripe's events at once, then one of them again.
    await Promise.all([postSigned(won), postSigned(signedEvent("charge.dispute.updated", dispute(fixture, "won")))]);
    await postSigned(won);
    expect(await requests(fixture)).toEqual([expect.objectContaining({ amount: 3000, status: "pending", actorUserId: null, operationKey: expect.stringMatching(/^commerce-compensation:/) })]);
    expect(await order(fixture.order.id)).toMatchObject({ disputeStatus: null, requiresCompensationReview: true, refundStatus: "processing" });
    expect(await buyerPage(fixture)).toContain("We&#x27;re refunding your payment");
    expect(await staffNotice(fixture)).toContain("closed the dispute in the society");
    expect(await staffNotice(fixture)).not.toContain("kept the payment");

    refundSucceeds(fixture);
    await processOrderRefundBatch();
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ amount: 3000, reverse_transfer: true, refund_application_fee: true });
    expect(await order(fixture.order.id)).toMatchObject({ status: "failed", requiresCompensationReview: false, refundStatus: "refunded" });
    expect(await historyOf(fixture.order.id)).toEqual(["order_created", "dispute_opened", "compensation_required", "dispute_closed", "refund_requested", "refunded"]);
    expect(await prisma.auditLog.count({ where: { targetId: fixture.order.id, action: "commerce_order.compensation_refund_queued" } })).toBe(1);
    // The buyer paid and was repaid: the end of this path never reads as nothing charged.
    for (const kind of [fixture, await heldByDispute("membership")]) {
      if (kind !== fixture) {
        await disputeIs(kind, "won", "charge.dispute.closed");
        refundSucceeds(kind);
        await processOrderRefundBatch();
      }
      const refunded = await buyerPage(kind);
      expect(refunded).toContain("refunded to your card");
      expect(refunded).not.toContain("No payment taken");
    }
  });

  test("a won dispute opens nothing while another dispute is open, after a lost one, or beside a refund already queued", async () => {
    const two = await heldByDispute();
    const second = { ...dispute(two, "needs_response"), id: `dp_second_${two.order.id}` };
    stripe.dispute.mockResolvedValue(second);
    await postSigned(signedEvent("charge.dispute.created", second));
    await disputeIs(two, "won", "charge.dispute.closed");
    expect(await requests(two)).toEqual([]);
    expect(await order(two.order.id)).toMatchObject({ disputeStatus: "open", refundStatus: null, requiresCompensationReview: true });
    // The last dispute closing the society's way releases it.
    stripe.dispute.mockResolvedValue({ ...second, status: "won" });
    await postSigned(signedEvent("charge.dispute.closed", { ...second, status: "won" }));
    expect(await requests(two)).toHaveLength(1);

    const lost = await heldByDispute();
    await disputeIs(lost, "lost", "charge.dispute.closed");
    expect(await requests(lost)).toEqual([]);
    expect(await order(lost.order.id)).toMatchObject({ disputeStatus: "lost", refundStatus: null, requiresCompensationReview: true });

    // Queued before the dispute opened: the fence keeps it to one refund.
    const queued = await paid("merchandise");
    await prisma.commerceOrder.update({ where: { id: queued.order.id }, data: { status: "failed", fulfilledAt: null, pickupStatus: null, requiresCompensationReview: true, reviewReason: "sold_out" } });
    await prisma.$transaction((tx) => openCommerceRefund(tx, compensation(queued)));
    await disputeIs(queued, "needs_response", "charge.dispute.created");
    await disputeIs(queued, "won", "charge.dispute.closed");
    expect(await requests(queued)).toHaveLength(1);
    expect(await order(queued.order.id)).toMatchObject({ refundStatus: "processing", disputeStatus: null });
  });

  // No refund can open during a dispute, and a lost one is already back with the buyer.
  test("a buyer whose refund a dispute holds isn't told one is coming, on the notice or the order page", async () => {
    for (const kind of ["merchandise", "membership"] as const) {
      const open = await heldByDispute(kind);
      expect(await reviewNotice(open)).toContain("Your bank has disputed this payment");
      expect(await reviewNotice(open)).not.toContain("refunding");
      const page = await buyerPage(open);
      expect(page).toContain("Your bank has disputed this payment");
      expect(page).not.toContain("refunding");
      expect(page).not.toContain("No payment taken");

      const lost = await heldByDispute(kind);
      await disputeIs(lost, "lost", "charge.dispute.closed");
      const returned = await buyerPage(lost);
      expect(returned).toContain("Refunded by your bank");
      expect(returned).not.toContain("refunding");

      const settled = await paid(kind);
      if (settled.grantId) await prisma.membershipGrant.delete({ where: { id: settled.grantId } });
      const session = await pendingWith(settled, { disputeStatus: "lost" });
      await reconcileCommerceCheckoutSession(session, { stripeEventId: unique("evt") });
      expect(await reviewNotice(settled)).toContain("returned the payment to you");
      expect(await reviewNotice(settled)).not.toContain("refunding");
    }
  });

  // A payment under review is a payment taken, whichever page the buyer lands on.
  test("a refund on its way reads as one on both order pages", async () => {
    for (const kind of ["merchandise", "membership"] as const) {
      const fixture = await paid(kind);
      if (fixture.grantId) await prisma.membershipGrant.delete({ where: { id: fixture.grantId } });
      await reconcileCommerceCheckoutSession(await pendingWith(fixture, { disputeStatus: "won" }), { stripeEventId: unique("evt") });
      const page = await buyerPage(fixture);
      expect(page).toContain("We&#x27;re refunding your payment");
      expect(page).not.toContain("No payment taken");
      expect(await reviewNotice(fixture)).toContain("refunding the full amount");
    }
  });

  test("a staff refund keeps its lease, actor, history and audit row", async () => {
    const fixture = await paid("membership");
    stripe.create.mockImplementation(async (params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: params.amount, currency: "aud", payment_intent: fixture.intentId, metadata: params.metadata }));
    const { reason } = refundInput(fixture);
    await requestCommerceRefund(refundInput(fixture));
    const request = await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } });
    expect(request).toMatchObject({ amount: 1500, attempts: 1, actorUserId: fixture.society.user.id, reason, operationKey: expect.stringMatching(/^commerce-refund:/) });
    expect(await prisma.commerceLifecycleEvent.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id, type: "refund_requested" } })).toMatchObject({ source: "staff_action", actorUserId: fixture.society.user.id, reason, facts: { amount: 1500 } });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { targetId: fixture.order.id, action: "commerce_order.refund_requested" } })).toMatchObject({ actorUserId: fixture.society.user.id, targetType: "CommerceOrder", metadata: { refundRequestId: request.id, amount: 1500, reason } });
  });

  test("a payment for an order that had already expired is refunded in full automatically, through the refund worker", async () => {
    const fixture = await paid("merchandise");
    await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { status: "expired", paidAt: null, fulfilledAt: null, pickupStatus: null } });
    const session = {
      id: fixture.order.stripeSessionId, payment_status: "paid", amount_total: 3000, currency: "aud",
      metadata: { family: "merchandise", commerceOrderId: fixture.order.id, organisationId: fixture.society.organisation.id },
      payment_intent: { id: fixture.intentId, transfer_data: { destination: fixture.society.organisation.stripeAccountId } }
    } as unknown as Stripe.Checkout.Session;
    expect(await reconcileCommerceCheckoutSession(session, { stripeEventId: unique("evt") })).toMatchObject({ status: "compensation_required" });

    const queued = await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } });
    expect(queued).toMatchObject({ actorUserId: null, amount: 3000, status: "pending", destinationAccountId: fixture.society.organisation.stripeAccountId });
    expect(await order(fixture.order.id)).toMatchObject({ status: "failed", requiresCompensationReview: true, refundStatus: "processing" });
    const notice = await prisma.notificationOutbox.findFirstOrThrow({ where: { eventKey: `payment-review/${fixture.order.id}` } });
    expect(notice.template).toBe("business_notice");

    stripe.create.mockImplementation(async (params: { amount: number; metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: params.amount, currency: "aud", payment_intent: fixture.intentId, metadata: params.metadata }));
    await processOrderRefundBatch();
    expect(stripe.create.mock.calls[0][0]).toMatchObject({ amount: 3000, reverse_transfer: true, refund_application_fee: true, metadata: { refundRequestId: queued.id, commerceOrderId: fixture.order.id } });
    expect(await order(fixture.order.id)).toMatchObject({ status: "failed", requiresCompensationReview: false, refundStatus: "refunded" });
    expect(await historyOf(fixture.order.id)).toEqual(["order_created", "compensation_required", "refund_requested", "refunded"]);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { targetId: fixture.order.id, action: "commerce_order.compensation_refund_queued" } })).actorUserId).toBeNull();
  });
});
