import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { manualPayoutSettings, payoutSummary, processPayoutBatch, restoreStripePayoutSchedule } from "@/lib/payouts/payouts";
import { heldMoney } from "@/lib/payouts/release";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// PAY-005, design round F1: a society's money stays in its Stripe balance until
// its event is over, then the refunds worker pays it out.

const stripe = vi.hoisted(() => ({ account: vi.fn(), update: vi.fn(), balance: vi.fn(), create: vi.fn(), payout: vi.fn() }));
vi.mock("@/lib/stripe", async () => {
  const { default: RealStripe } = await vi.importActual<typeof import("stripe")>("stripe");
  return {
    StripeConfigurationError: class StripeConfigurationError extends Error {},
    getAppUrl: () => "http://localhost:3000",
    isLiveStripeKey: () => false,
    getStripeConnectWebhookSecret: () => "whsec_payouts_test",
    getStripe: () => ({
      accounts: { retrieve: stripe.account, update: stripe.update },
      balance: { retrieve: stripe.balance },
      payouts: { create: stripe.create, retrieve: stripe.payout },
      webhooks: new RealStripe("sk_test_payouts").webhooks
    })
  };
});

beforeEach(() => { stripe.account.mockResolvedValue({ settings: { payouts: { schedule: { interval: "manual" }, debit_negative_balances: true } } }); });
afterEach(() => { for (const mock of Object.values(stripe)) mock.mockReset(); });

const day = 86_400_000;
const now = new Date();

// A ready society and a paid $20.00 ticket ($1.64 fee, $18.36 to the society) for an event ending `endsIn` from now.
async function society() {
  const owner = await createOrganisationAccount({ stripeReady: true });
  return { owner, accountId: owner.organisation.stripeAccountId as string, organisationId: owner.organisation.id };
}

async function ticketSale(fixture: Awaited<ReturnType<typeof society>>, endsIn: number, { paidAgo = day, ...extra }: Record<string, unknown> & { paidAgo?: number } = {}) {
  const event = await createEvent({ organisationId: fixture.organisationId, status: "published" });
  const startTime = new Date(now.getTime() + endsIn - 2 * 3600_000);
  await prisma.event.update({ where: { id: event.id }, data: { startTime, salesCloseAt: startTime, endTime: new Date(now.getTime() + endsIn) } });
  const order = await createOrder({ organisationId: fixture.organisationId, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(now.getTime() - paidAgo), unitPrice: 2000 });
  return prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId: fixture.accountId, feeAmount: 164, ...extra } });
}

async function membershipSale(fixture: Awaited<ReturnType<typeof society>>, paidAgo: number) {
  const buyer = await createMember();
  const plan = await prisma.membershipProduct.create({ data: { organisationId: fixture.organisationId, name: unique("Plan"), priceAmount: 2500, startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 100 * day), entitlements: ["member_prices"], status: "published", publishedAt: now } });
  const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: fixture.organisationId, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 183, source: "checkout",
    lines: [{ quantity: 1, unitAmount: 2500, name: plan.name, termStartsAt: plan.startsAt, termEndsAt: plan.endsAt, membershipProductId: plan.id }]
  }));
  return prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(now.getTime() - paidAgo) } });
}

describe("what is held", () => {
  test("ticket money waits for its event to end plus 2 days, membership money for 7 days, never past 80 days; disputes and reviews wait", async () => {
    const fixture = await society();
    await ticketSale(fixture, 10 * day);                    // upcoming: held
    await ticketSale(fixture, -1 * day);                    // ended yesterday: held
    await ticketSale(fixture, -3 * day);                    // ended 3 days ago: released
    await ticketSale(fixture, 30 * day, { paidAgo: 81 * day }); // sold 81 days ago: released by the cap
    await ticketSale(fixture, -10 * day, { disputeStatus: "open" }); // disputed: held
    await ticketSale(fixture, 5 * day, { refundStatus: "refunded" }); // refunded: nothing left
    await ticketSale(fixture, 5 * day, { externalRefundedAmount: 1000 }); // part refunded outside: $8.36
    await membershipSale(fixture, 3 * day);                 // held ($23.17)
    await membershipSale(fixture, 8 * day);                 // released

    const held = await heldMoney(fixture.organisationId, fixture.accountId, now);
    expect(held.events).toMatchObject({ amount: 1836 * 3 + 836, eventCount: 4 });
    expect(held.events.nextEndsAt?.getTime()).toBe(now.getTime() + 5 * day);
    expect(held.commerce.amount).toBe(2317);
    expect(held.total).toBe(1836 * 3 + 836 + 2317);
    // Another society's account holds nothing of this one's.
    expect((await heldMoney(fixture.organisationId, "acct_someone_else", now)).total).toBe(0);
  });

  test("a lost dispute's money stays held until its transfer reversal settles (T53)", async () => {
    const fixture = await society();
    const order = await ticketSale(fixture, -10 * day, { disputeStatus: "lost" });
    const dispute = await prisma.purchaseDispute.create({ data: {
      orderId: order.id, organisationId: fixture.organisationId, stripeDisputeId: unique("dp"), stripeChargeId: unique("ch"),
      amount: 2000, currency: "aud", providerStatus: "lost", reversalStatus: "pending"
    } });
    expect((await heldMoney(fixture.organisationId, fixture.accountId, now)).total).toBe(1836);
    await prisma.purchaseDispute.update({ where: { id: dispute.id }, data: { reversalStatus: "uncertain" } });
    expect((await heldMoney(fixture.organisationId, fixture.accountId, now)).total).toBe(1836);
    await prisma.purchaseDispute.update({ where: { id: dispute.id }, data: { reversalStatus: "succeeded" } });
    expect((await heldMoney(fixture.organisationId, fixture.accountId, now)).total).toBe(0);
  });

  test("money already back with the buyer is not held: compensation refunds, and a lost dispute recovered before its event ends (PAY-012)", async () => {
    const fixture = await society();
    const compensated = await ticketSale(fixture, 5 * day, { isManuallyRefunded: true, status: "failed", failedAt: new Date(), fulfilledAt: null });
    await prisma.compensationRefundJob.create({ data: { orderId: compensated.id, state: "refunded", amount: 2000, currency: "aud" } });
    const lost = await ticketSale(fixture, 5 * day, { disputeStatus: "lost" });
    await prisma.purchaseDispute.create({ data: {
      orderId: lost.id, organisationId: fixture.organisationId, stripeDisputeId: unique("dp"), stripeChargeId: unique("ch"),
      amount: 2000, currency: "aud", providerStatus: "lost", reversalStatus: "succeeded"
    } });
    // A lost dispute the society never paid back (no transfer reversal) still waits with the event.
    await ticketSale(fixture, 5 * day, { disputeStatus: "lost" });
    expect((await heldMoney(fixture.organisationId, fixture.accountId, now)).total).toBe(1836);
  });

  test("staff can't release held money early: a manual refund mark or an end moved earlier still waits for the event", async () => {
    const fixture = await society();
    // A staff mark proves nothing at Stripe, so the sale waits with its event.
    await ticketSale(fixture, 5 * day, { isManuallyRefunded: true });
    // The end moved to just after now holds until 2 days after the end it had before (SEC-004).
    const moved = await ticketSale(fixture, -3 * day);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: moved.eventId } });
    await prisma.eventChange.create({ data: {
      eventId: event.id, organisationId: fixture.organisationId, eventVersion: event.version + 1,
      previousStartTime: new Date(now.getTime() + 30 * day - 3600_000), previousEndTime: new Date(now.getTime() + 30 * day), previousLocation: event.location,
      startTime: event.startTime, endTime: event.endTime, location: event.location, completedAt: now, outcome: "sent"
    } });
    const held = await heldMoney(fixture.organisationId, fixture.accountId, now);
    expect(held.events).toMatchObject({ amount: 1836 * 2, eventCount: 2 });
    expect(held.events.nextEndsAt?.getTime()).toBe(now.getTime() + 5 * day);
    // Once the latest end has passed too, the money goes.
    expect((await heldMoney(fixture.organisationId, fixture.accountId, new Date(now.getTime() + 33 * day))).total).toBe(0);
  });
});

describe("payouts worker", () => {
  test("pays out what is available less what is held, once a day per society, and checks each society at most hourly", async () => {
    const fixture = await society();
    await ticketSale(fixture, 10 * day); // $18.36 held
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 5000 }] });
    stripe.create.mockImplementation(async (params: { amount: number }) => ({ id: unique("po"), amount: params.amount, currency: "aud", status: "pending", arrival_date: Math.floor(now.getTime() / 1000) + 2 * 86400 }));

    const result = await processPayoutBatch(100, now);
    expect(result.results).toContainEqual({ organisationId: fixture.organisationId, sent: 5000 - 1836 });
    expect(stripe.create).toHaveBeenCalledWith(
      { amount: 3164, currency: "aud", metadata: { organisationId: fixture.organisationId } },
      { stripeAccount: fixture.accountId, idempotencyKey: `payout:${fixture.accountId}:${now.toISOString()}` }
    );
    expect(await prisma.societyPayout.findMany({ where: { organisationId: fixture.organisationId } })).toMatchObject([{ amount: 3164, status: "pending", stripeAccountId: fixture.accountId }]);

    // Checked again only after an hour.
    stripe.create.mockClear();
    await processPayoutBatch(100, new Date(now.getTime() + 30 * 60_000));
    expect(stripe.create).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stripeAccount: fixture.accountId }));
  });

  // DEF-034: one payout a UTC day; money released later waits for the next day.
  test("money released later in the day waits for the next day's payout", async () => {
    const fixture = await society();
    const keys = new Map<string, number>();
    // As Stripe does: the same key with different parameters is refused.
    stripe.create.mockImplementation(async (params: { amount: number }, options: { idempotencyKey: string }) => {
      const earlier = keys.get(options.idempotencyKey);
      if (earlier !== undefined && earlier !== params.amount) throw Object.assign(new Error("Keys for idempotent requests can only be used with the same parameters"), { type: "StripeIdempotencyError" });
      keys.set(options.idempotencyKey, params.amount);
      return { id: unique("po"), amount: params.amount, currency: "aud", status: "pending", arrival_date: null };
    });
    const morning = new Date(`${now.toISOString().slice(0, 10)}T01:00:00.000Z`);
    const later = new Date(morning.getTime() + 61 * 60_000);
    const tomorrow = new Date(morning.getTime() + day);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 5000 }] });
    await processPayoutBatch(100, morning);
    // More money became free an hour later: no second payout today, and nothing refused.
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 7000 }] });
    await processPayoutBatch(100, later);
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(error.mock.calls.map(([line]) => String(line)).filter((line) => line.includes("payouts.failed_to_send"))).toEqual([]);

    await processPayoutBatch(100, tomorrow);
    expect(stripe.create).toHaveBeenLastCalledWith(
      { amount: 7000, currency: "aud", metadata: { organisationId: fixture.organisationId } },
      { stripeAccount: fixture.accountId, idempotencyKey: `payout:${fixture.accountId}:${tomorrow.toISOString()}` }
    );
    expect(await prisma.societyPayout.findMany({ where: { organisationId: fixture.organisationId }, orderBy: { createdAt: "asc" }, select: { amount: true } })).toEqual([{ amount: 5000 }, { amount: 7000 }]);
  });

  test("a society still on Stripe's schedule is moved to manual payouts; less than $1.00 free waits", async () => {
    const fixture = await society();
    await ticketSale(fixture, 10 * day);
    stripe.account.mockResolvedValue({ settings: { payouts: { schedule: { interval: "daily" }, debit_negative_balances: false } } });
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 1836 + 99 }] });
    await processPayoutBatch(100, now);
    expect(stripe.update).toHaveBeenCalledWith(fixture.accountId, { settings: manualPayoutSettings });
    expect(stripe.create).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stripeAccount: fixture.accountId }));
  });

  // Connect charges A$0.25 + 0.25% a payout, so a small balance waits for $20, or a week without a payout.
  test("under $20 waits while the society was paid this week, and goes once a week has passed or if it was never paid", async () => {
    const recent = await society();
    const lapsed = await society();
    const never = await society();
    const earlier = (fixture: Awaited<ReturnType<typeof society>>, ago: number, status: "paid" | "failed" = "paid") => prisma.societyPayout.create({ data: {
      organisationId: fixture.organisationId, stripeAccountId: fixture.accountId, stripePayoutId: unique("po"), amount: 5000, currency: "aud", status, createdAt: new Date(now.getTime() - ago)
    } });
    await earlier(recent, 2 * day);
    await earlier(lapsed, 8 * day);
    // A refused payout doesn't count as being paid.
    await earlier(lapsed, 3 * day, "failed");
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 1500 }] });
    stripe.create.mockImplementation(async (params: { amount: number }) => ({ id: unique("po"), amount: params.amount, currency: "aud", status: "pending", arrival_date: null }));

    const result = await processPayoutBatch(100, now);
    expect(result.results).toEqual(expect.arrayContaining([
      { organisationId: recent.organisationId, sent: 0 },
      { organisationId: lapsed.organisationId, sent: 1500 },
      { organisationId: never.organisationId, sent: 1500 }
    ]));
  });

  // Stripe keeps a refusal under its idempotency key, so a per-day key used to block the rest of the day.
  test("after Stripe refuses a payout, the next hour's attempt that day uses a new key and goes through", async () => {
    const fixture = await society();
    const morning = new Date(`${now.toISOString().slice(0, 10)}T01:00:00.000Z`);
    const later = new Date(morning.getTime() + 61 * 60_000);
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 5000 }] });
    stripe.create
      .mockRejectedValueOnce(Object.assign(new Error("Insufficient funds in Stripe account"), { type: "StripeInvalidRequestError" }))
      .mockImplementation(async (params: { amount: number }) => ({ id: unique("po"), amount: params.amount, currency: "aud", status: "pending", arrival_date: null }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await processPayoutBatch(100, morning);
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 4000 }] });
    await processPayoutBatch(100, later);
    const keys = stripe.create.mock.calls.filter(([, options]) => options.stripeAccount === fixture.accountId).map(([, options]) => options.idempotencyKey);
    expect(keys).toEqual([`payout:${fixture.accountId}:${morning.toISOString()}`, `payout:${fixture.accountId}:${later.toISOString()}`]);
    expect(await prisma.societyPayout.findMany({ where: { organisationId: fixture.organisationId }, select: { amount: true } })).toEqual([{ amount: 4000 }]);
  });

  test("a society that can't receive payouts is left alone", async () => {
    const fixture = await society();
    await prisma.organisation.update({ where: { id: fixture.organisationId }, data: { stripePayoutsEnabled: false } });
    await processPayoutBatch(100, now);
    expect(stripe.balance).not.toHaveBeenCalledWith({}, { stripeAccount: fixture.accountId });
  });

  // A failed status refresh (ERROR) or paused card payments (RESTRICTED) used to stop payouts with no alert.
  test("the payouts flag decides, not the state: an out-of-date or restricted society is still paid", async () => {
    const stale = await society();
    const restricted = await society();
    await prisma.organisation.update({ where: { id: stale.organisationId }, data: { stripeAccountStatus: "ERROR" } });
    await prisma.organisation.update({ where: { id: restricted.organisationId }, data: { stripeAccountStatus: "RESTRICTED", stripeChargesEnabled: false } });
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 5000 }] });
    stripe.create.mockImplementation(async (params: { amount: number }) => ({ id: unique("po"), amount: params.amount, currency: "aud", status: "pending", arrival_date: null }));

    const result = await processPayoutBatch(100, now);
    expect(result.results).toEqual(expect.arrayContaining([
      { organisationId: stale.organisationId, sent: 5000 },
      { organisationId: restricted.organisationId, sent: 5000 }
    ]));
  });

  test("a payout Stripe won't send is logged and tried next hour; the other societies are still paid", async () => {
    const failing = await society();
    const other = await society();
    stripe.balance.mockResolvedValue({ available: [{ currency: "aud", amount: 5000 }] });
    stripe.create.mockImplementation(async (params: { amount: number }, options: { stripeAccount: string }) => {
      if (options.stripeAccount === failing.accountId) throw Object.assign(new Error("Your account cannot currently make payouts"), { type: "StripeInvalidRequestError" });
      return { id: unique("po"), amount: params.amount, currency: "aud", status: "pending", arrival_date: null };
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await processPayoutBatch(100, now);
    expect(result.results).toEqual(expect.arrayContaining([
      { organisationId: failing.organisationId, sent: 0, error: true },
      { organisationId: other.organisationId, sent: 5000 }
    ]));
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line))).filter((entry) => entry.event === "payouts.failed_to_send"))
      .toEqual([expect.objectContaining({ organisationId: failing.organisationId })]);
    expect(await prisma.societyPayout.count({ where: { organisationId: failing.organisationId } })).toBe(0);

    // Not before the hour is up; then it is tried again.
    stripe.create.mockClear();
    await processPayoutBatch(100, new Date(now.getTime() + 30 * 60_000));
    expect(stripe.create).not.toHaveBeenCalled();
    await processPayoutBatch(100, new Date(now.getTime() + 61 * 60_000));
    expect(stripe.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ stripeAccount: failing.accountId }));
  });

  test("on disconnect, Stripe goes back to paying the account out daily", async () => {
    const fixture = await society();
    await restoreStripePayoutSchedule(fixture.accountId);
    expect(stripe.update).toHaveBeenCalledWith(fixture.accountId, { settings: { payouts: { schedule: { interval: "daily" } } } });
  });
});

describe("payout events", () => {
  function payoutEvent(accountId: string, payout: Record<string, unknown>, type = "payout.updated") {
    const body = JSON.stringify({ id: unique("evt"), object: "event", type, account: accountId, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: payout } });
    const signature = new Stripe("sk_test_payouts").webhooks.generateTestHeaderString({ payload: body, secret: "whsec_payouts_test" });
    return connectWebhook(new Request("http://localhost:3000/api/stripe/connect/webhook", { method: "POST", headers: { "stripe-signature": signature }, body }));
  }

  test("Stripe's status is recorded as re-read; a refused payout shows until a later one goes through; another account's payout is ignored", async () => {
    const fixture = await society();
    const failed = { id: unique("po"), object: "payout", amount: 4128, currency: "aud", status: "failed", failure_message: "The bank account has been closed.", arrival_date: null };
    stripe.payout.mockResolvedValue(failed);
    expect((await payoutEvent(fixture.accountId, { ...failed, status: "in_transit" }, "payout.failed")).status).toBe(200);
    expect(stripe.payout).toHaveBeenCalledWith(failed.id, {}, { stripeAccount: fixture.accountId });
    expect(await prisma.societyPayout.findUniqueOrThrow({ where: { stripePayoutId: failed.id } })).toMatchObject({ organisationId: fixture.organisationId, status: "failed", amount: 4128, failureMessage: "The bank account has been closed." });
    expect((await payoutSummary(fixture.organisationId, fixture.accountId, now)).failed).toMatchObject({ amount: 4128 });

    // A later payout reaches the bank: the warning goes.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const paid = { id: unique("po"), object: "payout", amount: 4128, currency: "aud", status: "paid", arrival_date: Math.floor(Date.now() / 1000) };
    stripe.payout.mockResolvedValue(paid);
    await payoutEvent(fixture.accountId, paid, "payout.paid");
    const summary = await payoutSummary(fixture.organisationId, fixture.accountId, now);
    expect(summary.failed).toBeNull();
    expect(summary.recent.map((payout) => payout.status)).toEqual(["paid", "failed"]);

    // The same payout id reported for another account changes nothing.
    stripe.payout.mockClear();
    await payoutEvent("acct_not_this_one", { ...paid, status: "failed" }, "payout.failed");
    expect(stripe.payout).not.toHaveBeenCalled();
  });
});
