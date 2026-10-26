import { beforeEach, describe, expect, test, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/orders/[orderId]/compensation-refund/confirm/route";
import { prisma } from "@/lib/db";
import {
  confirmCompensationRefund,
  processCompensationRefundBatch,
  reconcileRefundEvent
} from "@/lib/payments/compensation-refunds";
import { reconcileCompletedCheckoutSession } from "@/lib/payments/checkout-reconciliation";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
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
  }
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
    latest_charge: { disputed: false }
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
});
