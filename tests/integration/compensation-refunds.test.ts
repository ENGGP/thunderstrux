import type Stripe from "stripe";
import { beforeEach, describe, expect, type MockInstance, test, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/orders/[orderId]/compensation-refund/confirm/route";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import {
  confirmCompensationRefund,
  processCompensationRefundBatch,
  reconcileRefundEvent
} from "@/lib/payments/compensation-refunds";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import { reconcileDisputeEvent, reconcileExternalRefundEvent } from "@/lib/payments/purchase-disputes";
import { heldMoney } from "@/lib/payouts/release";
import { buyerPurchaseBadge, ticketOrderProjection } from "@/lib/purchases/projection";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation,
  unique
} from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { checkoutSession } from "@/tests/helpers/stripe-mocks";

const stripeMock = vi.hoisted(() => ({
  checkout: { sessions: { retrieve: vi.fn() } },
  refunds: {
    list: vi.fn(),
    create: vi.fn(),
    retrieve: vi.fn()
  },
  transfers: { retrieve: vi.fn() },
  paymentIntents: { retrieve: vi.fn() },
  applicationFees: { retrieve: vi.fn() },
  disputes: { retrieve: vi.fn(), update: vi.fn() }
}));

vi.mock("@/lib/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripe")>()),
  getStripe: () => stripeMock
}));

async function automaticCompensationFixture() {
  const { organisation, user: owner } = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember();
  const event = await createEvent({
    organisationId: organisation.id,
    status: "published",
    compensationRefundMode: "automatic_full"
  });
  const ticketType = event.ticketTypes[0];
  const order = await createOrder({
    organisationId: organisation.id,
    eventId: event.id,
    ticketTypeId: ticketType.id,
    userId: member.id,
    status: "failed",
    paidAt: new Date(),
    failedAt: new Date(),
    requiresCompensationReview: true,
    fulfilmentFailedAt: new Date(),
    fulfilmentFailureReason: "inventory_unavailable_after_payment",
    compensationRefundModeSnapshot: "automatic_full"
  });
  const job = await prisma.compensationRefundJob.create({
    data: {
      orderId: order.id,
      state: "auto_queued",
      amount: order.totalAmount,
      currency: "aud"
    }
  });
  return { organisation, owner, member, event, ticketType, order, job };
}

function configureEligibleStripe(fixture: Awaited<ReturnType<typeof automaticCompensationFixture>>) {
  const paymentIntent = {
    id: "pi_compensation",
    amount_received: fixture.order.totalAmount,
    currency: "aud",
    metadata: { orderId: fixture.order.id },
    transfer_data: { destination: fixture.organisation.stripeAccountId },
    latest_charge: { id: "ch_compensation", disputed: false }
  };
  stripeMock.checkout.sessions.retrieve.mockResolvedValue({
    id: fixture.order.stripeSessionId,
    payment_status: "paid",
    amount_total: fixture.order.totalAmount,
    currency: "aud",
    metadata: {
      orderId: fixture.order.id,
      eventId: fixture.event.id,
      organisationId: fixture.organisation.id,
      ticketTypeId: fixture.ticketType.id,
      quantity: String(fixture.order.quantity)
    },
    payment_intent: paymentIntent
  });
  stripeMock.refunds.list.mockResolvedValue({ data: [] });
  return paymentIntent;
}

describe("compensation refunds", () => {
  beforeEach(() => {
    stripeMock.checkout.sessions.retrieve.mockReset();
    stripeMock.refunds.list.mockReset();
    stripeMock.refunds.create.mockReset();
    stripeMock.refunds.retrieve.mockReset();
    stripeMock.transfers.retrieve.mockReset();
    stripeMock.applicationFees.retrieve.mockReset();
  });

  test("fences and completes one eligible automatic destination-charge refund", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_compensation",
      status: "succeeded",
      amount: fixture.order.totalAmount,
      currency: "aud",
      payment_intent: "pi_compensation",
      metadata: {
        compensationRefundJobId: fixture.job.id,
        orderId: fixture.order.id
      }
    });

    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ processed: 1 });
    expect(stripeMock.refunds.create).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: "pi_compensation",
        amount: fixture.order.totalAmount,
        reverse_transfer: true,
        refund_application_fee: true
      }),
      { idempotencyKey: `compensation-refund:${fixture.order.id}` }
    );
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({
      state: "refunded",
      stripeRefundId: "re_compensation",
      processingToken: null
    });
    await expect(prisma.order.findUniqueOrThrow({
      where: { id: fixture.order.id }
    })).resolves.toMatchObject({
      requiresCompensationReview: false,
      isManuallyRefunded: true
    });
    // Thunderstrux's own step, recorded with no person behind it.
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "order.compensation_refund_started", targetId: fixture.order.id } }))
      .toMatchObject({ organisationId: fixture.organisation.id, actorUserId: null, metadata: { attempt: 1 } });
  });

  // DEBT-002: the account the order was paid to, not whichever the society has connected since.
  test("checks the payment against the order's seller account after the society reconnects", async () => {
    const fixture = await automaticCompensationFixture();
    const paidTo = fixture.organisation.stripeAccountId as string;
    await prisma.order.update({ where: { id: fixture.order.id }, data: { sellerStripeAccountId: paidTo } });
    await prisma.organisation.update({ where: { id: fixture.organisation.id }, data: { stripeAccountId: `acct_reconnected_${fixture.organisation.id}` } });
    configureEligibleStripe(fixture);
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_compensation_snapshot", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });

    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ processed: 1 });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(await prisma.compensationRefundJob.findUniqueOrThrow({ where: { id: fixture.job.id } })).toMatchObject({ state: "refunded" });
  });

  test("routes a pre-existing unrelated refund to review without another provider mutation", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ id: "re_other", metadata: {}, status: "succeeded" }]
    });

    await processCompensationRefundBatch();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({
      state: "review_required",
      lastErrorCode: "existing_refund_requires_review"
    });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "order.compensation_refund_review_required", targetId: fixture.order.id } }))
      .toMatchObject({ organisationId: fixture.organisation.id, actorUserId: null, metadata: { reason: "existing_refund_requires_review" } });
  });

  // A charge Stripe once disputed stays `disputed: true` after the dispute closes; the claim fences an open dispute by the order's own state.
  test("routes an absent provider charge to review", async () => {
    for (const latestCharge of [null]) {
      const fixture = await automaticCompensationFixture();
      const paymentIntent = configureEligibleStripe(fixture);
      paymentIntent.latest_charge = latestCharge as never;

      await processCompensationRefundBatch();

      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      await expect(prisma.compensationRefundJob.findUniqueOrThrow({
        where: { id: fixture.job.id }
      })).resolves.toMatchObject({
        state: "review_required",
        lastErrorCode: "provider_identity_not_eligible"
      });
    }
  });

  test("deduplicates signed refund event effects and resolves only succeeded status", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({
      where: { id: fixture.job.id },
      data: {
        state: "refund_pending",
        stripePaymentIntentId: "pi_compensation",
        stripeRefundId: "re_webhook"
      }
    });
    const rejectedRefunds = [
      {
        id: "evt_refund_partial_wrong_identity",
        amount: fixture.order.totalAmount - 1,
        currency: "aud",
        payment_intent: "pi_compensation",
        jobId: fixture.job.id,
        orderId: fixture.order.id
      },
      {
        id: "evt_refund_wrong_currency",
        amount: fixture.order.totalAmount,
        currency: "usd",
        payment_intent: "pi_compensation",
        jobId: fixture.job.id,
        orderId: fixture.order.id
      },
      {
        id: "evt_refund_wrong_payment_intent",
        amount: fixture.order.totalAmount,
        currency: "aud",
        payment_intent: "pi_unrelated",
        jobId: fixture.job.id,
        orderId: fixture.order.id
      },
      {
        id: "evt_refund_misleading_order_only",
        amount: fixture.order.totalAmount,
        currency: "aud",
        payment_intent: "pi_compensation",
        jobId: undefined,
        orderId: fixture.order.id
      }
    ];
    for (const rejected of rejectedRefunds) {
      await reconcileRefundEvent({
        id: rejected.id,
        type: "refund.updated",
        created: 1_799_999_999,
        data: { object: {
          id: "re_webhook",
          status: "succeeded",
          amount: rejected.amount,
          currency: rejected.currency,
          payment_intent: rejected.payment_intent,
          metadata: {
            ...(rejected.jobId
              ? { compensationRefundJobId: rejected.jobId }
              : {}),
            orderId: rejected.orderId
          }
        } }
      } as never);
    }
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({ state: "refund_pending" });
    expect(await prisma.stripeRefundWebhookEvent.count()).toBe(0);

    const event = {
      id: "evt_refund_succeeded",
      type: "refund.updated",
      created: 1_800_000_000,
      data: { object: {
        id: "re_webhook",
        status: "succeeded",
        amount: fixture.order.totalAmount,
        currency: "aud",
        payment_intent: "pi_compensation",
        metadata: {
          compensationRefundJobId: fixture.job.id,
          orderId: fixture.order.id
        }
      } }
    };
    await reconcileRefundEvent(event as never);
    await reconcileRefundEvent(event as never);
    await reconcileRefundEvent({
      ...event,
      id: "evt_refund_same_timestamp_pending",
      data: { object: { ...event.data.object, status: "pending" } }
    } as never);

    expect(await prisma.stripeRefundWebhookEvent.count()).toBe(2);
    expect(await prisma.orderLifecycleEvent.count({
      where: { orderId: fixture.order.id, type: "compensation_refunded" }
    })).toBe(1);
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({ state: "refunded" });
    // Stripe's confirmation, delivered twice, emails the buyer once (T30).
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `compensation-refund/${fixture.job.id}` } })).toBe(1);
  });

  test("polls a pending refund after a missed webhook without creating another refund", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    const pendingRefund = {
      id: "re_pending_poll",
      status: "pending",
      amount: fixture.order.totalAmount,
      currency: "aud",
      payment_intent: "pi_compensation",
      metadata: {
        compensationRefundJobId: fixture.job.id,
        orderId: fixture.order.id
      }
    };
    stripeMock.refunds.create.mockResolvedValue(pendingRefund);

    await processCompensationRefundBatch();
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({
      state: "refund_pending",
      stripeRefundId: "re_pending_poll"
    });

    await prisma.compensationRefundJob.update({
      where: { id: fixture.job.id },
      data: { nextAttemptAt: new Date(0) }
    });
    stripeMock.refunds.list.mockResolvedValue({
      data: [{ ...pendingRefund, status: "succeeded" }]
    });
    await processCompensationRefundBatch();

    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({ state: "refunded" });
  });

  test("creates one automatic job for paid-but-unfulfilled checkout and blocks later recovery", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      compensationRefundMode: "automatic_full"
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      compensationRefundModeSnapshot: "automatic_full",
      stripeSessionId: "cs_auto_unfulfilled"
    });
    const session = checkoutSession({
      id: "cs_auto_unfulfilled",
      orderId: order.id,
      eventId: event.id,
      organisationId: organisation.id,
      ticketTypeId: ticketType.id,
      quantity: 1,
      amountTotal: order.totalAmount
    });

    await expect(reconcileCompletedCheckoutSession(session)).resolves.toMatchObject({
      status: "compensation_required"
    });
    await createReservation({
      orderId: order.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });
    await expect(reconcileCompletedCheckoutSession(session)).resolves.toMatchObject({
      status: "compensation_required"
    });

    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { orderId: order.id }
    })).resolves.toMatchObject({ state: "auto_queued" });
    expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(0);
  });

  test("manual confirmation verifies a full succeeded provider refund before resolving", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({
      where: { id: fixture.job.id },
      data: { state: "review_required" }
    });
    stripeMock.refunds.retrieve.mockResolvedValue({
      id: "re_manual_verified",
      status: "succeeded",
      amount: fixture.order.totalAmount,
      currency: "aud",
      payment_intent: "pi_manual_verified",
      metadata: { orderId: fixture.order.id }
    });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: fixture.order.stripeSessionId,
      payment_status: "paid",
      amount_total: fixture.order.totalAmount,
      currency: "aud",
      metadata: { orderId: fixture.order.id },
      payment_intent: {
        id: "pi_manual_verified",
        transfer_data: { destination: fixture.organisation.stripeAccountId },
        latest_charge: { disputed: false }
      }
    });

    await confirmCompensationRefund(
      fixture.organisation.id,
      fixture.order.id,
      "re_manual_verified",
      fixture.member.id
    );

    await expect(prisma.compensationRefundJob.findUniqueOrThrow({
      where: { id: fixture.job.id }
    })).resolves.toMatchObject({
      state: "refunded",
      stripeRefundId: "re_manual_verified"
    });
  });

  test("manual confirmation rejects an absent charge", async () => {
    for (const latestCharge of [null]) {
      const fixture = await automaticCompensationFixture();
      await prisma.compensationRefundJob.update({
        where: { id: fixture.job.id },
        data: { state: "review_required" }
      });
      stripeMock.refunds.retrieve.mockResolvedValue({
        id: `re_manual_rejected_${latestCharge ? "disputed" : "missing"}`,
        status: "succeeded",
        amount: fixture.order.totalAmount,
        currency: "aud",
        payment_intent: "pi_manual_rejected",
        metadata: { orderId: fixture.order.id }
      });
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        id: fixture.order.stripeSessionId,
        payment_status: "paid",
        amount_total: fixture.order.totalAmount,
        currency: "aud",
        metadata: { orderId: fixture.order.id },
        payment_intent: {
          id: "pi_manual_rejected",
          transfer_data: { destination: fixture.organisation.stripeAccountId },
          latest_charge: latestCharge
        }
      });

      await expect(confirmCompensationRefund(
        fixture.organisation.id,
        fixture.order.id,
        `re_manual_rejected_${latestCharge ? "disputed" : "missing"}`,
        fixture.member.id
      )).rejects.toMatchObject({
        name: "CompensationRefundVerificationError"
      });
    }
  });

  // Failure paths (2026-10-26 test audit): what happens when Stripe errors,
  // declines, or stays pending, and when staff confirm a refund that can't apply.
  const jobState = (id: string) => prisma.compensationRefundJob.findUniqueOrThrow({ where: { id } });
  const historyCount = (orderId: string, type: "compensation_refund_failed" | "compensation_refunded") =>
    prisma.orderLifecycleEvent.count({ where: { orderId, type } });

  test("an order that changed since it was queued goes to review without asking Stripe", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.order.update({ where: { id: fixture.order.id }, data: { isManuallyRefunded: true } });

    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ processed: 0 });
    expect(stripeMock.checkout.sessions.retrieve).not.toHaveBeenCalled();
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "review_required", lastErrorCode: "local_state_not_eligible", processingToken: null });
  });

  test("a provider error retries with a growing delay and gives up after the fifth attempt", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    stripeMock.refunds.create.mockRejectedValue(new Error("socket hang up"));

    const before = Date.now();
    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ results: [{ state: "auto_queued" }] });
    const queued = await jobState(fixture.job.id);
    expect(queued).toMatchObject({ state: "auto_queued", attempts: 1, lastErrorCode: "provider_request_failed", processingToken: null });
    expect(queued.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ processed: 0 });

    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { attempts: 4, nextAttemptAt: new Date(0) } });
    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ results: [{ state: "refund_failed" }] });
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refund_failed", attempts: 5, lastErrorCode: "provider_request_failed" });
    expect(await historyCount(fixture.order.id, "compensation_refund_failed")).toBe(1);
    await expect(prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).resolves.toMatchObject({ requiresCompensationReview: true, isManuallyRefunded: false });

    // A failed job is left for a person; the worker never sends it again.
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { nextAttemptAt: new Date(0) } });
    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ processed: 0 });
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(2);
  });

  test("a refund Stripe declines is recorded as failed and the order stays in review", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_declined", status: "failed", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });

    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ results: [{ state: "refund_failed" }] });
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refund_failed", stripeRefundId: "re_declined", lastErrorCode: "provider_refund_failed", resolvedAt: null });
    expect(await historyCount(fixture.order.id, "compensation_refund_failed")).toBe(1);
    await expect(prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).resolves.toMatchObject({ requiresCompensationReview: true, isManuallyRefunded: false });
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `compensation-refund/${fixture.job.id}` } })).toBe(0);
  });

  test("a refund still pending on the last attempt goes to a person instead of polling forever", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { attempts: 4 } });
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_stuck_pending", status: "pending", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });

    await expect(processCompensationRefundBatch()).resolves.toMatchObject({ results: [{ state: "review_required" }] });
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "review_required", lastErrorCode: "provider_refund_pending_review", stripeRefundId: "re_stuck_pending" });
  });

  test("a refund.failed webhook fails the job; an older event delivered late changes nothing", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({
      where: { id: fixture.job.id },
      data: { state: "refund_pending", stripePaymentIntentId: "pi_compensation", stripeRefundId: "re_webhook_failed" }
    });
    const refundEvent = (id: string, type: string, status: string, created: number) => ({
      id, type, created,
      data: { object: {
        id: "re_webhook_failed", status, amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
        metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
      } }
    }) as never;

    await reconcileRefundEvent(refundEvent("evt_refund_pending_later", "refund.updated", "pending", 1_800_000_100));
    await reconcileRefundEvent(refundEvent("evt_refund_failed_older", "refund.failed", "failed", 1_800_000_000));
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refund_pending", lastErrorCode: null });

    await reconcileRefundEvent(refundEvent("evt_refund_failed", "refund.failed", "failed", 1_800_000_200));
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refund_failed", lastErrorCode: "provider_refund_failed", providerStatus: "failed" });
    expect(await historyCount(fixture.order.id, "compensation_refund_failed")).toBe(1);
    await expect(prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).resolves.toMatchObject({ requiresCompensationReview: true });
  });

  test("manual confirmation refuses another society's order and a refund that is already settled", async () => {
    const fixture = await automaticCompensationFixture();
    const other = await createOrganisationAccount({ stripeReady: true });

    await expect(confirmCompensationRefund(other.organisation.id, fixture.order.id, "re_any", fixture.member.id)).rejects.toMatchObject({ name: "CompensationRefundNotFoundError" });
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();

    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "refunded", stripeRefundId: "re_already_settled" } });
    configureEligibleStripe(fixture);
    stripeMock.refunds.retrieve.mockResolvedValue({
      id: "re_second_claim", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation", metadata: { orderId: fixture.order.id }
    });
    await expect(confirmCompensationRefund(fixture.organisation.id, fixture.order.id, "re_second_claim", fixture.member.id)).rejects.toMatchObject({ name: "CompensationRefundConflictError" });
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refunded", stripeRefundId: "re_already_settled" });
    expect(await historyCount(fixture.order.id, "compensation_refunded")).toBe(0);
  });

  test("the confirm route checks the refund id's shape, answers 404 for another society's order and confirms a verified refund", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "review_required" } });
    configureEligibleStripe(fixture);
    stripeMock.refunds.retrieve.mockResolvedValue({
      id: "re_route_confirmed", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation", metadata: { orderId: fixture.order.id }
    });
    const confirm = (orderId: string, refundId: string) =>
      confirmRoute(jsonRequest(`http://localhost:3000/api/orders/${orderId}/compensation-refund/confirm`, { refundId }), routeContext({ orderId }));

    setMockSession({ userId: fixture.owner.id, email: fixture.owner.email, accountRole: "organisation" });
    expect((await confirm(fixture.order.id, "not-a-refund")).status).toBe(400);
    const other = await createOrganisationAccount({ stripeReady: true });
    setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
    expect((await confirm(fixture.order.id, "re_route_confirmed")).status).toBe(404);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();

    setMockSession({ userId: fixture.owner.id, email: fixture.owner.email, accountRole: "organisation" });
    const confirmed = await confirm(fixture.order.id, "re_route_confirmed");
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({ confirmed: true });
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({ where: { id: fixture.job.id } })).resolves.toMatchObject({ state: "refunded" });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "order.compensation_refund_confirmed", targetId: fixture.order.id } })).toMatchObject({ actorUserId: fixture.owner.id });
  });

  // SEC-036: confirming settles a paid order's review, so it needs a fresh code, as a refund does.
  test("with staff MFA on, the confirm route needs an authenticator code before asking Stripe", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "review_required" } });
    // "enroll" lets the dashboard through without a grant, so the route's own code check answers.
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enroll");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    setMockSession({ userId: fixture.owner.id, email: fixture.owner.email, accountRole: "organisation" });
    const response = await confirmRoute(jsonRequest(`http://localhost:3000/api/orders/${fixture.order.id}/compensation-refund/confirm`, { refundId: "re_needs_code" }), routeContext({ orderId: fixture.order.id }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.details).toEqual([expect.objectContaining({ path: ["mfaCode"] })]);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
    await expect(prisma.compensationRefundJob.findUniqueOrThrow({ where: { id: fixture.job.id } })).resolves.toMatchObject({ state: "review_required" });
  });

  // PAY-026: a compensation refund that stops for a person raises an alert.
  const reviewAlerts = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map(([line]) => String(line)).filter((line) => line.includes('"event":"compensation_refund_needs_review"')).map((line) => JSON.parse(line));

  test("a refund that goes to review or fails alerts a person once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const unrelated = await automaticCompensationFixture();
    configureEligibleStripe(unrelated);
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_other", metadata: {}, status: "succeeded" }] });
    await processCompensationRefundBatch();

    const declined = await automaticCompensationFixture();
    configureEligibleStripe(declined);
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_declined_alert", status: "failed", amount: declined.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: declined.job.id, orderId: declined.order.id }
    });
    await processCompensationRefundBatch();

    expect(reviewAlerts(error)).toEqual([
      expect.objectContaining({ compensationRefundJobId: unrelated.job.id, orderId: unrelated.order.id, state: "review_required", reason: "existing_refund_requires_review" }),
      expect.objectContaining({ compensationRefundJobId: declined.job.id, orderId: declined.order.id, state: "refund_failed", reason: "provider_refund_failed" })
    ]);
  });

  // PAY-025: Stripe returns the money to Thunderstrux's balance; a person repays the buyer.
  test("a refund that came back from the bank after succeeding keeps the job refunded, alerts once and tells the buyer", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({
      where: { id: fixture.job.id },
      data: { state: "refunded", stripePaymentIntentId: "pi_compensation", stripeRefundId: "re_returned", resolvedAt: new Date() }
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const refundEvent = (id: string, type: string) => ({
      id, type, created: Math.floor(Date.now() / 1000),
      data: { object: {
        id: "re_returned", status: "failed", failure_reason: "lost_or_stolen_card", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
        metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
      } }
    }) as never;

    await reconcileRefundEvent(refundEvent("evt_refund_returned", "refund.failed"));
    await reconcileRefundEvent(refundEvent("evt_refund_returned_update", "refund.updated"));

    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refunded", providerStatus: "failed", lastErrorCode: "provider_refund_returned" });
    expect(await prisma.orderLifecycleEvent.findMany({ where: { orderId: fixture.order.id, type: "compensation_refund_failed" }, select: { reason: true } })).toEqual([{ reason: "returned_by_bank" }]);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `compensation-refund-returned/${fixture.job.id}` } })).toBe(1);
    expect(reviewAlerts(error)).toEqual([expect.objectContaining({ compensationRefundJobId: fixture.job.id, state: "refunded", reason: "returned_by_bank" })]);
  });

  // PAY-027: a Dashboard refund settles the order only once the money came back from the society too.
  test("manual confirmation needs the society's transfer reversed and Thunderstrux's fee refunded", async () => {
    const fixture = await automaticCompensationFixture();
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "review_required" } });
    const total = fixture.order.totalAmount;
    stripeMock.refunds.retrieve.mockResolvedValue({ id: "re_dashboard", status: "succeeded", amount: total, currency: "aud", payment_intent: "pi_dashboard", metadata: {} });
    stripeMock.checkout.sessions.retrieve.mockResolvedValue({
      id: fixture.order.stripeSessionId, payment_status: "paid", amount_total: total, currency: "aud", metadata: { orderId: fixture.order.id },
      payment_intent: {
        id: "pi_dashboard", transfer_data: { destination: fixture.organisation.stripeAccountId },
        latest_charge: { id: "ch_dashboard", amount_refunded: total, transfer: "tr_dashboard", application_fee: "fee_dashboard" }
      }
    });
    const confirm = () => confirmCompensationRefund(fixture.organisation.id, fixture.order.id, "re_dashboard", fixture.member.id);

    stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_dashboard", amount_reversed: 0 });
    stripeMock.applicationFees.retrieve.mockResolvedValue({ id: "fee_dashboard", amount: 100, amount_refunded: 100 });
    await expect(confirm()).rejects.toMatchObject({ code: "manual_refund_not_reversed", message: expect.stringContaining("Reverse the transfer") });
    stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_dashboard", amount_reversed: total });
    stripeMock.applicationFees.retrieve.mockResolvedValue({ id: "fee_dashboard", amount: 100, amount_refunded: 0 });
    await expect(confirm()).rejects.toMatchObject({ code: "manual_refund_not_reversed" });
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "review_required" });

    stripeMock.applicationFees.retrieve.mockResolvedValue({ id: "fee_dashboard", amount: 100, amount_refunded: 100 });
    await confirm();
    await expect(jobState(fixture.job.id)).resolves.toMatchObject({ state: "refunded", stripeRefundId: "re_dashboard" });
  });
});

// PAY-056: Stripe refuses a refund while a dispute is open, so the worker stops the job.
// Winning the dispute is what makes the refund possible again.
describe("a dispute holding a compensation refund", () => {
  type Fixture = Awaited<ReturnType<typeof automaticCompensationFixture>>;
  beforeEach(() => {
    for (const mock of [stripeMock.checkout.sessions.retrieve, stripeMock.refunds.list, stripeMock.refunds.create, stripeMock.disputes.retrieve, stripeMock.disputes.update, stripeMock.paymentIntents.retrieve, stripeMock.transfers.retrieve]) mock.mockReset();
  });

  // Stripe's dispute as it stands now, and an event about it.
  function disputeEvent(fixture: Fixture, status: string, type = "charge.dispute.updated", id = `dp_${fixture.order.id}`, amount = fixture.order.totalAmount) {
    const dispute = {
      id, object: "dispute", charge: "ch_compensation", payment_intent: "pi_compensation", amount, currency: "aud",
      status, reason: "fraudulent", evidence_details: { due_by: 1_800_000_000 }
    };
    stripeMock.disputes.retrieve.mockResolvedValue(dispute);
    return { id: unique("evt"), object: "event", type, created: Math.floor(Date.now() / 1000), data: { object: dispute } } as unknown as Stripe.Event;
  }
  const disputeIs = (...args: Parameters<typeof disputeEvent>) => reconcileDisputeEvent(disputeEvent(...args));
  // A queued refund the worker found disputed, as the order and job then stand.
  async function stoppedByDispute() {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    await processCompensationRefundBatch();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    return fixture;
  }
  const job = (fixture: Fixture) => prisma.compensationRefundJob.findUniqueOrThrow({ where: { id: fixture.job.id } });
  const requeued = (fixture: Fixture) => prisma.orderLifecycleEvent.count({ where: { orderId: fixture.order.id, type: "compensation_refund_queued" } });
  const closedNotices = (fixture: Fixture) => prisma.notificationOutbox.count({ where: { eventKey: `payment-review-closed/${fixture.order.id}` } });
  const closedNotice = async (fixture: Fixture) => {
    const [row, ...more] = await prisma.notificationOutbox.findMany({ where: { eventKey: `payment-review-closed/${fixture.order.id}` } });
    expect(more).toEqual([]);
    return JSON.stringify(decryptNotification(row.encryptedPayload, row.id));
  };
  const closures = (fixture: Fixture) => prisma.auditLog.findMany({ where: { targetId: fixture.order.id, action: "order.compensation_review_closed" }, select: { actorUserId: true, metadata: true } });
  const refundedRows = (fixture: Fixture) => prisma.orderLifecycleEvent.findMany({ where: { orderId: fixture.order.id, type: "refunded" }, select: { reason: true, source: true } });
  // A refund made in Stripe's dashboard, as Stripe then lists the payment's refunds.
  function outsideRefund(fixture: Fixture, amount: number) {
    const refund = { id: unique("re"), object: "refund", status: "succeeded", amount, currency: "aud", payment_intent: "pi_compensation", metadata: {} };
    stripeMock.refunds.list.mockResolvedValue({ data: [refund] });
    return { id: unique("evt"), object: "event", type: "refund.created", created: Math.floor(Date.now() / 1000), data: { object: refund } } as unknown as Stripe.Event;
  }
  const paidAgain = (fixture: Fixture) => reconcileCompletedCheckoutSession(checkoutSession({
    id: fixture.order.stripeSessionId as string, orderId: fixture.order.id, eventId: fixture.event.id, organisationId: fixture.organisation.id,
    ticketTypeId: fixture.ticketType.id, quantity: fixture.order.quantity, amountTotal: fixture.order.totalAmount
  }));
  const partAlerts = (error: MockInstance) => error.mock.calls.filter(([line]) => String(line).includes('"reason":"dispute_lost_for_part"'));
  const wonAlerts = (error: MockInstance) => error.mock.calls
    .filter(([line]) => String(line).includes('"event":"compensation_refund_needs_review"') && String(line).includes('"reason":"dispute_won"'));

  test("an automatic refund a dispute stopped carries on when the society wins it, once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    expect(await job(fixture)).toMatchObject({ state: "review_required", lastErrorCode: "local_state_not_eligible", attempts: 1 });

    // Two of Stripe's events at once, then one of them again.
    const won = disputeEvent(fixture, "won", "charge.dispute.closed");
    await Promise.all([reconcileDisputeEvent(won), reconcileDisputeEvent(disputeEvent(fixture, "won"))]);
    await reconcileDisputeEvent(won);
    expect(await job(fixture)).toMatchObject({ state: "auto_queued", lastErrorCode: null, lastErrorAt: null, attempts: 0 });
    expect(await requeued(fixture)).toBe(1);
    expect(await prisma.auditLog.findMany({ where: { targetId: fixture.order.id, action: "order.compensation_refund_queued" }, select: { actorUserId: true, metadata: true } }))
      .toEqual([{ actorUserId: null, metadata: { reason: "dispute_won" } }]);
    expect(wonAlerts(error)).toEqual([]);

    stripeMock.refunds.create.mockResolvedValue({
      id: "re_after_win", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });
    await processCompensationRefundBatch();
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(await job(fixture)).toMatchObject({ state: "refunded", stripeRefundId: "re_after_win" });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(order).toMatchObject({ requiresCompensationReview: false, isManuallyRefunded: true });
    expect(ticketOrderProjection(order)).toBe("refunded");
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `compensation-refund/${fixture.job.id}` } })).toBe(1);
  });

  test("the job waits while another dispute is open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    await disputeIs(fixture, "needs_response", "charge.dispute.created", `dp_second_${fixture.order.id}`);
    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "review_required" });
    await disputeIs(fixture, "won", "charge.dispute.closed", `dp_second_${fixture.order.id}`);
    expect(await job(fixture)).toMatchObject({ state: "auto_queued" });
  });

  // PAY-057: the bank already returned the money, so nothing is owed and nobody has anything to do.
  test("a lost dispute closes the review and its job, once, and tells the buyer", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    const lost = disputeEvent(fixture, "lost", "charge.dispute.closed");
    await Promise.all([reconcileDisputeEvent(lost), reconcileDisputeEvent(disputeEvent(fixture, "lost"))]);
    await reconcileDisputeEvent(lost);
    expect(await job(fixture)).toMatchObject({ state: "refunded", lastErrorCode: null, lastErrorAt: null, stripeRefundId: null, resolvedAt: expect.any(Date) });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } });
    // refundStatus stays clear: a refunded order would drop out of the payout hold its reversal needs.
    expect(order).toMatchObject({ requiresCompensationReview: false, disputeStatus: "lost", refundStatus: null, isManuallyRefunded: false });
    expect(buyerPurchaseBadge(order)).toEqual({ status: "refunded", label: "Refunded by your bank" });
    expect(await closedNotice(fixture)).toContain("returned the payment to you");
    expect(await closures(fixture)).toEqual([{ actorUserId: null, metadata: { reason: "dispute_lost" } }]);
    expect(await refundedRows(fixture)).toEqual([{ reason: "dispute_lost", source: "stripe_webhook" }]);
    expect(await requeued(fixture)).toBe(0);
    expect(wonAlerts(error)).toEqual([]);
    expect(partAlerts(error)).toEqual([]);
  });

  test.each(["auto_queued", "auto_processing", "refund_pending", "review_required", "refund_failed"] as const)("a lost dispute closes a job left %s, and the worker has nothing more to do", async (state) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state, processingToken: "held", processingStartedAt: new Date(0) } });
    await disputeIs(fixture, "lost", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "refunded", processingToken: null, processingStartedAt: null });
    expect(await processCompensationRefundBatch()).toMatchObject({ processed: 0 });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  // Banks can dispute part of a charge. Closing on that would leave the rest of the buyer's money with nobody watching.
  test("a dispute lost for part of the payment stays with a person until a refund in Stripe covers the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    const part = fixture.order.totalAmount - 500;
    await disputeIs(fixture, "lost", "charge.dispute.closed", undefined, part);
    expect(await job(fixture)).toMatchObject({ state: "review_required", lastErrorCode: "local_state_not_eligible" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: true, disputeStatus: "lost" });
    expect(await closedNotices(fixture)).toBe(0);
    expect(partAlerts(error)).toHaveLength(1);

    await reconcileExternalRefundEvent(outsideRefund(fixture, 500));
    expect(await job(fixture)).toMatchObject({ state: "refunded" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: false, disputeStatus: "lost", refundStatus: null, externalRefundedAmount: 500 });
    expect(await closedNotices(fixture)).toBe(1);
  });

  // The society chose to decide by hand, so a person hears once that it can be refunded now.
  test("a manual order stays with a person, who is told when the society wins", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { compensationRefundModeSnapshot: "manual_review", stripePaymentIntentId: "pi_compensation" } });
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "review_required" } });
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    const won = disputeEvent(fixture, "won", "charge.dispute.closed");
    await reconcileDisputeEvent(won);
    await reconcileDisputeEvent(won);
    await disputeIs(fixture, "won");
    expect(await job(fixture)).toMatchObject({ state: "review_required" });
    expect(await requeued(fixture)).toBe(0);
    expect(wonAlerts(error)).toHaveLength(1);
  });

  test("a job something else stopped stays with a person, who is told when the society wins", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { lastErrorCode: "existing_refund_requires_review" } });
    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "review_required", lastErrorCode: "existing_refund_requires_review" });
    expect(wonAlerts(error)).toHaveLength(1);
  });

  // PAY-036: a ticket order keeps `won` until staff restore its tickets, and a compensation order has none.
  test("a won dispute doesn't stop a queued automatic refund", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { disputeStatus: "won" } });
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_won_before", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });
    await processCompensationRefundBatch();
    expect(await job(fixture)).toMatchObject({ state: "refunded" });
  });

  // PAY-057: a refund made in Stripe that covers the payment leaves the buyer nothing to wait for.
  test("a full refund made in Stripe closes the review, once, and keeps the email the review promised", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    const refund = outsideRefund(fixture, fixture.order.totalAmount);
    await reconcileExternalRefundEvent(refund);
    await reconcileExternalRefundEvent(refund);
    await reconcileExternalRefundEvent({ ...refund, id: unique("evt"), type: "refund.updated" } as Stripe.Event);
    expect(await job(fixture)).toMatchObject({ state: "refunded", stripeRefundId: null, resolvedAt: expect.any(Date) });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } });
    expect(order).toMatchObject({ requiresCompensationReview: false, refundStatus: "refunded", isManuallyRefunded: false, externalRefundedAmount: order.totalAmount });
    expect(ticketOrderProjection(order)).toBe("refunded");
    expect(await closedNotice(fixture)).toContain("refunded to your card");
    expect(await closures(fixture)).toEqual([{ actorUserId: null, metadata: { reason: "refunded_outside" } }]);
    expect(await refundedRows(fixture)).toEqual([{ reason: "refunded_outside", source: "stripe_webhook" }]);
    expect(await prisma.orderLifecycleEvent.findFirstOrThrow({ where: { orderId: fixture.order.id, type: "external_refund_recorded" } })).toMatchObject({ reason: "full" });
    expect(await processCompensationRefundBatch()).toMatchObject({ processed: 0 });
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
  });

  test("a partial refund made in Stripe leaves the review open", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    await reconcileExternalRefundEvent(outsideRefund(fixture, 500));
    expect(await job(fixture)).toMatchObject({ state: "auto_queued" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: true, refundStatus: null, externalRefundedAmount: 500 });
    expect(await closedNotices(fixture)).toBe(0);
  });

  // PAY-027: the buyer was paid back, so the society's share stays held until Stripe shows it reversed.
  test("a closed review keeps holding what a refund in Stripe didn't take back from the society", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    const account = fixture.organisation.stripeAccountId as string;
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation", sellerStripeAccountId: account } });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: "ch_compensation", amount_refunded: fixture.order.totalAmount, transfer: "tr_compensation" } });
    stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_compensation", amount_reversed: 0 });
    await reconcileExternalRefundEvent(outsideRefund(fixture, fixture.order.totalAmount));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: false, externalUnreversedAmount: fixture.order.totalAmount });
    expect((await heldMoney(fixture.organisation.id, account)).total).toBeGreaterThan(0);
  });

  // Evidence goes to a bank: a refund made in Stripe is one refund, however the review closed.
  test("a dispute after a closed review counts the refund made in Stripe once", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    await reconcileExternalRefundEvent(outsideRefund(fixture, fixture.order.totalAmount));
    stripeMock.disputes.update.mockResolvedValue({});
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    const text = stripeMock.disputes.update.mock.calls[0][1].evidence.uncategorized_text as string;
    expect(text.match(/Refunded /g)).toHaveLength(1);
  });

  // Stripe fails a refund still pending on a disputed charge. That isn't a refund the bank sent back.
  test("a pending refund that fails after a lost dispute closed the review doesn't read as returned", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "refund_pending", stripeRefundId: "re_pending", stripePaymentIntentId: "pi_compensation" } });
    await disputeIs(fixture, "lost", "charge.dispute.closed");
    await reconcileRefundEvent({ id: unique("evt"), object: "event", type: "refund.failed", created: Math.floor(Date.now() / 1000), data: { object: {
      id: "re_pending", object: "refund", status: "failed", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation", metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    } } } as unknown as Stripe.Event);
    expect(await job(fixture)).toMatchObject({ state: "refunded", lastErrorCode: null });
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `compensation-refund-returned/${fixture.job.id}` } })).toBe(0);
    expect(error.mock.calls.filter(([line]) => String(line).includes("returned_by_bank"))).toEqual([]);
  });

  // Stripe: a lost dispute can still turn to won, on a late win or a withdrawal long after the loss.
  test("a dispute that turns from lost to won reopens the closed review and refunds the buyer, once", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    await disputeIs(fixture, "lost", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "refunded" });
    const won = disputeEvent(fixture, "won");
    await Promise.all([reconcileDisputeEvent(won), reconcileDisputeEvent(disputeEvent(fixture, "won", "charge.dispute.closed"))]);
    await reconcileDisputeEvent(won);
    expect(await job(fixture)).toMatchObject({ state: "auto_queued", resolvedAt: null, lastErrorCode: null, attempts: 0 });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: true, disputeStatus: "won", refundStatus: null });
    expect(await requeued(fixture)).toBe(1);
    expect(await prisma.orderLifecycleEvent.findMany({ where: { orderId: fixture.order.id, type: "compensation_required" }, select: { reason: true } })).toEqual([{ reason: "dispute_won" }]);
    expect(wonAlerts(error)).toEqual([]);

    stripeMock.refunds.create.mockResolvedValue({
      id: "re_late_win", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });
    await processCompensationRefundBatch();
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    expect(await job(fixture)).toMatchObject({ state: "refunded", stripeRefundId: "re_late_win" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: false, isManuallyRefunded: true });
  });

  test("a manual order reopened by a late win goes to a person", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { compensationRefundModeSnapshot: "manual_review", stripePaymentIntentId: "pi_compensation" } });
    await prisma.compensationRefundJob.update({ where: { id: fixture.job.id }, data: { state: "review_required" } });
    await disputeIs(fixture, "lost", "charge.dispute.closed");
    await disputeIs(fixture, "won");
    expect(await job(fixture)).toMatchObject({ state: "review_required", resolvedAt: null, lastErrorCode: null });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: true });
    expect(await requeued(fixture)).toBe(0);
    expect(wonAlerts(error)).toHaveLength(1);
  });

  // Those buyers have their money from a refund, which a dispute's outcome doesn't take back.
  test("a won dispute never reopens an order a refund settled", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: null });
    await reconcileExternalRefundEvent(outsideRefund(fixture, fixture.order.totalAmount));
    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "refunded" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: false, refundStatus: "refunded" });
  });

  test("a won dispute never reopens an order its compensation refund settled", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_settled_first", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });
    await processCompensationRefundBatch();
    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "refunded", stripeRefundId: "re_settled_first" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: false });
  });

  // Stripe redelivers paid events, and each goes through settlement again.
  test("a replayed paid event doesn't reopen a closed review", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await stoppedByDispute();
    await disputeIs(fixture, "lost", "charge.dispute.closed");
    error.mockClear();
    await expect(paidAgain(fixture)).resolves.toMatchObject({ status: "compensation_required", orderId: fixture.order.id });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ status: "failed", requiresCompensationReview: false });
    expect(error.mock.calls.filter(([line]) => String(line).includes("paid_but_unfulfilled_compensation_required"))).toEqual([]);
  });

  test("a replayed paid event doesn't reopen an order its compensation refund settled", async () => {
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    stripeMock.refunds.create.mockResolvedValue({
      id: "re_settled", status: "succeeded", amount: fixture.order.totalAmount, currency: "aud", payment_intent: "pi_compensation",
      metadata: { compensationRefundJobId: fixture.job.id, orderId: fixture.order.id }
    });
    await processCompensationRefundBatch();
    expect(await job(fixture)).toMatchObject({ state: "refunded" });
    await paidAgain(fixture);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ requiresCompensationReview: false, isManuallyRefunded: true });
  });

  test("a job nothing stopped is left alone", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    configureEligibleStripe(fixture);
    await prisma.order.update({ where: { id: fixture.order.id }, data: { stripePaymentIntentId: "pi_compensation" } });
    await disputeIs(fixture, "needs_response", "charge.dispute.created");
    await disputeIs(fixture, "won", "charge.dispute.closed");
    expect(await job(fixture)).toMatchObject({ state: "auto_queued" });
    expect(await requeued(fixture)).toBe(0);
    expect(wonAlerts(error)).toEqual([]);
  });

  // The payment reached review after the bank had already returned it.
  test("a lost dispute stops a queued automatic refund", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fixture = await automaticCompensationFixture();
    await prisma.order.update({ where: { id: fixture.order.id }, data: { disputeStatus: "lost" } });
    await processCompensationRefundBatch();
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(await job(fixture)).toMatchObject({ state: "review_required", lastErrorCode: "local_state_not_eligible" });
  });
});
