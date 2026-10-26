import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { POST as refundRoute } from "@/app/api/orders/[orderId]/refunds/route";
import { prisma } from "@/lib/db";
import { lockOrder } from "@/lib/payments/order-lifecycle";
import { processCompensationRefundBatch } from "@/lib/payments/compensation-refunds";
import { OrderRefundError, orderReference, processOrderRefundBatch, reconcileOrderRefundEvent, requestOrderRefund } from "@/lib/payments/order-refunds";
import { createTestRateLimitBackend, setRateLimitTestBackend } from "@/lib/security/rate-limit";
import { setMockSession } from "@/tests/helpers/auth";
import { enrolStaffMfa } from "@/tests/helpers/mfa";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createEvent, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { retrieve: stripe.retrieve } }, refunds: { list: stripe.list, create: stripe.create } })
}));

// Most cases test the refund logic; the authenticator requirement has its own case.
beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });
afterEach(() => { stripe.retrieve.mockReset(); stripe.list.mockReset(); stripe.create.mockReset(); });

// A paid, fulfilled two-ticket order and a Stripe that agrees about it.
async function paidOrder() {
  const owner = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
  const created = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
  const order = await prisma.order.update({ where: { id: created.id }, data: { sellerStripeAccountId: owner.organisation.stripeAccountId } });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: owner.organisation.id })) });
  await prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: "buyer@example.com", buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });
  const intentId = unique("pi");
  stripe.retrieve.mockResolvedValue({
    payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: order.id },
    payment_intent: { id: intentId, amount_received: 3000, transfer_data: { destination: owner.organisation.stripeAccountId }, latest_charge: { disputed: false } }
  });
  stripe.list.mockResolvedValue({ data: [] });
  return { owner, event, order, intentId };
}

const providerRefund = (fixture: { intentId: string; order: { id: string } }, requestId: string, status = "succeeded") =>
  ({ id: unique("re"), status, amount: 3000, currency: "aud", payment_intent: fixture.intentId, metadata: { refundRequestId: requestId, orderId: fixture.order.id } }) as unknown as Stripe.Refund;

const refundInput = (fixture: Awaited<ReturnType<typeof paidOrder>>, extra: Partial<{ confirmation: string }> = {}) => ({
  organisationId: fixture.owner.organisation.id, orderId: fixture.order.id, actor: { id: fixture.owner.user.id },
  reason: "Event moved to a date the buyer can't attend.", confirmation: orderReference(fixture.order.id), ...extra
});

describe("whole-order refunds", () => {
  test("a confirmed refund voids the tickets, keeps the order paid, records history and emails the buyer, and puts no tickets back on sale", async () => {
    const fixture = await paidOrder();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId));
    setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });

    const response = await refundRoute(
      jsonRequest(`http://localhost:3000/api/orders/${fixture.order.id}/refunds`, { reason: "Event moved to a date the buyer can't attend.", confirmation: orderReference(fixture.order.id).toLowerCase() }),
      routeContext({ orderId: fixture.order.id })
    );
    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toMatchObject({ status: "succeeded" });

    const request = await prisma.refundRequest.findFirstOrThrow({ where: { orderId: fixture.order.id } });
    const [params, options] = stripe.create.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: fixture.intentId, amount: 3000, reverse_transfer: true, refund_application_fee: true });
    expect(options).toEqual({ idempotencyKey: request.operationKey });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ status: "paid", refundStatus: "refunded", stripePaymentIntentId: fixture.intentId });
    expect(await prisma.ticket.findMany({ where: { orderId: fixture.order.id }, select: { validity: true, validityReason: true } })).toEqual([
      { validity: "void", validityReason: "refunded" }, { validity: "void", validityReason: "refunded" }
    ]);
    expect((await prisma.orderLifecycleEvent.findMany({ where: { orderId: fixture.order.id }, orderBy: { sequence: "asc" } })).map((event) => event.type)).toEqual(expect.arrayContaining(["refund_requested", "refunded"]));
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `refund/${request.id}`, recipient: "buyer@example.com" } })).toBe(1);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "order.refund_requested", targetId: fixture.order.id } }))
      .toMatchObject({ organisationId: fixture.owner.organisation.id, actorUserId: fixture.owner.user.id, metadata: expect.objectContaining({ amount: 3000 }) });
    // A refund never reopens tickets: stock stays as the sale left it.
    expect((await prisma.ticketType.findUniqueOrThrow({ where: { id: fixture.event.ticketTypes[0].id } })).quantity).toBe(fixture.event.ticketTypes[0].quantity);
  });

  test("the wrong reference, a free or unpaid order, compensation and a second refund are refused before Stripe", async () => {
    const fixture = await paidOrder();
    await expect(requestOrderRefund(refundInput(fixture, { confirmation: "WRONG1" }))).rejects.toMatchObject({ kind: "confirmation_mismatch" });
    for (const change of [{ requiresCompensationReview: true }, { isManuallyRefunded: true }]) {
      await prisma.order.update({ where: { id: fixture.order.id }, data: change });
      await expect(requestOrderRefund(refundInput(fixture))).rejects.toMatchObject({ kind: "not_refundable" });
      await prisma.order.update({ where: { id: fixture.order.id }, data: { requiresCompensationReview: false, isManuallyRefunded: false } });
    }
    // A free registration and a checkout still waiting on Stripe have nothing to refund.
    const free = await createOrder({ organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id, status: "paid", paidAt: new Date(), paymentKind: "free", unitPrice: 0 });
    const pending = await createOrder({ organisationId: fixture.owner.organisation.id, eventId: fixture.event.id, ticketTypeId: fixture.event.ticketTypes[0].id });
    for (const other of [free, pending]) {
      await expect(requestOrderRefund({ ...refundInput(fixture), orderId: other.id, confirmation: orderReference(other.id) })).rejects.toMatchObject({ kind: "not_refundable" });
    }
    expect(stripe.retrieve).not.toHaveBeenCalled();
    expect(await prisma.refundRequest.count()).toBe(0);
  });

  test("two refunds at once make one request and one Stripe call", async () => {
    const fixture = await paidOrder();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId));
    const results = await Promise.allSettled([requestOrderRefund(refundInput(fixture)), requestOrderRefund(refundInput(fixture))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(OrderRefundError);
    expect(["in_progress", "already_refunded"]).toContain(refused.reason.kind);
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(await prisma.refundRequest.count()).toBe(1);
  });

  test("a pending refund holds the fence until the signed webhook confirms it; duplicates and foreign events change nothing", async () => {
    const fixture = await paidOrder();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId, "pending"));
    const pending = await requestOrderRefund(refundInput(fixture));
    expect(pending.status).toBe("pending");
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "processing" });
    expect(await prisma.ticket.count({ where: { orderId: fixture.order.id, validity: "active" } })).toBe(2);

    const event = (refund: Stripe.Refund, id = unique("evt")) => ({ id, type: "refund.updated", created: Math.floor(Date.now() / 1000), data: { object: refund } }) as unknown as Stripe.Event;
    const foreign = { ...providerRefund(fixture, pending.refundRequestId), payment_intent: "pi_someone_else" } as Stripe.Refund;
    await reconcileOrderRefundEvent(event(foreign));
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "processing" });

    const succeeded = event(providerRefund(fixture, pending.refundRequestId));
    await reconcileOrderRefundEvent(succeeded);
    await reconcileOrderRefundEvent(succeeded);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "refunded" });
    expect(await prisma.orderLifecycleEvent.count({ where: { orderId: fixture.order.id, type: "refunded" } })).toBe(1);
    // The replayed event adds no second History row (T38).
    expect(await prisma.auditLog.count({ where: { targetId: fixture.order.id, action: "order.refund_succeeded" } })).toBe(1);
  });

  test("a webhook delivery that fails to apply is applied by Stripe's retry, not dropped as a duplicate (PAY-014)", async () => {
    const fixture = await paidOrder();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId, "pending"));
    const pending = await requestOrderRefund(refundInput(fixture));
    const delivery = { id: unique("evt"), type: "refund.updated", created: Math.floor(Date.now() / 1000), data: { object: providerRefund(fixture, pending.refundRequestId) } } as unknown as Stripe.Event;
    vi.spyOn(prisma, "$transaction").mockRejectedValueOnce(new Error("connection reset"));
    await expect(reconcileOrderRefundEvent(delivery)).rejects.toThrow("connection reset");
    expect(await prisma.stripeRefundWebhookEvent.count({ where: { stripeEventId: delivery.id } })).toBe(0);

    await reconcileOrderRefundEvent(delivery);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "refunded" });
    expect(await prisma.stripeRefundWebhookEvent.count({ where: { stripeEventId: delivery.id } })).toBe(1);
  });

  test("a staff path locks only its own society's order, and another society's refund finds nothing (T53)", async () => {
    const fixture = await paidOrder();
    const other = await createOrganisationAccount({ stripeReady: true });
    expect(await prisma.$transaction((tx) => lockOrder(tx, fixture.order.id, other.organisation.id))).toBe(false);
    expect(await prisma.$transaction((tx) => lockOrder(tx, fixture.order.id, fixture.owner.organisation.id))).toBe(true);
    await expect(requestOrderRefund({ ...refundInput(fixture), organisationId: other.organisation.id })).rejects.toMatchObject({ kind: "not_found" });
    expect(stripe.create).not.toHaveBeenCalled();
  });

  test("a lost Stripe response is looked up before the same key is sent again", async () => {
    const fixture = await paidOrder();
    stripe.create.mockRejectedValueOnce(new Error("socket hang up"));
    const lost = await requestOrderRefund(refundInput(fixture));
    expect(lost.status).toBe("uncertain");
    expect(await prisma.ticket.count({ where: { orderId: fixture.order.id, validity: "active" } })).toBe(2);
    const request = await prisma.refundRequest.findUniqueOrThrow({ where: { id: lost.refundRequestId } });

    // Stripe did make it: the worker finds it and never calls create again.
    stripe.list.mockResolvedValue({ data: [providerRefund(fixture, request.id)] });
    await processOrderRefundBatch(25, new Date(Date.now() + 2 * 60 * 1000));
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "refunded" });
  });

  test("once a refund may exist, a throttled or mismatched lookup keeps the request open, and Stripe's later success voids the tickets (SEC-011)", async () => {
    const fixture = await paidOrder();
    stripe.create.mockRejectedValueOnce(new Error("socket hang up"));
    const lost = await requestOrderRefund(refundInput(fixture));
    expect(lost.status).toBe("uncertain");
    const open = async () => {
      expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: lost.refundRequestId } })).toMatchObject({ status: "uncertain" });
      expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "processing" });
    };

    // A throttled read is a definite Stripe error, but it says nothing about the refund.
    stripe.list.mockRejectedValueOnce(Object.assign(new Error("Too many requests"), { type: "StripeRateLimitError" }));
    await processOrderRefundBatch(25, new Date(Date.now() + 2 * 60 * 1000));
    await open();
    // Nor does a lookup that can't find it among other refunds.
    stripe.list.mockResolvedValueOnce({ data: [{ id: "re_dashboard", status: "succeeded", amount: 500, metadata: {} }] });
    await processOrderRefundBatch(25, new Date(Date.now() + 10 * 60 * 1000));
    await open();
    expect(stripe.create).toHaveBeenCalledTimes(1);

    await reconcileOrderRefundEvent({ id: unique("evt"), type: "refund.updated", created: Math.floor(Date.now() / 1000), data: { object: providerRefund(fixture, lost.refundRequestId) } } as unknown as Stripe.Event);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "refunded" });
    expect(await prisma.ticket.count({ where: { orderId: fixture.order.id, validity: "active" } })).toBe(0);
  });

  test("when Stripe has no refund for it, the worker retries with the same key; a definite refusal lifts the fence", async () => {
    const fixture = await paidOrder();
    stripe.create.mockRejectedValueOnce(new Error("timeout"));
    const lost = await requestOrderRefund(refundInput(fixture));
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId));
    await processOrderRefundBatch(25, new Date(Date.now() + 2 * 60 * 1000));
    const keys = stripe.create.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
    expect((await prisma.refundRequest.findUniqueOrThrow({ where: { id: lost.refundRequestId } })).status).toBe("succeeded");

    const refused = await paidOrder();
    stripe.create.mockReset().mockRejectedValue(Object.assign(new Error("insufficient funds"), { type: "StripeInvalidRequestError" }));
    await expect(requestOrderRefund(refundInput(refused))).rejects.toMatchObject({ kind: "provider_refused" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: refused.order.id } })).toMatchObject({ refundStatus: null });
    expect(await prisma.ticket.count({ where: { orderId: refused.order.id, validity: "active" } })).toBe(2);
  });

  test("a refund Stripe already has from elsewhere, or a disputed charge, stops the request for review", async () => {
    const fixture = await paidOrder();
    stripe.list.mockResolvedValue({ data: [{ id: "re_dashboard", status: "succeeded", metadata: {} }] });
    await expect(requestOrderRefund(refundInput(fixture))).rejects.toMatchObject({ kind: "verification_failed" });
    expect(await prisma.refundRequest.findFirstOrThrow({ where: { orderId: fixture.order.id } })).toMatchObject({ status: "failed", lastErrorCode: "existing_refund_requires_review" });

    const disputed = await paidOrder();
    stripe.retrieve.mockResolvedValue({
      payment_status: "paid", amount_total: 3000, currency: "aud", metadata: { orderId: disputed.order.id },
      payment_intent: { id: disputed.intentId, amount_received: 3000, transfer_data: { destination: disputed.owner.organisation.stripeAccountId }, latest_charge: { disputed: true } }
    });
    await expect(requestOrderRefund(refundInput(disputed))).rejects.toMatchObject({ kind: "verification_failed" });
    expect(await prisma.refundRequest.findFirstOrThrow({ where: { orderId: disputed.order.id } })).toMatchObject({ status: "failed", lastErrorCode: "provider_identity_not_eligible" });
    expect(stripe.create).not.toHaveBeenCalled();
  });

  test("a refund still unresolved after six checks keeps its fence and alerts a person, and Stripe is still asked hourly until it answers (PAY-013)", async () => {
    const fixture = await paidOrder();
    stripe.create.mockRejectedValueOnce(new Error("socket hang up"));
    const lost = await requestOrderRefund(refundInput(fixture));
    await prisma.refundRequest.update({ where: { id: lost.refundRequestId }, data: { attempts: 6 } });
    for (const mock of Object.values(stripe)) mock.mockClear();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const answered = stripe.retrieve.getMockImplementation();
    stripe.retrieve.mockRejectedValue(new Error("socket hang up"));

    const now = new Date(Date.now() + 2 * 60 * 1000);
    await processOrderRefundBatch(25, now);
    expect(stripe.retrieve).toHaveBeenCalledTimes(1);
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: lost.refundRequestId } }))
      .toMatchObject({ status: "uncertain", lastErrorCode: "provider_unresolved", processingToken: null, nextAttemptAt: new Date(now.getTime() + 60 * 60_000) });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "processing" });
    expect(error.mock.calls.filter(([line]) => String(line).includes('"event":"order_refund_unresolved"'))).toHaveLength(1);

    // An hour later Stripe answers: the lost attempt's refund exists, so nothing is sent again.
    stripe.retrieve.mockImplementation(answered!);
    stripe.list.mockResolvedValue({ data: [providerRefund(fixture, lost.refundRequestId)] });
    await processOrderRefundBatch(25, new Date(now.getTime() + 60 * 60_000));
    expect(stripe.create).not.toHaveBeenCalled();
    expect(await prisma.refundRequest.findUniqueOrThrow({ where: { id: lost.refundRequestId } })).toMatchObject({ status: "succeeded" });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ refundStatus: "refunded" });
  });

  test("with staff MFA on, the route needs a fresh authenticator code before anything is recorded", async () => {
    const fixture = await paidOrder();
    // "enroll" lets the dashboard through without a grant, so the route's own code check answers.
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enroll");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    setMockSession({ userId: fixture.owner.user.id, email: fixture.owner.user.email, accountRole: "organisation" });
    const send = (body: Record<string, string>) => refundRoute(
      jsonRequest(`http://localhost:3000/api/orders/${fixture.order.id}/refunds`, { reason: "Buyer asked for a refund.", confirmation: orderReference(fixture.order.id), ...body }),
      routeContext({ orderId: fixture.order.id })
    );
    const missing = await send({});
    expect(missing.status).toBe(400);
    expect((await parseJsonResponse(missing)).error.details[0].path).toEqual(["mfaCode"]);
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    expect((await send({})).status).toBe(403);
    expect(await prisma.refundRequest.count()).toBe(0);
    expect(stripe.retrieve).not.toHaveBeenCalled();
  });

  test("with staff MFA enforced, a valid authenticator code lets the refund through; the same code can't be used again", async () => {
    const fixture = await paidOrder();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId));
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    setRateLimitTestBackend(createTestRateLimitBackend());
    onTestFinished(() => setRateLimitTestBackend(null));
    const { code } = await enrolStaffMfa(fixture.owner.user);
    const send = (mfaCode: string) => refundRoute(
      jsonRequest(`http://localhost:3000/api/orders/${fixture.order.id}/refunds`, { reason: "Buyer asked for a refund.", confirmation: orderReference(fixture.order.id), mfaCode }),
      routeContext({ orderId: fixture.order.id })
    );

    const refunded = await send(code());
    expect(refunded.status).toBe(200);
    expect(await parseJsonResponse(refunded)).toMatchObject({ status: "succeeded" });
    const replay = await send(code());
    expect(replay.status).toBe(400);
    expect((await parseJsonResponse(replay)).error.details[0].path).toEqual(["mfaCode"]);
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(await prisma.refundRequest.count({ where: { orderId: fixture.order.id } })).toBe(1);
  });

  test("the refund worker's modules load without the auth secret", async () => {
    // Workers run without AUTH_SECRET; the worker entry must not reach @/auth.
    const source = await import("node:fs").then((fs) => fs.readFileSync("lib/payments/order-refunds.ts", "utf8"));
    expect(source).not.toMatch(/@\/auth|security\/csrf|staff-mfa/);
  });

  test("compensation never starts on an order an ordinary refund has fenced", async () => {
    const fixture = await paidOrder();
    await prisma.order.update({ where: { id: fixture.order.id }, data: { status: "failed", failedAt: new Date(), fulfilledAt: null, requiresCompensationReview: true, compensationRefundModeSnapshot: "automatic_full", refundStatus: "processing" } });
    await prisma.ticket.deleteMany({ where: { orderId: fixture.order.id } });
    await prisma.compensationRefundJob.create({ data: { orderId: fixture.order.id, state: "auto_queued", amount: 3000 } });
    await processCompensationRefundBatch();
    expect(await prisma.compensationRefundJob.findUniqueOrThrow({ where: { orderId: fixture.order.id } })).toMatchObject({ state: "review_required", lastErrorCode: "local_state_not_eligible" });
    expect(stripe.create).not.toHaveBeenCalled();
  });
});
