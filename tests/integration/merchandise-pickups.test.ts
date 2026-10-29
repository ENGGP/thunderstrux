import { describe, expect, test } from "vitest";
import { POST as pickupRoute } from "@/app/api/orgs/[orgSlug]/merchandise/pickups/[orderId]/route";
import { POST as pickupsRoute } from "@/app/api/orgs/[orgSlug]/merchandise/pickups/route";
import { createCommerceCheckout } from "@/lib/commerce/checkout";
import { prisma } from "@/lib/db";
import { listPickups, pickupResult } from "@/lib/merchandise/pickups";
import { quoteVersion } from "@/lib/merchandise/sale";
import { orderReference } from "@/lib/payments/order-refunds";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount, createOrganisationStaff, unique } from "@/tests/helpers/test-data";

// A society with a published free option, and a member's fulfilled order of it.
async function society() {
  const account = await createOrganisationAccount();
  const { organisation } = account;
  await prisma.organisation.update({ where: { id: organisation.id }, data: { pickupPolicy: "EngSoc office, Tuesdays 12 to 2 pm." } });
  const now = new Date();
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Sticker pack", status: "published", publishedAt: now, firstPublishedAt: now } });
  const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: unique("STICK").toUpperCase(), priceAmount: 0, remaining: 50 } });
  const order = async () => {
    const buyer = await createMember();
    const items = [{ variantId: variant.id, quantity: 1, unitPrice: 0 }];
    const result = await createCommerceCheckout({
      family: "merchandise", organisationId: organisation.id, buyer: { userId: buyer.id },
      selection: { items: [{ variantId: variant.id, quantity: 1 }], quoteVersion: quoteVersion(items) }, expectedTotal: 0, idempotencyKey: unique("pickup-key-0000")
    });
    if (result.status !== "fulfilled") throw new Error("not fulfilled");
    return prisma.commerceOrder.findUniqueOrThrow({ where: { id: result.commerceOrderId } });
  };
  return { ...account, order };
}

async function step(slug: string, orderId: string, body: unknown) {
  const response = await pickupRoute(jsonRequest(`http://localhost:3000/api/orgs/${slug}/merchandise/pickups/${orderId}`, body), routeContext({ orgSlug: slug, orderId }));
  return { status: response.status, body: await parseJsonResponse(response) };
}
const emails = (orderId: string, step: string) => prisma.notificationOutbox.count({ where: { eventKey: `merchandise-${step}/${orderId}` } });

describe("merchandise pickups", () => {
  // UI-019: To prepare runs oldest first, a page either way.
  test("pickup stages page forward and back in the order orders came in", async () => {
    const { organisation, order } = await society();
    const created = [];
    for (let index = 0; index < 26; index += 1) created.push(await order());
    const first = await listPickups(organisation.id, { stage: "prepare" });
    expect(first.orders.map((row) => row.id)).toEqual(created.slice(0, 25).map((row) => row.id));
    expect(first.previousCursor).toBeNull();
    const second = await listPickups(organisation.id, { stage: "prepare", cursor: first.nextCursor! });
    expect(second.orders.map((row) => row.id)).toEqual([created[25].id]);
    const back = await listPickups(organisation.id, { stage: "prepare", cursor: second.previousCursor!, direction: "prev" });
    expect(back.orders.map((row) => row.id)).toEqual(first.orders.map((row) => row.id));
  }, 90_000);

  // UI-018: several marked ready at once, each on its own with one email per buyer.
  test("marking several ready at once emails each buyer once and names an order someone else moved first", async () => {
    const { organisation, user, order } = await society();
    const [first, second, third] = [await order(), await order(), await order()];
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect((await step(organisation.slug, third.id, { step: "ready", expectedVersion: third.version })).status).toBe(200);
    const batch = (orders: unknown) =>
      pickupsRoute(jsonRequest(`http://localhost:3000/api/orgs/${organisation.slug}/merchandise/pickups`, { orders }), routeContext({ orgSlug: organisation.slug }));

    expect((await batch([])).status).toBe(400);
    expect((await batch(Array.from({ length: 26 }, () => ({ orderId: first.id, expectedVersion: 1 })))).status).toBe(400);
    const response = await batch([first, second, third].map((row) => ({ orderId: row.id, expectedVersion: row.version })));
    expect(response.status).toBe(200);
    const { pickups } = await parseJsonResponse(response);
    expect(pickups.marked.map((row: { id: string }) => row.id).sort()).toEqual([first.id, second.id].sort());
    expect(pickups.skipped).toEqual([expect.objectContaining({ orderId: third.id, reference: orderReference(third.id), message: expect.stringContaining(" marked order ") })]);
    for (const row of [first, second, third]) expect(await emails(row.id, "ready")).toBe(1);
    expect(await prisma.commerceOrder.count({ where: { id: { in: [first.id, second.id, third.id] }, pickupStatus: "ready" } })).toBe(3);
  });

  test("staff mark an order ready, then collected, once each: the buyer is emailed once per step and who did it is recorded", async () => {
    const { organisation, user, order } = await society();
    const first = await order();
    const second = await order();
    expect(first.pickupStatus).toBe("pending");
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const prepare = await listPickups(organisation.id, { stage: "prepare" });
    expect(prepare.orders.map((row) => row.id)).toEqual([first.id, second.id]);
    expect(prepare.counts).toEqual({ prepare: 2, ready: 0, collected: 0, review: 0 });
    expect((await listPickups(organisation.id, { stage: "prepare", query: orderReference(second.id) })).orders.map((row) => row.id)).toEqual([second.id]);

    const ready = await step(organisation.slug, first.id, { step: "ready", expectedVersion: first.version });
    expect(ready.status).toBe(200);
    expect(ready.body.pickup).toMatchObject({ reference: orderReference(first.id), pickupStatus: "ready", version: first.version + 1 });
    // The same click from a page opened before it names who got there first and changes nothing.
    const again = await step(organisation.slug, first.id, { step: "ready", expectedVersion: first.version });
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain(`marked order ${orderReference(first.id)} ready to collect`);
    expect(await emails(first.id, "ready")).toBe(1);
    expect((await listPickups(organisation.id, { stage: "ready" })).orders[0]).toMatchObject({ id: first.id, step: { by: expect.any(String) } });

    // Collected needs ready first, and the current version.
    expect((await step(organisation.slug, second.id, { step: "collected", expectedVersion: second.version })).status).toBe(409);
    expect((await step(organisation.slug, first.id, { step: "collected", expectedVersion: first.version })).status).toBe(409);
    expect((await step(organisation.slug, first.id, { step: "collected", expectedVersion: first.version + 1 })).status).toBe(200);
    expect(await emails(first.id, "collected")).toBe(1);
    expect(await pickupResult(organisation.id, first.id)).toMatchObject({ collected: true, reference: orderReference(first.id) });

    const history = await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: first.id, type: { in: ["pickup_ready", "pickup_collected"] } }, orderBy: { sequence: "asc" } });
    expect(history.map((event) => [event.type, event.actorUserId, event.source])).toEqual([["pickup_ready", user.id, "staff_action"], ["pickup_collected", user.id, "staff_action"]]);
    expect(await prisma.auditLog.count({ where: { targetId: first.id, action: { in: ["merchandise_order.ready", "merchandise_order.collected"] } } })).toBe(2);
    expect((await listPickups(organisation.id, { stage: "collected" })).counts).toEqual({ prepare: 1, ready: 0, collected: 1, review: 0 });
    expect((await step(organisation.slug, first.id, { step: "ready", expectedVersion: first.version + 2 })).status).toBe(409);
  });

  test("an order under payment review can't be handed over, and other societies, members and staff without the permission get nothing", async () => {
    const { organisation, user, order } = await society();
    const held = await order();
    await prisma.commerceOrder.update({ where: { id: held.id }, data: { status: "failed", requiresCompensationReview: true, reviewReason: "sold_out", fulfilledAt: null, pickupStatus: null } });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const refused = await step(organisation.slug, held.id, { step: "ready", expectedVersion: held.version });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toContain("under review");
    expect((await listPickups(organisation.id, { stage: "review" })).orders.map((row) => row.id)).toEqual([held.id]);
    expect((await listPickups(organisation.id, { stage: "prepare" })).orders).toEqual([]);

    const open = await order();
    // Another society's owner, on their own slug, finds no such order.
    const other = await createOrganisationAccount();
    setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
    expect((await step(other.organisation.slug, open.id, { step: "ready", expectedVersion: open.version })).status).toBe(404);
    expect((await step(organisation.slug, open.id, { step: "ready", expectedVersion: open.version })).status).toBe(404);
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    expect((await step(organisation.slug, open.id, { step: "ready", expectedVersion: open.version })).status).toBe(404);
    const manager = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: manager.id, role: "event_manager" });
    setMockSession({ userId: manager.id, email: manager.email, accountRole: "member" });
    expect((await step(organisation.slug, open.id, { step: "ready", expectedVersion: open.version })).status).toBe(403);
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect((await step(organisation.slug, open.id, { step: "shipped", expectedVersion: open.version })).status).toBe(400);
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: open.id } })).pickupStatus).toBe("pending");
  });
});
