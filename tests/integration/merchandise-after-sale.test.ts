import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as cancelRoute } from "@/app/api/orgs/[orgSlug]/merchandise/orders/[orderId]/cancel/route";
import { POST as refundRoute } from "@/app/api/orgs/[orgSlug]/merchandise/orders/[orderId]/refund/route";
import { POST as returnRoute } from "@/app/api/orgs/[orgSlug]/merchandise/orders/[orderId]/returns/route";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { staffMerchandiseOrder } from "@/lib/merchandise/after-sale";
import { listPickups } from "@/lib/merchandise/pickups";
import { orderReference } from "@/lib/payments/order-refunds";
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

const reason = "Wrong size, and the right size is sold out.";

// A society selling one option, and a fulfilled order of it as the webhook or free checkout leaves it.
async function society() {
  const account = await createOrganisationAccount({ stripeReady: true });
  const { organisation } = account;
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Lanyard", status: "published", publishedAt: now, firstPublishedAt: now } });
  const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: unique("LAN").toUpperCase(), priceAmount: 1500, remaining: 3 } });
  const order = async ({ free = false, quantity = 2, pickupStatus = "pending" as "pending" | "ready" | "collected" } = {}) => {
    const buyer = await createMember();
    const unitAmount = free ? 0 : 1500;
    const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: free ? "free" : "stripe", feeAmount: free ? 0 : 150 * quantity,
      lines: [{ quantity, unitAmount, name: "Lanyard", merchandiseVariantId: variant.id }], source: "checkout"
    }));
    return prisma.commerceOrder.update({
      where: { id: created.id },
      data: { status: "paid", paidAt: now, fulfilledAt: now, pickupStatus, ...(free ? {} : { stripeSessionId: unique("cs") }) },
      include: { lines: true }
    });
  };
  setMockSession({ userId: account.user.id, email: account.user.email, accountRole: "organisation" });
  return { ...account, variant, order };
}

async function call(route: typeof refundRoute, slug: string, orderId: string, body: unknown) {
  const response = await route(jsonRequest(`http://localhost:3000/api/orgs/${slug}/merchandise/orders/${orderId}`, body), routeContext({ orgSlug: slug, orderId }));
  return { status: response.status, body: await parseJsonResponse(response) };
}
const stock = async (variantId: string) => (await prisma.merchandiseVariant.findUniqueOrThrow({ where: { id: variantId } })).remaining;

// Stripe agrees the payment happened, has no earlier refund, and accepts this one.
function stripeAccepts(order: { id: string; totalAmount: number }, destination: string | null) {
  const intentId = unique("pi");
  stripe.retrieve.mockResolvedValue({
    payment_status: "paid", amount_total: order.totalAmount, currency: "aud", metadata: { family: "merchandise", commerceOrderId: order.id },
    payment_intent: { id: intentId, amount_received: order.totalAmount, transfer_data: { destination }, latest_charge: { disputed: false } }
  });
  stripe.list.mockResolvedValue({ data: [] });
  stripe.create.mockImplementation(async (params: { metadata: Record<string, string> }) => ({ id: unique("re"), status: "succeeded", amount: order.totalAmount, currency: "aud", payment_intent: intentId, metadata: params.metadata }));
}

describe("merchandise after the sale", () => {
  test("a refund cancels a pickup not yet collected, keeps a collected one in history, and never restocks", async () => {
    const { organisation, variant, order } = await society();
    const waiting = await order();
    const collected = await order({ pickupStatus: "collected" });

    expect((await call(refundRoute, organisation.slug, waiting.id, { reason, confirmation: "WRONG1" })).status).toBe(400);
    stripeAccepts(waiting, organisation.stripeAccountId);
    const refunded = await call(refundRoute, organisation.slug, waiting.id, { reason, confirmation: orderReference(waiting.id) });
    expect(refunded.status).toBe(200);
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: waiting.id } })).toMatchObject({ refundStatus: "refunded", status: "paid", pickupStatus: "pending" });
    const again = await call(refundRoute, organisation.slug, waiting.id, { reason, confirmation: orderReference(waiting.id) });
    expect(again.status).toBe(409);
    // API-002: the refusal names the order, not a membership grant.
    expect(again.body.error.details).toEqual([expect.objectContaining({ path: ["orderId"] })]);

    stripeAccepts(collected, organisation.stripeAccountId);
    expect((await call(refundRoute, organisation.slug, collected.id, { reason, confirmation: orderReference(collected.id) })).status).toBe(200);

    // Off the waiting stages; the collected one stays in Collected history.
    expect((await listPickups(organisation.id, { stage: "prepare" })).orders).toEqual([]);
    expect((await listPickups(organisation.id, { stage: "collected" })).orders.map((row) => row.id)).toEqual([collected.id]);
    expect(await stock(variant.id)).toBe(3);
    expect((await staffMerchandiseOrder(organisation.id, waiting.id))?.refundRequests[0]).toMatchObject({ status: "succeeded", amount: 3000, reason });
    expect(await prisma.notificationOutbox.count({ where: { eventKey: { startsWith: "refund/" }, organisationId: organisation.id } })).toBe(2);
  });

  test("a free order is cancelled once, never refunded, and a collected or paid one can't be cancelled", async () => {
    const { organisation, user, variant, order } = await society();
    const free = await order({ free: true, quantity: 1 });
    const done = await order({ free: true, quantity: 1, pickupStatus: "collected" });
    const paid = await order();

    const cancelled = await call(cancelRoute, organisation.slug, free.id, { reason: "Ordered twice by mistake." });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ status: "cancelled" });
    expect((await call(cancelRoute, organisation.slug, free.id, { reason: "Ordered twice by mistake." })).body).toMatchObject({ status: "already_cancelled" });
    expect(await prisma.commerceOrder.findUniqueOrThrow({ where: { id: free.id } })).toMatchObject({ status: "paid", cancellationReason: "Ordered twice by mistake.", refundStatus: null });
    expect(await prisma.refundRequest.count({ where: { commerceOrderId: free.id } })).toBe(0);
    expect(await prisma.notificationOutbox.count({ where: { eventKey: `merchandise-cancelled/${free.id}` } })).toBe(1);
    expect(await prisma.commerceLifecycleEvent.count({ where: { commerceOrderId: free.id, type: "free_cancelled" } })).toBe(1);
    expect(await prisma.auditLog.findMany({ where: { action: "merchandise_order.free_cancelled", targetId: free.id } }))
      .toEqual([expect.objectContaining({ organisationId: organisation.id, actorUserId: user.id, metadata: { reason: "Ordered twice by mistake." } })]);
    expect((await listPickups(organisation.id, { stage: "prepare" })).orders.map((row) => row.id)).toEqual([paid.id]);
    expect(await stock(variant.id)).toBe(3);

    expect((await call(cancelRoute, organisation.slug, done.id, { reason: "Changed their mind." })).status).toBe(409);
    expect((await call(cancelRoute, organisation.slug, paid.id, { reason: "Changed their mind." })).status).toBe(409);
    expect((await call(cancelRoute, organisation.slug, free.id, { reason: "short" })).status).toBe(400);
  });

  test("a return restocks once when asked, never more than was bought, and other societies and staff without the permission get nothing", async () => {
    const { organisation, user, variant, order } = await society();
    const bought = await order({ quantity: 2, pickupStatus: "collected" });
    const lineId = bought.lines[0].id;
    const body = (overrides: Record<string, unknown> = {}) => ({ lineId, quantity: 1, restock: true, reason: "Clip broken.", operationKey: unique("return-key-0000"), ...overrides });

    const first = body();
    expect((await call(returnRoute, organisation.slug, bought.id, first)).status).toBe(201);
    // The same request again records nothing new.
    expect((await call(returnRoute, organisation.slug, bought.id, first)).status).toBe(201);
    expect(await stock(variant.id)).toBe(4);
    expect((await call(returnRoute, organisation.slug, bought.id, body({ quantity: 2 }))).status).toBe(409);
    expect((await call(returnRoute, organisation.slug, bought.id, body({ restock: false }))).status).toBe(201);
    expect(await stock(variant.id)).toBe(4);
    expect((await call(returnRoute, organisation.slug, bought.id, body())).body.error.message).toContain("already been returned");
    const view = await staffMerchandiseOrder(organisation.id, bought.id);
    expect(view?.lines[0]).toMatchObject({ quantity: 2, returned: 2 });
    expect(view?.merchandiseReturns.map((row) => row.restocked)).toEqual([true, false]);
    expect(await prisma.commerceLifecycleEvent.count({ where: { commerceOrderId: bought.id, type: "return_recorded" } })).toBe(2);
    expect((await prisma.auditLog.findMany({ where: { action: "merchandise_order.return_recorded", targetId: bought.id }, orderBy: { createdAt: "asc" } })).map((row) => [row.actorUserId, row.metadata]))
      .toEqual([[user.id, expect.objectContaining({ quantity: 1, restocked: true })], [user.id, expect.objectContaining({ quantity: 1, restocked: false })]]);

    const other = await createOrganisationAccount();
    setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
    expect((await call(returnRoute, other.organisation.slug, bought.id, body())).status).toBe(404);
    expect((await call(cancelRoute, other.organisation.slug, bought.id, { reason: "Not theirs to cancel." })).status).toBe(404);
    const manager = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: manager.id, role: "event_manager" });
    setMockSession({ userId: manager.id, email: manager.email, accountRole: "member" });
    expect((await call(returnRoute, organisation.slug, bought.id, body())).status).toBe(403);
    expect((await call(refundRoute, organisation.slug, bought.id, { reason, confirmation: orderReference(bought.id) })).status).toBe(403);
    expect(await prisma.merchandiseReturn.count({ where: { commerceOrderId: bought.id } })).toBe(2);
  });
});
