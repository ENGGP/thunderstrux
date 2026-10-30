import Stripe from "stripe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { fraudRefundReason } from "@/lib/payments/fraud-warnings";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// PAY-023: an actionable early fraud warning on an order nobody has used is
// refunded in full through the refunds worker; anything else alerts a person.

const webhookSecret = "whsec_fraud_warnings_test";
const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), warning: vi.fn() }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => "whsec_fraud_warnings_test",
    getStripe: () => ({
      checkout: { sessions: { retrieve: stripe.retrieve, list: stripe.list } },
      radar: { earlyFraudWarnings: { retrieve: stripe.warning } },
      webhooks: new RealStripe("sk_test_fraud_warnings").webhooks
    })
  };
});

afterEach(() => { for (const mock of Object.values(stripe)) mock.mockReset(); });

// A paid two-ticket order ($30.00) and a Stripe that agrees about its payment.
async function ticketOrder() {
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
    payment_intent: { id: intentId, currency: "aud", amount_received: 3000, transfer_data: { destination: owner.organisation.stripeAccountId }, latest_charge: { id: chargeId } }
  });
  return { owner, order, intentId, chargeId };
}

// A paid membership ($15.00) or merchandise order ($30.00), as the webhook leaves it.
async function commerceOrder(kind: "membership" | "merchandise", extra: { pickupStatus?: "pending" | "collected" } = {}) {
  const society = await createOrganisationAccount({ stripeReady: true });
  const organisationId = society.organisation.id;
  const buyer = await createMember();
  const now = new Date();
  const day = 86_400_000;
  const line = kind === "membership"
    ? { quantity: 1, unitAmount: 1500, name: "Semester 2", termStartsAt: new Date(now.getTime() - day), termEndsAt: new Date(now.getTime() + 100 * day),
        membershipProductId: (await prisma.membershipProduct.create({ data: { organisationId, name: "Semester 2", priceAmount: 1500, startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 100 * day), entitlements: [], status: "published", publishedAt: now } })).id }
    : { quantity: 2, unitAmount: 1500, name: "Hoodie",
        merchandiseVariantId: (await prisma.merchandiseVariant.create({ data: { productId: (await prisma.merchandiseProduct.create({ data: { organisationId, name: "Hoodie", status: "published", publishedAt: now, firstPublishedAt: now } })).id, organisationId, sku: unique("HOOD").toUpperCase(), priceAmount: 1500, remaining: 5 } })).id };
  const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId, kind, buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 150, source: "checkout", lines: [line]
  }));
  const order = await prisma.commerceOrder.update({
    where: { id: created.id },
    data: { status: "paid", paidAt: now, fulfilledAt: now, stripeSessionId: unique("cs"), ...(kind === "merchandise" ? { pickupStatus: extra.pickupStatus ?? "pending" } : {}) }
  });
  const intentId = unique("pi");
  const chargeId = unique("ch");
  stripe.list.mockResolvedValue({ data: [{ id: order.stripeSessionId, metadata: { family: kind, commerceOrderId: order.id } }] });
  stripe.retrieve.mockResolvedValue({
    payment_status: "paid", amount_total: order.totalAmount, currency: "aud", metadata: { family: kind, commerceOrderId: order.id, organisationId },
    payment_intent: { id: intentId, currency: "aud", amount_received: order.totalAmount, transfer_data: { destination: society.organisation.stripeAccountId }, latest_charge: { id: chargeId } }
  });
  return { order, intentId, chargeId };
}

const signedEvent = (type: string, object: unknown) =>
  ({ id: unique("evt"), object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } }) as unknown as Stripe.Event;

function postSigned(event: Stripe.Event) {
  const body = JSON.stringify(event);
  const signature = new Stripe("sk_test_fraud_warnings").webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  return webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

// Stripe's warning as it stands now, then its event delivered.
async function warn(payment: { intentId: string; chargeId: string }, extra: Record<string, unknown> = {}) {
  const warning = { id: unique("issfr"), object: "radar.early_fraud_warning", actionable: true, charge: payment.chargeId, payment_intent: payment.intentId, fraud_type: "made_with_stolen_card", ...extra };
  stripe.warning.mockResolvedValue(warning);
  const event = signedEvent("radar.early_fraud_warning.created", warning);
  expect((await postSigned(event)).status).toBe(200);
  return event;
}

function alerts(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls
    .map((call: unknown[]) => { try { return JSON.parse(String(call[0])); } catch { return {}; } })
    .filter((entry: { event?: string }) => entry.event === "early_fraud_warning");
}

describe("early fraud warnings", () => {
  test("an actionable warning on an unused ticket order queues a full refund for the worker; a replay queues nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await ticketOrder();
    const event = await warn(fixture);
    await postSigned(event);

    expect(await prisma.refundRequest.findMany({ where: { orderId: fixture.order.id }, select: { status: true, amount: true, actorUserId: true, reason: true, processingToken: true } }))
      .toEqual([{ status: "pending", amount: 3000, actorUserId: null, reason: fraudRefundReason, processingToken: null }]);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id }, select: { refundStatus: true } })).toEqual({ refundStatus: "processing" });
    expect(await prisma.orderLifecycleEvent.findFirst({ where: { orderId: fixture.order.id, type: "refund_requested" }, select: { source: true, actorUserId: true } }))
      .toEqual({ source: "stripe_webhook", actorUserId: null });
    expect(alerts(error)).toEqual([expect.objectContaining({ orderId: fixture.order.id, outcome: "refund_queued", fraudType: "made_with_stolen_card" })]);
  });

  test("a scanned ticket, a warning that isn't actionable, and a disputed or refunded order only alert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: Array<[string, (orderId: string) => Promise<unknown>, Record<string, unknown>]> = [
      ["used", (orderId) => prisma.ticket.updateMany({ where: { orderId, issueSequence: 1 }, data: { checkedInAt: new Date() } }), {}],
      ["not_actionable", async () => undefined, { actionable: false }],
      ["disputed", (orderId) => prisma.order.update({ where: { id: orderId }, data: { disputeStatus: "open" } }), {}],
      ["already_refunded", (orderId) => prisma.order.update({ where: { id: orderId }, data: { refundStatus: "refunded" } }), {}]
    ];
    for (const [outcome, prepare, extra] of cases) {
      const fixture = await ticketOrder();
      await prepare(fixture.order.id);
      await warn(fixture, extra);
      expect(await prisma.refundRequest.count({ where: { orderId: fixture.order.id } })).toBe(0);
      expect(alerts(error).at(-1)).toMatchObject({ orderId: fixture.order.id, outcome });
    }
  });

  test("a membership is refunded in full through the worker; collected merchandise only alerts", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const membership = await commerceOrder("membership");
    await warn(membership);
    expect(await prisma.refundRequest.findMany({ where: { commerceOrderId: membership.order.id }, select: { status: true, amount: true, actorUserId: true, reason: true } }))
      .toEqual([{ status: "pending", amount: 1500, actorUserId: null, reason: fraudRefundReason }]);
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: membership.order.id } })).refundStatus).toBe("processing");
    expect(alerts(error).at(-1)).toMatchObject({ commerceOrderId: membership.order.id, outcome: "refund_queued" });

    const collected = await commerceOrder("merchandise", { pickupStatus: "collected" });
    await warn(collected);
    expect(await prisma.refundRequest.count({ where: { commerceOrderId: collected.order.id } })).toBe(0);
    expect(alerts(error).at(-1)).toMatchObject({ commerceOrderId: collected.order.id, outcome: "used" });
  });

  test("a commerce fraud refund is left to the worker, with its own history and audit row", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { order, ...payment } = await commerceOrder("merchandise");
    await warn(payment);
    const request = await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: order.id } });
    expect(request).toMatchObject({ amount: order.totalAmount, attempts: 0, processingToken: null, actorUserId: null, operationKey: expect.stringMatching(/^commerce-refund:/) });
    expect(await prisma.commerceLifecycleEvent.findFirstOrThrow({ where: { commerceOrderId: order.id, type: "refund_requested" } })).toMatchObject({ source: "stripe_webhook", actorUserId: null, reason: fraudRefundReason, facts: { amount: order.totalAmount } });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { targetId: order.id, action: "commerce_order.refund_requested" } })).toMatchObject({ actorUserId: null, targetType: "CommerceOrder", metadata: { refundRequestId: request.id, amount: order.totalAmount, reason: fraudRefundReason } });
  });

  // PAY-036: the one dispute rule. Only an open or lost dispute stops the refund.
  test("a commerce order's refusals reach the alert as before; a won dispute no longer stops the refund", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: Array<[string, Record<string, unknown>]> = [
      ["disputed", { disputeStatus: "open" }],
      ["disputed", { disputeStatus: "lost" }],
      ["already_refunded", { refundStatus: "refunded" }],
      ["in_progress", { refundStatus: "processing" }],
      ["not_refundable", { requiresCompensationReview: true }],
      ["not_refundable", { externalRefundedAmount: 1500 }]
    ];
    for (const [outcome, data] of cases) {
      const fixture = await commerceOrder("membership");
      await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data });
      await warn(fixture);
      expect(await prisma.refundRequest.count({ where: { commerceOrderId: fixture.order.id } }), outcome).toBe(0);
      expect(alerts(error).at(-1)).toMatchObject({ commerceOrderId: fixture.order.id, outcome });
    }
    const won = await commerceOrder("membership");
    await prisma.commerceOrder.update({ where: { id: won.order.id }, data: { disputeStatus: "won" } });
    await warn(won);
    expect(await prisma.refundRequest.count({ where: { commerceOrderId: won.order.id } })).toBe(1);
    expect(alerts(error).at(-1)).toMatchObject({ commerceOrderId: won.order.id, outcome: "refund_queued" });
  });

  test("a warning on a payment that isn't an order's, or on another charge, alerts and changes nothing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await ticketOrder();
    await warn(fixture, { charge: unique("ch") });
    stripe.list.mockResolvedValue({ data: [] });
    await warn({ intentId: unique("pi"), chargeId: unique("ch") });
    expect(await prisma.refundRequest.count()).toBe(0);
    expect(alerts(error).map((entry: { outcome: string }) => entry.outcome)).toEqual(["unmatched", "unmatched"]);
  });

  test("a key that can't read the warning alerts once and answers 200, instead of failing every delivery", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fixture = await ticketOrder();
    const warning = { id: unique("issfr"), object: "radar.early_fraud_warning", actionable: true, charge: fixture.chargeId, payment_intent: fixture.intentId };
    stripe.warning.mockRejectedValue(Object.assign(new Error("The provided key does not have the required permissions"), { type: "StripePermissionError" }));
    expect((await postSigned(signedEvent("radar.early_fraud_warning.created", warning))).status).toBe(200);
    expect(await prisma.refundRequest.count({ where: { orderId: fixture.order.id } })).toBe(0);
    expect(alerts(error)).toEqual([expect.objectContaining({ warningId: warning.id, outcome: "unreadable" })]);
  });
});
