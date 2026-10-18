import type Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as refundRoute } from "@/app/api/orgs/[orgSlug]/memberships/members/[grantId]/refund/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { grantState } from "@/lib/memberships/grants";
import { orderReference, processOrderRefundBatch, reconcileOrderRefundEvent, requestCommerceRefund } from "@/lib/payments/order-refunds";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ retrieve: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { retrieve: stripe.retrieve } }, refunds: { list: stripe.list, create: stripe.create } })
}));

beforeEach(() => { vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); });
afterEach(() => { stripe.retrieve.mockReset(); stripe.list.mockReset(); stripe.create.mockReset(); });

const day = 86_400_000;
const reason = "Moving overseas next month.";

// A paid, fulfilled membership as the webhook leaves it, and a Stripe that agrees about it.
async function paidMembership() {
  const society = await createOrganisationAccount({ stripeReady: true });
  const member = await createMember();
  const term = { startsAt: new Date(Date.now() - day), endsAt: new Date(Date.now() + 100 * day) };
  const plan = await prisma.membershipProduct.create({ data: { organisationId: society.organisation.id, name: "Semester 2", priceAmount: 1500, ...term, entitlements: ["member_prices"], status: "published", publishedAt: new Date() } });
  const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: society.organisation.id, kind: "membership", buyer: { userId: member.id }, buyerEmail: member.email, paymentKind: "stripe", feeAmount: 150, source: "checkout",
    lines: [{ quantity: 1, unitAmount: 1500, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
  }));
  const order = await prisma.commerceOrder.update({ where: { id: created.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date(), stripeSessionId: unique("cs") } });
  const line = await prisma.commerceOrderLine.findFirstOrThrow({ where: { orderId: order.id } });
  const grant = await prisma.membershipGrant.create({ data: { userId: member.id, organisationId: society.organisation.id, membershipProductId: plan.id, commerceOrderLineId: line.id, ...term, entitlements: plan.entitlements, entitlementVersion: 1 } });
  const intentId = unique("pi");
  stripe.retrieve.mockResolvedValue({
    payment_status: "paid", amount_total: 1500, currency: "aud", metadata: { family: "membership", commerceOrderId: order.id },
    payment_intent: { id: intentId, amount_received: 1500, transfer_data: { destination: society.organisation.stripeAccountId }, latest_charge: { disputed: false } }
  });
  stripe.list.mockResolvedValue({ data: [] });
  setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
  return { society, member, order, grant, intentId };
}
type Fixture = Awaited<ReturnType<typeof paidMembership>>;

const providerRefund = (fixture: Fixture, requestId: string, status = "succeeded") =>
  ({ id: unique("re"), status, amount: 1500, currency: "aud", payment_intent: fixture.intentId, metadata: { refundRequestId: requestId, commerceOrderId: fixture.order.id } }) as unknown as Stripe.Refund;

async function send(fixture: Fixture, body: Record<string, string> = { reason, confirmation: orderReference(fixture.order.id) }) {
  const slug = fixture.society.organisation.slug;
  const response = await refundRoute(jsonRequest(`http://localhost:3000/api/orgs/${slug}/memberships/members/${fixture.grant.id}/refund`, body), routeContext({ orgSlug: slug, grantId: fixture.grant.id }));
  return { status: response.status, body: await parseJsonResponse(response) };
}

const input = (fixture: Fixture) => ({ organisationId: fixture.society.organisation.id, commerceOrderId: fixture.order.id, actor: { id: fixture.society.user.id }, reason, confirmation: orderReference(fixture.order.id) });

describe("membership refunds", () => {
  test("a confirmed refund ends the membership, keeps the order paid, records history and emails the member", async () => {
    const fixture = await paidMembership();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId));
    expect(await send(fixture)).toMatchObject({ status: 200, body: { status: "succeeded" } });

    const request = await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } });
    expect(request).toMatchObject({ orderId: null, amount: 1500, status: "succeeded", destinationAccountId: fixture.society.organisation.stripeAccountId });
    const [params, options] = stripe.create.mock.calls[0];
    expect(params).toMatchObject({ payment_intent: fixture.intentId, amount: 1500, reverse_transfer: true, refund_application_fee: true, metadata: { refundRequestId: request.id, commerceOrderId: fixture.order.id } });
    expect(params.metadata).not.toHaveProperty("orderId");
    expect(options).toEqual({ idempotencyKey: request.operationKey });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).toMatchObject({ status: "paid", refundStatus: "refunded", stripePaymentIntentId: fixture.intentId });
    const grant = await prisma.membershipGrant.findUniqueOrThrow({ where: { id: fixture.grant.id } });
    expect(grant).toMatchObject({ revokedByUserId: fixture.society.user.id, revocationReason: `Refunded: ${reason}` });
    expect(grantState(grant)).toBe("revoked");
    expect((await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: fixture.order.id }, orderBy: { sequence: "asc" } })).map((event) => event.type)).toEqual(["order_created", "refund_requested", "refunded"]);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `refund/${request.id}`, recipient: fixture.member.email } })).toBe(1);
    expect((await send(fixture)).body.error.details[0]).toMatchObject({ reason: "already_refunded" });
  });

  test("a pending refund keeps the membership until Stripe's signed webhook confirms it; a failed one lifts the fence", async () => {
    const fixture = await paidMembership();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId, "pending"));
    expect((await send(fixture)).status).toBe(202);
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: fixture.grant.id } }))).toBe("active");
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).refundStatus).toBe("processing");
    expect((await send(fixture)).body.error.details[0]).toMatchObject({ reason: "in_progress" });

    const request = await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } });
    const event = (refund: Stripe.Refund, created = Math.floor(Date.now() / 1000)) => ({ id: unique("evt"), type: "refund.updated", created, data: { object: refund } }) as unknown as Stripe.Event;
    // A refund naming the right request but a ticket order instead is not this purchase.
    await reconcileOrderRefundEvent(event({ ...providerRefund(fixture, request.id), metadata: { refundRequestId: request.id, orderId: fixture.order.id } } as Stripe.Refund));
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: fixture.grant.id } }))).toBe("active");
    await reconcileOrderRefundEvent(event(providerRefund(fixture, request.id)));
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: fixture.grant.id } }))).toBe("revoked");
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).refundStatus).toBe("refunded");

    const failing = await paidMembership();
    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(failing, params.metadata.refundRequestId, "failed"));
    expect((await send(failing)).body).toMatchObject({ status: "failed" });
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: failing.order.id } })).refundStatus).toBeNull();
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: failing.grant.id } }))).toBe("active");
  });

  test("a lost Stripe answer is looked up by the worker before the same key is sent again", async () => {
    const fixture = await paidMembership();
    stripe.create.mockRejectedValueOnce(new Error("socket hang up"));
    expect((await send(fixture))).toMatchObject({ status: 202, body: { status: "uncertain" } });
    const request = await prisma.refundRequest.findFirstOrThrow({ where: { commerceOrderId: fixture.order.id } });
    // Stripe did make it: the worker finds it and does not create another.
    stripe.list.mockResolvedValue({ data: [providerRefund(fixture, request.id)] });
    await processOrderRefundBatch(25, new Date(Date.now() + 5 * 60_000));
    expect(stripe.create).toHaveBeenCalledTimes(1);
    expect(grantState(await prisma.membershipGrant.findUniqueOrThrow({ where: { id: fixture.grant.id } }))).toBe("revoked");
  });

  test("the wrong reference, free, reviewed and outside-refunded orders, two refunds at once and missing permission are refused safely", async () => {
    const fixture = await paidMembership();
    expect(await send(fixture, { reason, confirmation: "WRONG1" })).toMatchObject({ status: 400, body: { error: { details: [{ reason: "confirmation_mismatch" }] } } });
    expect((await send(fixture, { reason })).status).toBe(400);
    await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { requiresCompensationReview: true, reviewReason: "synthetic" } });
    await expect(requestCommerceRefund(input(fixture))).rejects.toMatchObject({ kind: "not_refundable" });
    await prisma.commerceOrder.update({ where: { id: fixture.order.id }, data: { requiresCompensationReview: false, reviewReason: null } });
    expect(stripe.retrieve).not.toHaveBeenCalled();

    // A refund already made in Stripe's dashboard: nothing more is sent, the fence lifts.
    stripe.list.mockResolvedValueOnce({ data: [{ id: unique("re"), status: "succeeded", amount: 1500, metadata: {} }] });
    await expect(requestCommerceRefund(input(fixture))).rejects.toMatchObject({ kind: "verification_failed" });
    expect(stripe.create).not.toHaveBeenCalled();
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: fixture.order.id } })).refundStatus).toBeNull();

    stripe.create.mockImplementation(async (params: { metadata: { refundRequestId: string } }) => providerRefund(fixture, params.metadata.refundRequestId, "pending"));
    const results = await Promise.allSettled([requestCommerceRefund(input(fixture)), requestCommerceRefund(input(fixture))]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(stripe.create).toHaveBeenCalledTimes(1);

    // A free membership has nothing to refund.
    const owner = await createOrganisationAccount({ stripeReady: true });
    const buyer = await createMember();
    const free = await prisma.$transaction((tx) => createCommerceOrder(tx, { organisationId: owner.organisation.id, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "free", source: "checkout", lines: [{ quantity: 1, unitAmount: 0, name: "Free", termStartsAt: new Date(), termEndsAt: new Date(Date.now() + day) }] }));
    await expect(requestCommerceRefund({ organisationId: owner.organisation.id, commerceOrderId: free.id, actor: { id: owner.user.id }, reason, confirmation: orderReference(free.id) })).rejects.toMatchObject({ kind: "not_refundable" });
    // Another society's order is not found.
    await expect(requestCommerceRefund({ ...input(fixture), organisationId: owner.organisation.id })).rejects.toMatchObject({ kind: "not_found" });

    // Staff without orders:refund can't reach the route.
    const other = await paidMembership();
    const manager = await createMember();
    await createOrganisationStaff({ organisationId: other.society.organisation.id, userId: manager.id, role: "event_manager" });
    setMockSession({ userId: manager.id, email: manager.email, accountRole: "member" });
    expect((await send(other)).status).toBe(403);
    expect(await prisma.refundRequest.count({ where: { commerceOrderId: other.order.id } })).toBe(0);
  });

  test("the database keeps a refund request to exactly one purchase, and a fence only on Stripe payments", async () => {
    const fixture = await paidMembership();
    const base = { organisationId: fixture.society.organisation.id, amount: 1500, reason, operationKey: unique("op") };
    await expect(prisma.refundRequest.create({ data: base })).rejects.toThrow();
    const owner = await createOrganisationAccount({ stripeReady: true });
    const buyer = await createMember();
    const free = await prisma.$transaction((tx) => createCommerceOrder(tx, { organisationId: owner.organisation.id, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "free", source: "checkout", lines: [{ quantity: 1, unitAmount: 0, name: "Free", termStartsAt: new Date(), termEndsAt: new Date(Date.now() + day) }] }));
    await expect(prisma.commerceOrder.update({ where: { id: free.id }, data: { refundStatus: "processing" } })).rejects.toThrow();
  });
});
