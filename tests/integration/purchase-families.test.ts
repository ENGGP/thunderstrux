import { describe, expect, test, vi } from "vitest";
import PurchasesPage from "@/app/purchases/page";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { orderReference } from "@/lib/payments/order-refunds";
import { getOwnCommerceOrders } from "@/lib/commerce/orders";
import { ticketOrderProjection } from "@/lib/purchases/projection";
import { getOwnTicketPurchases, ownPurchaseCounts } from "@/lib/purchases/ticket-purchases";
import { setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/navigation")>()), usePathname: () => "/purchases", useRouter: () => ({ refresh: () => undefined }) }));

const day = 86_400_000;
const page = (family?: string) => PurchasesPage({ searchParams: Promise.resolve(family ? { family } : {}) }).then(renderPage);

// A member's orders of each commerce family, in one society, and another member's.
async function fixture() {
  const { organisation } = await createOrganisationAccount();
  const buyer = await createMember();
  const stranger = await createMember();
  const now = new Date();
  const merch = async (userId: string, email: string, names: string[], data: Record<string, unknown>) => {
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: organisation.id, kind: "merchandise", buyer: { userId }, buyerEmail: email, paymentKind: "stripe", feeAmount: 0, source: "checkout",
      lines: names.map((name) => ({ quantity: 1, unitAmount: 1000, name }))
    }));
    return prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, stripeSessionId: unique("cs"), ...data } });
  };
  const ready = await merch(buyer.id, buyer.email, ["EngSoc hoodie", "Tote bag", "Sticker pack"], { pickupStatus: "ready" });
  const refunded = await merch(buyer.id, buyer.email, ["Enamel pin"], { pickupStatus: "pending", refundStatus: "refunded" });
  const theirs = await merch(stranger.id, stranger.email, ["Somebody else's cap"], { pickupStatus: "pending" });
  const term = { startsAt: new Date(now.getTime() - day), endsAt: new Date(now.getTime() + 100 * day) };
  const plan = await prisma.membershipProduct.create({ data: { organisationId: organisation.id, name: "Semester 2", priceAmount: 0, ...term, status: "published", publishedAt: now } });
  const membership = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: organisation.id, kind: "membership", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "free", source: "checkout",
    lines: [{ quantity: 1, unitAmount: 0, name: plan.name, termStartsAt: term.startsAt, termEndsAt: term.endsAt, membershipProductId: plan.id }]
  }));
  await prisma.commerceOrder.update({ where: { id: membership.id }, data: { status: "paid", paidAt: now, fulfilledAt: now } });
  setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
  return { buyer, ready, refunded, theirs, membership };
}

describe("purchase families", () => {
  // UI-019: a checkout that didn't complete is hidden from Purchases and its
  // counts by default, but nothing that took money or needs following up is.
  test("hiding checkouts that didn't complete never hides a charged, pending, reviewed, refunded or cancelled order", async () => {
    const { organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const buyer = await createMember();
    const order = async (status: "pending" | "paid" | "failed" | "expired", data: Record<string, unknown> = {}, paymentKind: "stripe" | "free" = "stripe") => {
      const created = await createOrder({
        organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, status, paymentKind, unitPrice: paymentKind === "free" ? 0 : 1200,
        ...(status === "paid" ? { paidAt: new Date() } : status === "failed" ? { failedAt: new Date(), failureReason: "test" } : {})
      });
      return Object.keys(data).length ? prisma.order.update({ where: { id: created.id }, data }) : created;
    };
    const hidden = [await order("expired"), await order("failed")];
    const shown = [
      await order("pending"),
      await order("paid"),
      await order("failed", { requiresCompensationReview: true }),
      await order("failed", { isManuallyRefunded: true }),
      await order("failed", { refundStatus: "refunded" }),
      await order("failed", { refundStatus: "processing" }),
      await order("expired", { disputeStatus: "won" }),
      await order("expired", { externalRefundedAmount: 500, externalRefundReviewedAt: new Date() }),
      await order("paid", { cancelledAt: new Date(), cancellationReason: "Event moved online" }, "free")
    ];
    const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();
    const page = { limit: 25, direction: "next" as const };

    const listed = (await getOwnTicketPurchases(buyer.id, page)).items;
    expect(ids(listed)).toEqual(ids(shown));
    // Everything hidden reads as a checkout that didn't complete.
    for (const row of hidden) expect(["failed", "expired"]).toContain(ticketOrderProjection(row));
    expect(ids((await getOwnTicketPurchases(buyer.id, page, { incomplete: true })).items)).toEqual(ids([...hidden, ...shown]));
    expect(await ownPurchaseCounts(buyer.id)).toMatchObject({ tickets: shown.length, abandoned: { tickets: hidden.length } });

    // The same rule for commerce orders.
    const merch = async (data: Record<string, unknown>) => {
      const created = await prisma.$transaction((tx) => createCommerceOrder(tx, {
        organisationId: organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 0, source: "checkout",
        lines: [{ quantity: 1, unitAmount: 1000, name: "Hoodie" }]
      }));
      return prisma.commerceOrder.update({ where: { id: created.id }, data });
    };
    const lapsed = await merch({ status: "expired" });
    const kept = [await merch({ status: "failed", refundStatus: "refunded" }), await merch({ status: "failed", requiresCompensationReview: true }), await merch({ status: "paid", paidAt: new Date() })];
    expect(ids((await getOwnCommerceOrders(buyer.id, page, "merchandise")).items)).toEqual(ids(kept));
    expect(ids((await getOwnCommerceOrders(buyer.id, page, "merchandise", { incomplete: true })).items)).toEqual(ids([lapsed, ...kept]));
    expect(await ownPurchaseCounts(buyer.id)).toMatchObject({ merchandise: kept.length, abandoned: { merchandise: 1 } });
  });

  test("the Merchandise and Memberships tabs list only the member's own orders, with payment and pickup as separate badges", async () => {
    const { buyer, ready, refunded, theirs, membership } = await fixture();
    expect(await ownPurchaseCounts(buyer.id)).toEqual({ tickets: 0, memberships: 1, merchandise: 2, abandoned: { tickets: 0, memberships: 0, merchandise: 0 } });

    const merchandise = await page("merchandise");
    expect(merchandise).toContain(`/merchandise/orders/${ready.id}`);
    expect(merchandise).toContain("EngSoc hoodie and 2 more");
    expect(merchandise).toContain(`Order ${orderReference(ready.id)}`);
    expect(merchandise).toContain("Ready to collect");
    // A refund before pickup reads Refunded, and the pickup "Not collected".
    expect(merchandise).toContain(`/merchandise/orders/${refunded.id}`);
    expect(merchandise).toContain("Refunded");
    expect(merchandise).toContain("Not collected");
    expect(merchandise).not.toContain(theirs.id);
    expect(merchandise).not.toContain("Somebody else");

    const memberships = await page("memberships");
    expect(memberships).toContain(`/memberships/orders/${membership.id}`);
    expect(memberships).toContain("Semester 2");
    expect(memberships).not.toContain(ready.id);

    // Tickets stay the default tab and URL; an unknown family is the tickets tab too.
    for (const html of [await page(), await page("anything")]) {
      expect(html).toContain("No purchases yet");
      expect(html).toContain('href="/purchases?family=merchandise"');
    }
  });
});
