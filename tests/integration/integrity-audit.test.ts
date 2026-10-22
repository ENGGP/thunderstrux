import { describe, expect, test } from "vitest";
import { Prisma } from "@prisma/client";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { runDatabaseIntegrityAudit } from "@/lib/ops/integrity-audit";
import { createEvent, createMember, createMembershipGrant, createOrder, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

// T41: a clean society passes every check, and each invariant, broken directly
// in the database, is either refused by a constraint or found by the audit.

async function society() {
  const { organisation } = await createOrganisationAccount();
  const buyer = await createMember();
  const event = await createEvent({ organisationId: organisation.id, status: "published" });
  const ticketTypeId = event.ticketTypes[0].id;
  const now = new Date();
  const paid = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, userId: buyer.id, status: "paid", quantity: 2, paidAt: now, fulfilledAt: now });
  await prisma.order.update({ where: { id: paid.id }, data: { purchasedTicketTypeName: "General" } });
  for (const issueSequence of [1, 2]) await prisma.ticket.create({ data: { orderId: paid.id, eventId: event.id, ticketTypeId, organisationId: organisation.id, issueSequence } });
  const free = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId, userId: buyer.id, status: "paid", unitPrice: 0, paymentKind: "free", stripeSessionId: null as unknown as string, paidAt: now, fulfilledAt: now });
  await prisma.order.update({ where: { id: free.id }, data: { purchasedTicketTypeName: "General" } });
  await prisma.ticket.create({ data: { orderId: free.id, eventId: event.id, ticketTypeId, organisationId: organisation.id, issueSequence: 1 } });
  const grant = await createMembershipGrant(organisation.id, buyer.id, buyer.email, { startsAt: new Date(now.getTime() - 86_400_000), endsAt: new Date(now.getTime() + 30 * 86_400_000) });
  const membershipLine = await prisma.commerceOrderLine.findUniqueOrThrow({ where: { id: grant.commerceOrderLineId } });
  await prisma.commerceOrder.update({ where: { id: membershipLine.orderId }, data: { status: "paid", paidAt: now, fulfilledAt: now } });
  const product = await prisma.merchandiseProduct.create({ data: { organisationId: organisation.id, name: "Hoodie", status: "published", publishedAt: now, firstPublishedAt: now } });
  const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: organisation.id, sku: unique("SKU").toUpperCase(), priceAmount: 2500, remaining: 5 } });
  const merch = await prisma.$transaction((tx) => createCommerceOrder(tx, {
    organisationId: organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 250, source: "checkout",
    lines: [{ quantity: 2, unitAmount: 2500, name: "Hoodie", merchandiseVariantId: variant.id }]
  }));
  await prisma.commerceOrder.update({ where: { id: merch.id }, data: { status: "paid", paidAt: now, fulfilledAt: now, stripeSessionId: unique("cs") } });
  return { organisation, buyer, event, ticketTypeId, paid, free, grant, membershipOrderId: membershipLine.orderId, variant, merch };
}

const audit = async () => Object.fromEntries((await runDatabaseIntegrityAudit()).map((result) => [result.name, result.count]));

describe("integrity audit (T41)", () => {
  test("a clean society passes every check", async () => {
    await society();
    const counts = await audit();
    expect(Object.keys(counts).length).toBeGreaterThanOrEqual(38);
    expect(Object.entries(counts).filter(([, count]) => count > 0)).toEqual([]);
  });

  test("every broken invariant is refused by the database or found by the audit", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);
    // Each break runs on a fresh society and must raise its own check's count, or the write must fail.
    const breaks: Array<[string, (s: Awaited<ReturnType<typeof society>>) => Promise<unknown>]> = [
      ["free_order_has_no_charge", (s) => prisma.$executeRaw`UPDATE "Order" SET "totalAmount" = 500 WHERE "id" = ${s.free.id}`],
      ["paid_order_total_matches_units", (s) => prisma.$executeRaw`UPDATE "Order" SET "totalAmount" = "totalAmount" + 1 WHERE "id" = ${s.paid.id}`],
      ["order_has_buyer", (s) => prisma.$executeRaw`UPDATE "Order" SET "userId" = NULL WHERE "id" = ${s.paid.id}`],
      ["refunded_or_cancelled_order_has_no_valid_tickets", (s) => prisma.$executeRaw`UPDATE "Order" SET "refundStatus" = 'refunded' WHERE "id" = ${s.paid.id}`],
      ["fulfilled_order_issued_every_ticket", (s) => prisma.ticket.deleteMany({ where: { orderId: s.paid.id, issueSequence: 2 } })],
      ["refunds_within_order_total", (s) => prisma.refundRequest.create({ data: { orderId: s.paid.id, organisationId: s.organisation.id, amount: 999_999, reason: "Too much.", operationKey: unique("refund"), status: "succeeded", resolvedAt: new Date() } })],
      ["commerce_line_amount_matches", (s) => prisma.$executeRaw`UPDATE "CommerceOrderLine" SET "lineAmount" = "lineAmount" + 1 WHERE "orderId" = ${s.merch.id}`],
      ["commerce_total_matches_lines", (s) => prisma.$executeRaw`UPDATE "CommerceOrder" SET "totalAmount" = "totalAmount" + 1 WHERE "id" = ${s.merch.id}`],
      ["commerce_fee_within_total", (s) => prisma.$executeRaw`UPDATE "CommerceOrder" SET "feeAmount" = "totalAmount" + 1 WHERE "id" = ${s.merch.id}`],
      ["fulfilled_membership_has_grant", (s) => prisma.$executeRaw`DELETE FROM "MembershipGrant" WHERE "id" = ${s.grant.id}`],
      ["membership_term_positive", (s) => prisma.$executeRaw`UPDATE "MembershipGrant" SET "endsAt" = "startsAt" WHERE "id" = ${s.grant.id}`],
      ["refunded_membership_is_revoked", (s) => prisma.$executeRaw`UPDATE "CommerceOrder" SET "refundStatus" = 'refunded' WHERE "id" = ${s.membershipOrderId}`],
      ["membership_grants_do_not_overlap", (s) => createMembershipGrant(s.organisation.id, s.buyer.id, s.buyer.email, { startsAt: new Date(), endsAt: new Date(Date.now() + 60 * 86_400_000) })],
      ["merchandise_stock_nonnegative", (s) => prisma.$executeRaw`UPDATE "MerchandiseVariant" SET "remaining" = -1 WHERE "id" = ${s.variant.id}`],
      ["stale_ticket_hold_released", (s) => prisma.ticketReservation.create({ data: { orderId: s.paid.id, eventId: s.event.id, ticketTypeId: s.ticketTypeId, organisationId: s.organisation.id, userId: s.buyer.id, quantity: 2, status: "active", expiresAt: twoDaysAgo } })],
      ["stale_commerce_checkout_expired", (s) => prisma.$executeRaw`UPDATE "CommerceOrder" SET "status" = 'pending', "paidAt" = NULL, "fulfilledAt" = NULL, "expiresAt" = ${twoDaysAgo} WHERE "id" = ${s.merch.id}`],
      ["outbox_not_stuck", (s) => prisma.notificationOutbox.create({ data: { eventKey: unique("stuck"), recipient: s.buyer.email, template: "business_notice", privacy: "business", organisationId: s.organisation.id, encryptedPayload: "x", status: "processing", processingStartedAt: twoDaysAgo } })],
      ["sent_notification_was_accepted", (s) => prisma.notificationOutbox.create({ data: { eventKey: unique("sent"), recipient: s.buyer.email, template: "business_notice", privacy: "business", organisationId: s.organisation.id, encryptedPayload: "x", status: "sent" } })]
    ];
    const outcomes: Record<string, "refused" | "found"> = {};
    for (const [check, broken] of breaks) {
      const fixtures = await society();
      const before = await audit();
      try {
        await broken(fixtures);
      } catch (error) {
        expect(error instanceof Prisma.PrismaClientKnownRequestError || error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Error).toBe(true);
        outcomes[check] = "refused";
        continue;
      }
      const after = await audit();
      expect(after[check], `${check} should find the broken row`).toBeGreaterThan(before[check]);
      outcomes[check] = "found";
    }
    expect(Object.keys(outcomes).sort()).toEqual(breaks.map(([check]) => check).sort());
    console.info("integrity audit outcomes", JSON.stringify(outcomes));
  });

  test("rows from before a feature existed are reported but explained", async () => {
    const { paid } = await society();
    await prisma.order.update({ where: { id: paid.id }, data: { purchasedTicketTypeName: null } });
    const legacy = (await runDatabaseIntegrityAudit()).find((result) => result.name === "fulfilled_order_has_purchase_snapshot")!;
    expect(legacy).toMatchObject({ count: 1, legacy: expect.stringContaining("before purchase snapshots") });
  });
});
