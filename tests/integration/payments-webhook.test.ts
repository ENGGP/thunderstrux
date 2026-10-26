import Stripe from "stripe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { POST as webhookRoute } from "@/app/api/payments/webhook/route";
import { prisma } from "@/lib/db";
import { setAutomaticOutboxEnqueueTestFailure } from "@/lib/email/ticket-email-outbox";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createMember, createOrder, createOrganisationAccount, createReservation, unique } from "@/tests/helpers/test-data";

// The payments webhook route as Stripe calls it: signed bodies in Stripe's own
// shape. Signature, replay, expiry, mismatches and commerce routing are proven
// end to end in e2e webhooks.spec.ts; these are what that run can't reach.

const secret = "whsec_payments_route_test";
const stripe = vi.hoisted(() => ({ intent: vi.fn(), configured: true }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  class StripeConfigurationError extends Error {}
  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeWebhookSecret: () => {
      if (!stripe.configured) throw new StripeConfigurationError("STRIPE_WEBHOOK_SECRET is not configured");
      return "whsec_payments_route_test";
    },
    getStripe: () => ({ paymentIntents: { retrieve: stripe.intent }, webhooks: new RealStripe("sk_test_payments_route").webhooks })
  };
});

afterEach(() => {
  stripe.intent.mockReset();
  stripe.configured = true;
  setAutomaticOutboxEnqueueTestFailure(null);
});

function deliver(type: string, object: unknown, id = unique("evt")) {
  const body = JSON.stringify({ id, object: "event", type, livemode: false, created: Math.floor(Date.now() / 1000), api_version: "2026-09-30.endive", data: { object } });
  const signature = new Stripe("sk_test_payments_route").webhooks.generateTestHeaderString({ payload: body, secret });
  return webhookRoute(new Request("http://localhost:3000/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
}

// A member's held, unpaid ticket order, and the Session as Stripe's webhook sends it:
// the PaymentIntent named by id, not expanded.
async function heldOrder() {
  const owner = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember();
  const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, unitPrice: ticketType.price });
  await prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId: owner.organisation.stripeAccountId } });
  await createReservation({ orderId: order.id, organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, expiresAt: new Date(Date.now() + 30 * 60_000) });
  const intentId = unique("pi");
  const session = {
    ...checkoutSession({ id: order.stripeSessionId!, orderId: order.id, eventId: event.id, organisationId: owner.organisation.id, ticketTypeId: ticketType.id, quantity: 1, amountTotal: order.totalAmount }),
    object: "checkout.session",
    payment_intent: intentId
  };
  stripe.intent.mockResolvedValue({ id: intentId, transfer_data: { destination: owner.organisation.stripeAccountId } });
  return { owner, order, session, intentId };
}

const orderState = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, select: { status: true, requiresCompensationReview: true, reservation: { select: { status: true } }, _count: { select: { tickets: true } } } });

describe("payments webhook route", () => {
  test("a paid Session naming its PaymentIntent by id is checked against Stripe's PaymentIntent, then fulfilled once", async () => {
    const { order, session, intentId } = await heldOrder();
    expect((await deliver("checkout.session.completed", session)).status).toBe(200);
    expect(stripe.intent).toHaveBeenCalledWith(intentId);
    expect(await orderState(order.id)).toEqual({ status: "paid", requiresCompensationReview: false, reservation: { status: "confirmed" }, _count: { tickets: 1 } });
  });

  test("a failure before fulfilment commits is never answered 2xx, changes nothing, and Stripe's retry fulfils once", async () => {
    const { order, session } = await heldOrder();
    const eventId = unique("evt");
    setAutomaticOutboxEnqueueTestFailure(new Error("outbox insert failed"));
    // Thrown, Next answers 500 and Stripe redelivers; a 2xx here would lose the payment.
    await expect(deliver("checkout.session.completed", session, eventId)).rejects.toThrow("outbox insert failed");
    expect(await orderState(order.id)).toEqual({ status: "pending", requiresCompensationReview: false, reservation: { status: "active" }, _count: { tickets: 0 } });

    setAutomaticOutboxEnqueueTestFailure(null);
    expect((await deliver("checkout.session.completed", session, eventId)).status).toBe(200);
    expect((await deliver("checkout.session.completed", session, eventId)).status).toBe(200);
    expect(await orderState(order.id)).toMatchObject({ status: "paid", _count: { tickets: 1 } });
  });

  test("a refund event naming a compensation job settles that job", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published", compensationRefundMode: "automatic_full" });
    const order = await createOrder({
      organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "failed", paidAt: new Date(), failedAt: new Date(),
      requiresCompensationReview: true, fulfilmentFailedAt: new Date(), fulfilmentFailureReason: "inventory_unavailable_after_payment", compensationRefundModeSnapshot: "automatic_full"
    });
    const job = await prisma.compensationRefundJob.create({ data: { orderId: order.id, state: "refund_pending", amount: order.totalAmount, currency: "aud", stripePaymentIntentId: "pi_compensation", stripeRefundId: "re_compensation" } });

    const refund = { id: "re_compensation", object: "refund", status: "succeeded", amount: order.totalAmount, currency: "aud", payment_intent: "pi_compensation", metadata: { compensationRefundJobId: job.id, orderId: order.id } };
    expect((await deliver("refund.updated", refund)).status).toBe(200);
    expect(await prisma.compensationRefundJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ state: "refunded" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ requiresCompensationReview: false, isManuallyRefunded: true });
  });

  test("without its Stripe configuration the route answers 503 and reads nothing", async () => {
    const { order, session } = await heldOrder();
    stripe.configured = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await deliver("checkout.session.completed", session)).status).toBe(503);
    expect(stripe.intent).not.toHaveBeenCalled();
    expect(await orderState(order.id)).toMatchObject({ status: "pending", _count: { tickets: 0 } });
  });
});
