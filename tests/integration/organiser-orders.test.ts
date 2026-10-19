import { describe, expect, test, vi } from "vitest";
import MerchandiseOrderPage from "@/app/(dashboard)/dashboard/merchandise/orders/[orderId]/page";
import OrdersPage from "@/app/(dashboard)/dashboard/orders/page";
import { createCommerceOrder, listOrganisationCommerceOrders } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { listFailedBusinessNotifications, NotificationCursorError } from "@/lib/email/notification-outbox";
import { orderReference } from "@/lib/payments/order-refunds";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createMember, createOrganisationAccount, createOrganisationStaff, unique } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/orders",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

const first = { limit: 25, direction: "next" as const };

// A society's merchandise orders in every state, one membership order, and another society's order.
async function society() {
  const { organisation, user } = await createOrganisationAccount();
  const buyer = await createMember();
  const now = new Date();
  const hoodie = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Hoodie", status: "published", publishedAt: now, firstPublishedAt: now } });
  const pin = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Pin", status: "published", publishedAt: now, firstPublishedAt: now } });
  const variant = (productId: string, organisationId = organisation.id) =>
    prisma.merchandiseVariant.create({ data: { productId, organisationId, sku: unique("SKU").toUpperCase(), priceAmount: 1000, remaining: 10 } });
  const hoodieOption = await variant(hoodie.id);
  const pinOption = await variant(pin.id);
  const order = async (variantId: string, email: string, data: Record<string, unknown>, free = false, organisationId = organisation.id) => {
    const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: email, paymentKind: free ? "free" : "stripe", feeAmount: 0, source: "checkout",
      lines: [{ quantity: 1, unitAmount: free ? 0 : 1000, name: "Item", merchandiseVariantId: variantId }]
    }));
    return prisma.commerceOrder.update({ where: { id: created.id }, data: { ...(free ? {} : { stripeSessionId: unique("cs") }), ...data } });
  };
  const paid = { status: "paid", paidAt: now, fulfilledAt: now, pickupStatus: "pending" };
  const orders = {
    paid: await order(hoodieOption.id, "sam@example.com", paid),
    free: await order(pinOption.id, "jordan@example.com", paid, true),
    refunded: await order(pinOption.id, "alex@example.com", { ...paid, refundStatus: "refunded" }),
    review: await order(hoodieOption.id, "noah@example.com", { status: "failed", requiresCompensationReview: true, reviewReason: "sold_out" }),
    expired: await order(hoodieOption.id, "mia@example.com", { status: "expired", failedAt: now }),
    pending: await order(hoodieOption.id, "pending@example.com", { status: "pending", expiresAt: new Date(now.getTime() + 60_000) })
  };
  const other = await createOrganisationAccount();
  const otherProduct = await prisma.merchandiseProduct.create({ data: { organisationId: other.organisation.id, name: "Cap", status: "published", publishedAt: now, firstPublishedAt: now } });
  const foreign = await order((await variant(otherProduct.id, other.organisation.id)).id, "foreign@example.com", paid, false, other.organisation.id);
  return { organisation, user, hoodie, orders, foreign };
}

describe("organiser commerce orders", () => {
  test("the merchandise list is scoped to the society, hides pending checkouts, and filters by state, buyer, product and date", async () => {
    const { organisation, hoodie, orders, foreign } = await society();
    const ids = async (options: Parameters<typeof listOrganisationCommerceOrders>[2]) =>
      (await listOrganisationCommerceOrders(organisation.id, "merchandise", options, first)).items.map((row) => row.id).sort();
    const sorted = (...list: Array<{ id: string }>) => list.map((row) => row.id).sort();

    expect(await ids({})).toEqual(sorted(orders.paid, orders.free, orders.refunded, orders.review, orders.expired));
    expect(await ids({})).not.toContain(foreign.id);
    expect(await ids({ filter: "paid" })).toEqual(sorted(orders.paid));
    expect(await ids({ filter: "free" })).toEqual(sorted(orders.free));
    expect(await ids({ filter: "refunded" })).toEqual(sorted(orders.refunded));
    expect(await ids({ filter: "review" })).toEqual(sorted(orders.review));
    expect(await ids({ filter: "expired" })).toEqual(sorted(orders.expired));
    expect(await ids({ search: "SAM@" })).toEqual(sorted(orders.paid));
    expect(await ids({ productId: hoodie.id })).toEqual(sorted(orders.paid, orders.review, orders.expired));
    expect(await ids({ startDate: new Date(Date.now() + 86_400_000) })).toEqual([]);
    expect(await listOrganisationCommerceOrders(organisation.id, "membership", {}, first)).toMatchObject({ items: [] });
  });

  test("pages are stable when orders share a timestamp", async () => {
    const { organisation, orders } = await society();
    const same = new Date("2026-10-01T00:00:00.000Z");
    // createdAt is a fixed fact once written; set the tie through the database directly.
    await prisma.$executeRawUnsafe(`ALTER TABLE "CommerceOrder" DISABLE TRIGGER "CommerceOrder_preserve_snapshot"`);
    try {
      await prisma.commerceOrder.updateMany({ where: { organisationId: organisation.id }, data: { createdAt: same } });
    } finally {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CommerceOrder" ENABLE TRIGGER "CommerceOrder_preserve_snapshot"`);
    }
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await listOrganisationCommerceOrders(organisation.id, "merchandise", {}, { limit: 2, direction: "next", cursor });
      seen.push(...page.items.map((row) => row.id));
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(seen).not.toContain(orders.pending.id);
  });

  test("the Orders tabs render for an owner, and a finance manager can open a merchandise order but not hand it over", async () => {
    const { organisation, user, orders, foreign } = await society();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const merchandise = await renderPage(await OrdersPage({ searchParams: Promise.resolve({ family: "merchandise" }) }));
    expect(merchandise).toContain(`/dashboard/merchandise/orders/${orders.paid.id}`);
    expect(merchandise).toContain(`Order ${orderReference(orders.paid.id)}`);
    expect(merchandise).toContain("Payment review");
    expect(merchandise).not.toContain(foreign.id);
    expect(merchandise).not.toContain("pending@example.com");
    expect(merchandise).toContain('href="/dashboard/orders?family=memberships"');

    const finance = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: finance.id, role: "finance_manager" });
    setMockSession({ userId: finance.id, email: finance.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: organisation.id });
    const page = await renderPage(await MerchandiseOrderPage({ params: Promise.resolve({ orderId: orders.paid.id }) }));
    expect(page).toContain(`Order ${orderReference(orders.paid.id)}`);
    expect(page).toContain("Refund whole order");
    expect(page).not.toContain("Mark ready");
    expect(page).not.toContain(">Record a return</button>");
    await expect(MerchandiseOrderPage({ params: Promise.resolve({ orderId: foreign.id }) })).rejects.toThrow();
  });

  test("the failed-notifications list uses the shared cursor and still refuses a bad one", async () => {
    const { organisation } = await createOrganisationAccount();
    for (let index = 0; index < 27; index += 1) {
      await prisma.notificationOutbox.create({ data: { eventKey: unique("failed"), recipient: "a@example.com", template: "business_notice", organisationId: organisation.id, privacy: "business", status: "failed", encryptedPayload: "x" } });
    }
    const page = await listFailedBusinessNotifications(organisation.id);
    expect(page.jobs).toHaveLength(25);
    expect((await listFailedBusinessNotifications(organisation.id, page.nextCursor ?? undefined)).jobs).toHaveLength(2);
    await expect(listFailedBusinessNotifications(organisation.id, "not-a-cursor")).rejects.toBeInstanceOf(NotificationCursorError);
  });
});
