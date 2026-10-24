import { describe, expect, test, vi } from "vitest";
import Stripe from "stripe";
import { POST as paymentsWebhook } from "@/app/api/payments/webhook/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { reconcileCompletedCheckoutSessionWithSideEffects } from "@/lib/payments/checkout-fulfilment-orchestrator";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { MfaInputError } from "@/lib/security/staff-mfa";
import { getStripe, isLiveStripeKey, StripeConfigurationError } from "@/lib/stripe";
import { disconnectAccount, markAccountStatusError, StripeDisconnectBlockedError } from "@/lib/stripe/connect";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";
import { createEvent, createOrder, createOrganisationAccount, createReservation } from "@/tests/helpers/test-data";

// PAY-005: disconnect hands payouts back to Stripe's schedule; Stripe itself isn't reached here.
const restoreSchedule = vi.hoisted(() => vi.fn());
vi.mock("@/lib/payouts/payouts", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/payouts/payouts")>()), restoreStripePayoutSchedule: restoreSchedule }));

async function paidFixture(sellerStripeAccountId: string | null) {
  const owner = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 1 });
  await prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId } });
  await createReservation({
    orderId: order.id, organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: ticketType.id, quantity: 1,
    expiresAt: new Date(Date.now() + 30 * 60000)
  });
  const session = checkoutSession({
    id: order.stripeSessionId!, orderId: order.id, eventId: event.id, organisationId: owner.organisation.id,
    ticketTypeId: ticketType.id, quantity: 1, amountTotal: order.totalAmount
  });
  return { owner, event, order, session };
}

describe("Stripe key mode", () => {
  test("live keys are refused outside production and test keys are not live", () => {
    expect(isLiveStripeKey("sk_test_123")).toBe(false);
    expect(isLiveStripeKey("rk_live_123")).toBe(true);
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_live_not_a_real_key");
    expect(() => getStripe()).toThrow(StripeConfigurationError);
  });

  test("a signed event from the other mode is acknowledged and changes nothing", async () => {
    const fixture = await paidFixture(null);
    const payload = JSON.stringify({ id: "evt_mode", object: "event", type: "checkout.session.completed", livemode: true, data: { object: fixture.session } });
    const signature = new Stripe("sk_test_integration_placeholder").webhooks.generateTestHeaderString({ payload, secret: "whsec_integration_placeholder" });
    const response = await paymentsWebhook(new Request("http://localhost/api/payments/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: "mode_mismatch" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ status: "pending" });
  });
});

describe("payment destination", () => {
  test("a payment that reached another account is held for compensation review instead of fulfilled", async () => {
    const fixture = await paidFixture("acct_seller");
    // An expanded PaymentIntent needs no Stripe call.
    const session = { ...fixture.session, payment_intent: { id: "pi_x", transfer_data: { destination: "acct_somebody_else" } } } as unknown as Stripe.Checkout.Session;
    await reconcileCompletedCheckoutSessionWithSideEffects(session);

    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id }, include: { tickets: true } })).toMatchObject({
      requiresCompensationReview: true,
      tickets: []
    });
  });

  test("a payment to the snapshot account is fulfilled, and a Session without a PaymentIntent cannot prove it", async () => {
    const good = await paidFixture("acct_seller");
    await reconcileCompletedCheckoutSessionWithSideEffects({
      ...good.session,
      payment_intent: { id: "pi_ok", transfer_data: { destination: "acct_seller" } }
    } as unknown as Stripe.Checkout.Session);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: good.order.id }, include: { tickets: true } })).toMatchObject({ status: "paid" });

    const unproven = await paidFixture("acct_seller");
    await reconcileCompletedCheckoutSession(unproven.session, { destination: null });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: unproven.order.id } })).toMatchObject({ requiresCompensationReview: true });
  });
});

describe("disconnect", () => {
  test("is refused while an order still depends on the account, then audited once it is free", async () => {
    const fixture = await paidFixture(null);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { sellerStripeAccountId: fixture.owner.organisation.stripeAccountId } });
    const actor = { id: fixture.owner.user.id };

    await expect(disconnectAccount(fixture.owner.organisation.id, { actor })).rejects.toBeInstanceOf(StripeDisconnectBlockedError);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: fixture.owner.organisation.id } })).stripeAccountId).not.toBeNull();

    expect(restoreSchedule).not.toHaveBeenCalled();
    await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "expired" } });
    await disconnectAccount(fixture.owner.organisation.id, { actor });
    // Stripe pays out what's left on its own schedule.
    expect(restoreSchedule).toHaveBeenCalledWith(fixture.owner.organisation.stripeAccountId);
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: fixture.owner.organisation.id } })).toMatchObject({ stripeAccountId: null, stripeChargesEnabled: false });
    expect(await prisma.auditLog.findFirst({ where: { organisationId: fixture.owner.organisation.id, action: "stripe_connect.disconnected" } })).toMatchObject({
      actorUserId: actor.id,
      metadata: { previousStripeAccountId: fixture.owner.organisation.stripeAccountId }
    });
  });

  test("a membership order still being paid, refunded or disputed also blocks it", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    const now = Date.now();
    const plan = await prisma.membershipProduct.create({ data: { organisationId: owner.organisation.id, name: "Semester 2", priceAmount: 2500, startsAt: new Date(now - 86_400_000), endsAt: new Date(now + 100 * 86_400_000), entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: owner.organisation.id, kind: "membership", buyer: { userId: owner.user.id }, buyerEmail: owner.user.email, paymentKind: "stripe", feeAmount: 183, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 2500, name: plan.name, termStartsAt: plan.startsAt, termEndsAt: plan.endsAt, membershipProductId: plan.id }], expiresAt: new Date(now + 20 * 60_000)
    }));
    const actor = { id: owner.user.id };

    await expect(disconnectAccount(owner.organisation.id, { actor })).rejects.toBeInstanceOf(StripeDisconnectBlockedError);
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", disputeStatus: "open" } });
    await expect(disconnectAccount(owner.organisation.id, { actor })).rejects.toBeInstanceOf(StripeDisconnectBlockedError);
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { disputeStatus: "won" } });
    await disconnectAccount(owner.organisation.id, { actor });
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } })).stripeAccountId).toBeNull();
  });

  test("with no account, only resets a blocked platform state", async () => {
    const owner = await createOrganisationAccount();
    await prisma.organisation.update({ where: { id: owner.organisation.id }, data: { stripeAccountStatus: "PLATFORM_NOT_READY" } });
    await disconnectAccount(owner.organisation.id, { actor: { id: owner.user.id } });
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } })).stripeAccountStatus).toBe("NOT_CONNECTED");
  });

  test("needs an authenticator code when staff MFA is on", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    await expect(disconnectAccount(owner.organisation.id, { actor: { id: owner.user.id } })).rejects.toBeInstanceOf(MfaInputError);
    expect((await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } })).stripeAccountId).not.toBeNull();
  });
});

describe("status refresh failure", () => {
  test("keeps the last known flags, so sales follow them until a refresh succeeds", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    const status = await markAccountStatusError(owner.organisation.id, owner.organisation.stripeAccountId!, "unreachable");
    expect(status).toMatchObject({ state: "ERROR", charges_enabled: true });
    expect(await prisma.organisation.findUniqueOrThrow({ where: { id: owner.organisation.id } })).toMatchObject({ stripeChargesEnabled: true, stripeAccountStatus: "ERROR" });
  });
});
