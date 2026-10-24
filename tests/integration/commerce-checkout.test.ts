import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as membershipCheckout } from "@/app/api/payments/checkout/membership/route";
import { POST as merchandiseCheckout } from "@/app/api/payments/checkout/merchandise/route";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { prisma } from "@/lib/db";
import { createCommerceCheckout } from "@/lib/commerce/checkout";
import { expireStaleCommerceOrders } from "@/lib/commerce/reconciliation";
import { processCheckoutAttemptRecoveryBatch } from "@/lib/payments/checkout-attempt-recovery";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const webhookSecret = "whsec_commerce_test";
const stripe = vi.hoisted(() => ({ create: vi.fn(), intent: vi.fn() }));
// A merchandise family for the tests; production registers none until T27.
const family = vi.hoisted(() => ({ price: 1500, fulfil: true, fulfilled: [] as string[], released: [] as string[] }));

vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => "whsec_commerce_test",
    getStripe: () => ({ checkout: { sessions: { create: stripe.create } }, paymentIntents: { retrieve: stripe.intent }, webhooks: new RealStripe("sk_test_commerce").webhooks })
  };
});
vi.mock("@/lib/commerce/families", async () => {
  const { z } = await vi.importActual<typeof import("zod")>("zod");
  return {
    commerceFamilies: {
      merchandise: {
        selection: z.object({ variant: z.string(), quantity: z.number().int() }).strict(),
        guests: true,
        quote: async (_tx: unknown, { selection }: { selection: { variant: string; quantity: number } }) => ({ lines: [{ quantity: selection.quantity, unitAmount: family.price, name: "Hoodie", variant: selection.variant }] }),
        lock: async () => undefined,
        fulfil: async (_tx: unknown, order: { id: string }) => {
          if (!family.fulfil) return { fulfilled: false, reason: "out_of_stock" };
          family.fulfilled.push(order.id);
          return { fulfilled: true };
        },
        release: async (_tx: unknown, order: { id: string }) => { family.released.push(order.id); }
      }
    }
  };
});

beforeEach(() => {
  stripe.create.mockImplementation(async () => ({ id: unique("cs_commerce"), url: "https://checkout.stripe.test/pay" }));
  Object.assign(family, { price: 1500, fulfil: true, fulfilled: [], released: [] });
});
afterEach(() => { stripe.create.mockReset(); stripe.intent.mockReset(); });

async function shop() {
  const society = await createOrganisationAccount({ stripeReady: true });
  const buyer = await createMember();
  setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
  const checkout = (overrides: Record<string, unknown> = {}) => createCommerceCheckout({
    family: "merchandise", organisationId: society.organisation.id, buyer: { userId: buyer.id },
    selection: { variant: "M", quantity: 2 }, expectedTotal: 2 * family.price, idempotencyKey: unique("commerce-key-0000"), ...overrides
  });
  return { society, buyer, checkout };
}

const sessionFor = async (commerceOrderId: string, overrides: Record<string, unknown> = {}) => {
  const order = await prisma.commerceOrder.findUniqueOrThrow({ where: { id: commerceOrderId } });
  return {
    id: order.stripeSessionId, object: "checkout.session", payment_status: "paid", amount_total: order.totalAmount, currency: "aud",
    payment_intent: { id: unique("pi"), transfer_data: { destination: order.sellerStripeAccountId } },
    metadata: { family: order.kind, commerceOrderId: order.id, organisationId: order.organisationId }, ...overrides
  };
};

async function deliver(type: string, object: unknown, id = unique("evt")) {
  const body = JSON.stringify({ id, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object } });
  const signature = new Stripe("sk_test_commerce").webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret });
  const response = await webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
  expect(response.status).toBe(200);
  return body;
}

const alerts = (spy: { mock: { calls: unknown[][] } }, name: string) => spy.mock.calls.filter(([line]) => String(line).includes(`"event":"${name}"`)).length;

describe("commerce checkout", () => {
  test("a paid checkout records the order and attempt and makes one Session with the family, fee and stable key; a replay returns it", async () => {
    const { society, buyer } = await shop();
    const key = unique("commerce-route-key");
    const body = { organisationId: society.organisation.id, selection: { variant: "M", quantity: 2 }, expectedTotal: 3000, idempotencyKey: key };
    const response = await merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", body));
    expect(await parseJsonResponse(response)).toEqual({ kind: "stripe", url: "https://checkout.stripe.test/pay" });

    const order = await prisma.commerceOrder.findFirstOrThrow({ where: { userId: buyer.id }, include: { lines: true, checkoutAttempt: true } });
    expect(order).toMatchObject({ kind: "merchandise", status: "pending", paymentKind: "stripe", totalAmount: 3000, feeAmount: 202, feePolicyVersion: "platform_fee_3_75_percent_89c_v2", sellerStripeAccountId: society.organisation.stripeAccountId });
    expect(order.checkoutAttempt).toMatchObject({ family: "merchandise", state: "provider_attached", stripeSessionId: order.stripeSessionId });
    const [request, options] = stripe.create.mock.calls[0];
    // Stripe's Session and the hold end together, at least 30 minutes after the call.
    expect(order.expiresAt?.getTime()).toBe(request.expires_at * 1000);
    expect(request.expires_at - Date.now() / 1000).toBeGreaterThan(30 * 60);
    expect(request).toMatchObject({
      integration_identifier: "thunderstrux-commerce-wpdlxneg",
      metadata: { family: "merchandise", commerceOrderId: order.id, organisationId: society.organisation.id },
      payment_intent_data: { application_fee_amount: 202, transfer_data: { destination: society.organisation.stripeAccountId }, metadata: { family: "merchandise" } },
      line_items: [{ quantity: 2, price_data: { unit_amount: 1500, product_data: { name: "Hoodie (M)" } } }]
    });
    expect(options).toEqual({ idempotencyKey: order.checkoutAttempt?.providerOperationKey });

    const again = await merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", body));
    expect(await parseJsonResponse(again)).toEqual({ kind: "stripe", url: "https://checkout.stripe.test/pay" });
    const changed = await merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", { ...body, selection: { variant: "L", quantity: 2 } }));
    expect(changed.status).toBe(409);
    const repriced = await merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", { ...body, idempotencyKey: unique("commerce-other-key"), expectedTotal: 2000 }));
    expect(repriced.status).toBe(409);
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(await prisma.commerceOrder.count()).toBe(1);
  });

  test("two checkouts with one key make one order and one Session", async () => {
    const { checkout } = await shop();
    const key = unique("commerce-race-key0");
    await Promise.all([checkout({ idempotencyKey: key }), checkout({ idempotencyKey: key })]);
    expect(await prisma.commerceOrder.count()).toBe(1);
    expect(stripe.create).toHaveBeenCalledTimes(1);
  });

  test("the signed webhook fulfils through the family once; replays and a late expiry change nothing", async () => {
    const { checkout } = await shop();
    await checkout();
    const order = await prisma.commerceOrder.findFirstOrThrow();
    const paid = await sessionFor(order.id);
    const id = unique("evt");
    await deliver("checkout.session.completed", paid, id);
    await deliver("checkout.session.completed", paid, id);
    await deliver("checkout.session.completed", paid);
    await deliver("checkout.session.expired", paid);
    expect(family.fulfilled).toEqual([order.id]);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "paid", expiresAt: null, stripePaymentIntentId: (paid.payment_intent as { id: string }).id });
    expect((await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: order.id }, orderBy: { sequence: "asc" } })).map((event) => event.type))
      .toEqual(["order_created", "stripe_session_attached", "payment_fulfilled"]);
  });

  test("a webhook whose family, society or Session doesn't match is ignored with an alert and never re-routed", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { society, checkout } = await shop();
    await checkout();
    const order = await prisma.commerceOrder.findFirstOrThrow();
    const base = await sessionFor(order.id);
    for (const metadata of [
      { ...base.metadata, family: "membership" },
      { ...base.metadata, family: "ticket" },
      { ...base.metadata, organisationId: (await createOrganisationAccount()).organisation.id }
    ]) await deliver("checkout.session.completed", { ...base, metadata });
    // The commerce Session without a family is not handed to ticket reconciliation either.
    await deliver("checkout.session.completed", { ...base, metadata: {} });
    // A ticket order's Session dressed as merchandise changes neither order.
    const event = await createEvent({ organisationId: society.organisation.id, status: "published" });
    const ticket = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id });
    await deliver("checkout.session.completed", { ...base, id: ticket.stripeSessionId, metadata: { family: "merchandise", organisationId: society.organisation.id } });

    expect(family.fulfilled).toEqual([]);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "pending", requiresCompensationReview: false });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ status: "pending" });
    expect(alerts(error, "commerce_webhook_identity_mismatch")).toBe(5);
  });

  test("a wrong amount, currency or destination, or a family that can't fulfil, becomes a compensation review and releases the hold", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { checkout } = await shop();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ amount_total: 1 }, "amount_mismatch"],
      [{ currency: "usd" }, "currency_mismatch"],
      [{ payment_intent: { id: unique("pi"), transfer_data: { destination: "acct_someone_else" } } }, "destination_mismatch"]
    ];
    for (const [overrides, reason] of cases) {
      await checkout();
      const order = await prisma.commerceOrder.findFirstOrThrow({ where: { status: "pending" } });
      await deliver("checkout.session.completed", await sessionFor(order.id, overrides));
      expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ status: "failed", requiresCompensationReview: true, reviewReason: reason });
    }
    family.fulfil = false;
    await checkout();
    const outOfStock = await prisma.commerceOrder.findFirstOrThrow({ where: { status: "pending" } });
    await deliver("checkout.session.completed", await sessionFor(outOfStock.id));
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: outOfStock.id } })).toMatchObject({ requiresCompensationReview: true, reviewReason: "out_of_stock" });
    expect(family.fulfilled).toEqual([]);
    expect(family.released).toHaveLength(4);
    expect(alerts(error, "paid_but_unfulfilled_compensation_required")).toBe(4);
    // Each buyer hears once that the payment is in review (T30).
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: "payment-review/" } } })).toBe(4);
  });

  test("a free total completes in the checkout itself, with no Stripe", async () => {
    family.price = 0;
    const { checkout } = await shop();
    const result = await checkout({ expectedTotal: 0 });
    expect(result).toMatchObject({ status: "fulfilled" });
    expect(await prisma.commerceOrder.findFirstOrThrow()).toMatchObject({ paymentKind: "free", status: "paid", totalAmount: 0, stripeSessionId: null });
    expect(family.fulfilled).toHaveLength(1);
    expect(stripe.create).not.toHaveBeenCalled();
  });

  test("a lost Stripe answer leaves the attempt uncertain; recovery replays the same key and binds the Session", async () => {
    const { checkout } = await shop();
    stripe.create.mockRejectedValueOnce(new Error("socket hang up"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await checkout()).toMatchObject({ status: "processing" });
    const attempt = await prisma.checkoutAttempt.findFirstOrThrow();
    expect(attempt).toMatchObject({ state: "provider_uncertain" });
    await processCheckoutAttemptRecoveryBatch({ now: new Date(Date.now() + 60_000) });
    expect(stripe.create).toHaveBeenCalledTimes(2);
    expect(stripe.create.mock.calls[1][1]).toEqual({ idempotencyKey: attempt.providerOperationKey });
    expect(await prisma.checkoutAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ state: "provider_attached" });
    expect((await prisma.commerceOrder.findFirstOrThrow()).stripeSessionId).toEqual(expect.stringMatching(/^cs_commerce/));
  });

  test("an unpaid completed Session, and a hold whose Session has expired, close the order and release the hold", async () => {
    const { checkout } = await shop();
    await checkout();
    const unpaid = await prisma.commerceOrder.findFirstOrThrow({ where: { status: "pending" } });
    await deliver("checkout.session.completed", await sessionFor(unpaid.id, { payment_status: "unpaid" }));
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: unpaid.id } })).toMatchObject({ status: "failed", requiresCompensationReview: false, failureReason: "session_not_paid" });

    await checkout();
    const stale = await prisma.commerceOrder.findFirstOrThrow({ where: { status: "pending" } });
    expect(await expireStaleCommerceOrders({ now: new Date() })).toMatchObject({ expired: 0 });
    expect(await expireStaleCommerceOrders({ now: new Date(Date.now() + 2 * 60 * 60 * 1000) })).toMatchObject({ expired: 1 });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ status: "expired" });
    expect(await prisma.checkoutAttempt.findFirstOrThrow({ where: { commerceOrderId: stale.id } })).toMatchObject({ state: "failed" });
    expect(family.released).toEqual([unpaid.id, stale.id]);
  });

  test("a family that isn't on sale yet is a 404, and only members may buy", async () => {
    const { society } = await shop();
    const body = { organisationId: society.organisation.id, selection: {}, expectedTotal: 1000, idempotencyKey: unique("commerce-member-key") };
    expect((await membershipCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/membership", body))).status).toBe(404);
    setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
    expect((await merchandiseCheckout(jsonRequest("http://localhost:3000/api/payments/checkout/merchandise", { ...body, selection: { variant: "M", quantity: 1 } }))).status).toBe(400);
    expect(await prisma.commerceOrder.count()).toBe(0);
  });
});
