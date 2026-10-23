import type Stripe from "stripe";
import { afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { processOrderRefundBatch } from "@/lib/payments/order-refunds";
import { runWorker } from "@/lib/ops/worker";
import { createEvent, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// T44c, operations recovery: a restored copy holds a refund the old database
// sent to Stripe but never heard back about. The restore fences every worker
// (scripts/operations.mjs restore), so nothing reaches Stripe until someone
// resumes them; then the refund worker finds Stripe's refund instead of making
// a second one, and the tickets are voided and the buyer told once.

const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { retrieve: stripe.retrieve } }, refunds: { list: stripe.list, create: stripe.create } })
}));
afterEach(() => { stripe.retrieve.mockReset(); stripe.list.mockReset(); stripe.create.mockReset(); });

const quiet = () => { for (const level of ["info", "warn", "error"] as const) vi.spyOn(console, level).mockImplementation(() => {}); };
const refundsWorker = () => runWorker("refunds", () => processOrderRefundBatch().then(() => undefined), { timeoutMs: 10_000, disconnect: false });

describe("recovery fencing (T44c)", () => {
  test("a restored refund stays still while the copy is fenced, then resolves once from Stripe's own record without refunding twice", async () => {
    quiet();
    // The order as it was when the backup ran: paid, two valid tickets, a refund already sent and unanswered.
    const owner = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const created = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
    const order = await prisma.order.update({ where: { id: created.id }, data: {
      sellerStripeAccountId: owner.organisation.stripeAccountId, refundStatus: "processing",
      buyerEmailSnapshot: "buyer@example.com", buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase"
    } });
    await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: owner.organisation.id })) });
    const intentId = unique("pi");
    const stale = new Date(Date.now() - 60 * 60_000);
    const request = await prisma.refundRequest.create({ data: {
      orderId: order.id, organisationId: owner.organisation.id, amount: 3000, reason: "Event cancelled by the society.", actorUserId: owner.user.id,
      operationKey: unique("order-refund"), status: "pending", destinationAccountId: owner.organisation.stripeAccountId,
      processingToken: "lost-with-the-old-database", processingStartedAt: stale, nextAttemptAt: stale, attempts: 1
    } });

    // Stripe made the refund before the old database failed.
    stripe.retrieve.mockResolvedValue({
      payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: order.id },
      payment_intent: { id: intentId, amount_received: 3000, transfer_data: { destination: owner.organisation.stripeAccountId }, latest_charge: { disputed: false } }
    });
    const atStripe = { id: unique("re"), status: "succeeded", amount: 3000, currency: "aud", payment_intent: intentId, metadata: { refundRequestId: request.id, orderId: order.id } } as unknown as Stripe.Refund;
    stripe.list.mockResolvedValue({ data: [atStripe] });

    // 1. The restore fenced the copy: the worker runs, does nothing, and asks Stripe nothing.
    await prisma.workerLease.create({ data: { name: "all", pausedAt: new Date(), pauseReason: "Restored from backup: reconcile Stripe, refunds and the outbox, then resume" } });
    expect(await refundsWorker()).toBe("skipped_paused");
    expect(stripe.retrieve).not.toHaveBeenCalled();
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "pending", attempts: 1 });

    // 2. Reconciled and resumed: the stale claim is reclaimed and Stripe's own refund settles it. No second refund.
    await prisma.workerLease.update({ where: { name: "all" }, data: { pausedAt: null, pauseReason: null } });
    expect(await refundsWorker()).toBe("succeeded");
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).toMatchObject({ status: "succeeded", stripeRefundId: atStripe.id });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ refundStatus: "refunded" });
    expect(await prisma.ticket.count({ where: { orderId: order.id, validity: "void", validityReason: "refunded" } })).toBe(2);

    // 3. Run again, as the next minute would: nothing more happens.
    expect(await refundsWorker()).toBe("succeeded");
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `refund/${request.id}` } })).toBe(1);
    expect(await prisma.orderLifecycleEvent.count({ where: { orderId: order.id, type: "refunded" } })).toBe(1);
  });

  test("a restored refund Stripe never received is sent once, under the request's own idempotency key", async () => {
    quiet();
    const owner = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const created = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
    const order = await prisma.order.update({ where: { id: created.id }, data: { sellerStripeAccountId: owner.organisation.stripeAccountId, refundStatus: "processing" } });
    const intentId = unique("pi");
    const request = await prisma.refundRequest.create({ data: {
      orderId: order.id, organisationId: owner.organisation.id, amount: 3000, reason: "Event cancelled by the society.", actorUserId: owner.user.id,
      operationKey: unique("order-refund"), status: "pending", destinationAccountId: owner.organisation.stripeAccountId, nextAttemptAt: new Date(Date.now() - 60_000)
    } });
    stripe.retrieve.mockResolvedValue({
      payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: order.id },
      payment_intent: { id: intentId, amount_received: 3000, transfer_data: { destination: owner.organisation.stripeAccountId }, latest_charge: { disputed: false } }
    });
    stripe.list.mockResolvedValue({ data: [] });
    stripe.create.mockImplementation(async (params: { metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: 3000, currency: "aud", payment_intent: intentId, metadata: params.metadata }));

    await prisma.workerLease.create({ data: { name: "all", pausedAt: new Date(), pauseReason: "Restored from backup" } });
    expect(await refundsWorker()).toBe("skipped_paused");
    await prisma.workerLease.update({ where: { name: "all" }, data: { pausedAt: null } });
    expect(await refundsWorker()).toBe("succeeded");
    expect(await refundsWorker()).toBe("succeeded");
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(stripe.create.mock.calls[0][1]).toEqual({ idempotencyKey: request.operationKey });
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("succeeded");
  });
});
