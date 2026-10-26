import { describe, expect, test, vi } from "vitest";
import { GET as commerceOrderRoute } from "@/app/api/commerce/orders/[orderId]/route";
import { prisma } from "@/lib/db";
import {
  CommerceOrderError,
  appendCommerceLifecycleEvent,
  createCommerceOrder,
  getOwnCommerceOrders,
  lockCommerceOrder,
  type CreateCommerceOrderInput
} from "@/lib/commerce/orders";
import { encodeTimestampCursor } from "@/lib/pagination/cursor";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createEvent, createMember, createOrder, createOrganisationAccount } from "@/tests/helpers/test-data";

const create = (input: CreateCommerceOrderInput) => prisma.$transaction((tx) => createCommerceOrder(tx, input));

async function shopFixture() {
  const society = await createOrganisationAccount({ stripeReady: true });
  await prisma.organisation.update({ where: { id: society.organisation.id }, data: { supportEmail: "shop@society.example" } });
  const buyer = await createMember();
  const merch = (overrides: Partial<CreateCommerceOrderInput> = {}) => create({
    organisationId: society.organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, buyerName: "Test Member",
    paymentKind: "stripe", feeAmount: 250, source: "checkout",
    lines: [{ quantity: 2, unitAmount: 1500, name: "Hoodie", variant: "M · Navy" }, { quantity: 1, unitAmount: 800, name: "Tote" }],
    ...overrides
  });
  return { society, buyer, merch };
}

const read = async (orderId: string) => {
  const response = await commerceOrderRoute(new Request(`http://localhost:3000/api/commerce/orders/${orderId}`), routeContext({ orderId }));
  return { status: response.status, body: response.status === 200 ? await parseJsonResponse(response) : null };
};

describe("commerce orders", () => {
  test("an order is created with checked totals, numbered lines, seller snapshots and its first history entry; the facts never change", async () => {
    const { society, merch } = await shopFixture();
    const order = await merch();
    expect(order).toMatchObject({ kind: "merchandise", status: "pending", totalAmount: 3800, feeAmount: 250, currency: "aud", sellerName: society.organisation.name, sellerSupportEmail: "shop@society.example", sellerStripeAccountId: society.organisation.stripeAccountId });
    const lines = await prisma.commerceOrderLine.findMany({ where: { orderId: order.id }, orderBy: { lineNumber: "asc" } });
    expect(lines.map((line) => [line.lineNumber, line.lineAmount, line.nameSnapshot])).toEqual([[1, 3000, "Hoodie"], [2, 800, "Tote"]]);
    expect(await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: order.id }, select: { sequence: true, type: true } })).toEqual([{ sequence: 1, type: "order_created" }]);

    // The society renames itself; the purchase still names the seller as it was.
    await prisma.organisation.update({ where: { id: society.organisation.id }, data: { name: "Renamed society" } });
    expect((await prisma.commerceOrder.findUniqueOrThrow({ where: { id: order.id } })).sellerName).toBe(society.organisation.name);
    await expect(prisma.commerceOrderLine.update({ where: { id: lines[0].id }, data: { unitAmount: 1 } })).rejects.toThrow();
    await expect(prisma.commerceOrder.update({ where: { id: order.id }, data: { totalAmount: 1 } })).rejects.toThrow();
    await expect(prisma.commerceLifecycleEvent.updateMany({ where: { commerceOrderId: order.id }, data: { reason: "rewritten" } })).rejects.toThrow();
    // Status moves; facts don't.
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
  });

  test("lines, quantities, buyers and arithmetic are checked before anything is written", async () => {
    const { society, buyer, merch } = await shopFixture();
    const line = { quantity: 1, unitAmount: 500, name: "Sticker" };
    const term = { termStartsAt: new Date("2027-02-01"), termEndsAt: new Date("2027-07-01") };
    const refusals: Array<Partial<CreateCommerceOrderInput>> = [
      { lines: [] },
      { lines: Array.from({ length: 11 }, () => line) },
      { lines: [{ ...line, quantity: 11 }] },
      { lines: [{ ...line, unitAmount: 1.5 }] },
      { lines: [{ ...line, quantity: 2, unitAmount: 2_000_000_000 }] },
      { feeAmount: 999_999 },
      { paymentKind: "free" },
      { kind: "membership", lines: [{ ...line, ...term, quantity: 2 }] },
      { kind: "membership", buyer: { guestIdentityId: (await prisma.guestIdentity.create({ data: { email: "guest@example.com" } })).id }, lines: [{ ...line, ...term }] }
    ];
    for (const overrides of refusals) await expect(merch(overrides), JSON.stringify(overrides).slice(0, 80)).rejects.toBeInstanceOf(CommerceOrderError);
    expect(await prisma.commerceOrder.count()).toBe(0);
    // The largest total the database can hold is accepted.
    await expect(merch({ feeAmount: 0, lines: [{ ...line, unitAmount: 2_147_483_647 }] })).resolves.toMatchObject({ totalAmount: 2_147_483_647 });
    // A free membership for one term, bought by the member.
    await expect(create({ organisationId: society.organisation.id, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "free", source: "checkout", lines: [{ quantity: 1, unitAmount: 0, name: "Semester 1", ...term }] }))
      .resolves.toMatchObject({ kind: "membership", totalAmount: 0, sellerStripeAccountId: null });
  });

  test("the database refuses a line of another family or another society, and an attempt that names both kinds of order", async () => {
    const { society, merch } = await shopFixture();
    const order = await merch();
    const other = await createOrganisationAccount();
    const base = { orderId: order.id, organisationId: order.organisationId, kind: order.kind, lineNumber: 3, quantity: 1, unitAmount: 100, lineAmount: 100, currency: "aud", nameSnapshot: "Cap" };
    await expect(prisma.commerceOrderLine.create({ data: { ...base, kind: "membership", termStartsAt: new Date("2027-01-01"), termEndsAt: new Date("2027-06-01") } })).rejects.toThrow();
    await expect(prisma.commerceOrderLine.create({ data: { ...base, organisationId: other.organisation.id } })).rejects.toThrow();
    await expect(prisma.commerceOrderLine.create({ data: { ...base, lineAmount: 999 } })).rejects.toThrow();

    const event = await createEvent({ organisationId: society.organisation.id, status: "published" });
    const ticketOrder = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id });
    const attempt = { actorKind: "user" as const, actorId: order.userId as string, operationType: "commerce_checkout", requestHash: "synthetic", state: "created" as const };
    await expect(prisma.checkoutAttempt.create({ data: { ...attempt, family: "ticket", clientIdempotencyKey: "a1", providerOperationKey: "p1", commerceOrderId: order.id } })).rejects.toThrow();
    await expect(prisma.checkoutAttempt.create({ data: { ...attempt, family: "merchandise", clientIdempotencyKey: "a2", providerOperationKey: "p2", orderId: ticketOrder.id } })).rejects.toThrow();
    await expect(prisma.checkoutAttempt.create({ data: { ...attempt, family: "merchandise", clientIdempotencyKey: "a3", providerOperationKey: "p3", commerceOrderId: order.id } })).resolves.toMatchObject({ commerceOrderId: order.id });
  });

  test("history entries take one sequence number each, even when written at once", async () => {
    const { merch } = await shopFixture();
    const order = await merch();
    await Promise.all(Array.from({ length: 5 }, () => prisma.$transaction(async (tx) => {
      await lockCommerceOrder(tx, order.id);
      await appendCommerceLifecycleEvent(tx, { commerceOrderId: order.id, type: "order_expired", source: "stale_cleanup" });
    })));
    expect((await prisma.commerceLifecycleEvent.findMany({ where: { commerceOrderId: order.id }, orderBy: { sequence: "asc" } })).map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("the buyer reads their own order, finance staff read their society's, and every other id is the same 404", async () => {
    const { society, buyer, merch } = await shopFixture();
    const order = await merch();
    clearMockSession();
    expect((await read(order.id)).status).toBe(401);

    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    const own = await read(order.id);
    expect(own.body).toMatchObject({ view: "buyer", order: { family: "merchandise", totalAmount: 3800, lines: [{ lineNumber: 1 }, { lineNumber: 2 }], lifecycleEvents: [{ type: "order_created" }] } });
    expect(own.body.order).not.toHaveProperty("buyerEmailSnapshot");
    expect(own.body.order).not.toHaveProperty("feeAmount");

    const stranger = await createMember();
    setMockSession({ userId: stranger.id, email: stranger.email, accountRole: "member" });
    expect((await read(order.id)).status).toBe(404);

    setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
    expect((await read(order.id)).body).toMatchObject({ view: "finance", order: { buyerEmailSnapshot: buyer.email, feeAmount: 250, guest: false } });
    // A ticket order id at the commerce route, and another society's staff, both see nothing.
    const event = await createEvent({ organisationId: society.organisation.id, status: "published" });
    const ticketOrder = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date() });
    expect((await read(ticketOrder.id)).status).toBe(404);
    const other = await createOrganisationAccount();
    setMockSession({ userId: other.user.id, email: other.user.email, accountRole: "organisation" });
    expect((await read(order.id)).status).toBe(404);
  });

  test("staff without a current authenticator grant get 403, not a server error (DEF-048)", async () => {
    vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    const { society, merch } = await shopFixture();
    const order = await merch();
    setMockSession({ userId: society.user.id, email: society.user.email, accountRole: "organisation" });
    expect((await read(order.id)).status).toBe(403);
  });

  test("the buyer's list pages newest first and stays stable when orders share a timestamp", async () => {
    const { buyer, merch } = await shopFixture();
    const created = [await merch(), await merch(), await merch()];
    const same = new Date("2026-10-01T10:00:00.000Z");
    // createdAt is a fixed fact once written; set the tie through the database directly.
    await prisma.$executeRawUnsafe(`ALTER TABLE "CommerceOrder" DISABLE TRIGGER "CommerceOrder_preserve_snapshot"`);
    try {
      await prisma.commerceOrder.updateMany({ where: { id: { in: created.map((order) => order.id) } }, data: { createdAt: same } });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CommerceOrder" ENABLE TRIGGER "CommerceOrder_preserve_snapshot"`);
    }
    const expected = [...created].sort((a, b) => (a.id < b.id ? 1 : -1)).map((order) => order.id);
    const first = await getOwnCommerceOrders(buyer.id, { limit: 2, direction: "next" });
    expect(first.items.map((order) => order.id)).toEqual(expected.slice(0, 2));
    const second = await getOwnCommerceOrders(buyer.id, { limit: 2, direction: "next", cursor: first.pageInfo.nextCursor! });
    expect(second.items.map((order) => order.id)).toEqual(expected.slice(2));
    const back = await getOwnCommerceOrders(buyer.id, { limit: 2, direction: "prev", cursor: encodeTimestampCursor("createdAt", { createdAt: same, id: expected[2] }) });
    expect(back.items.map((order) => order.id)).toEqual(expected.slice(0, 2));
  });
});
