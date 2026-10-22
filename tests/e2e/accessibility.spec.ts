import { mkdirSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, prisma, login, createMember } from "./fixtures";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { createMembershipGrant, createOrder, unique } from "@/tests/helpers/test-data";

// T40: every journey is scanned with axe (WCAG 2.2 AA rules) at phone, tablet
// and desktop widths and at 1280px zoomed to 200% (a 640px layout), and must
// reflow without sideways scrolling down to 320px. Scans find what a machine
// can; the keyboard and screen-reader passes are recorded in Accessibility Review.

const widths = [390, 768, 1280, 640];
const tags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
type Finding = { path: string; width: number; rule: string; impact: string | null | undefined; help: string; targets: string[] };

async function audit(page: Page, path: string) {
  const findings: Finding[] = [];
  const overflow: string[] = [];
  for (const width of [...widths, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))) overflow.push(`${path} @${width}`);
    if (width === 320) continue;
    const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
    for (const violation of violations) {
      findings.push({ path, width, rule: violation.id, impact: violation.impact, help: violation.help, targets: violation.nodes.slice(0, 5).map((node) => node.target.join(" ")) });
    }
  }
  return { findings, overflow };
}

async function auditAll(page: Page, name: string, paths: string[]) {
  const results = [];
  for (const path of paths) results.push(await audit(page, path));
  const findings = results.flatMap((result) => result.findings);
  const overflow = results.flatMap((result) => result.overflow);
  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/a11y-${name}.json`, JSON.stringify({ findings, overflow }, null, 2));
  expect(overflow, "pages that scroll sideways").toEqual([]);
  expect(findings.map((finding) => `${finding.rule} (${finding.impact}) ${finding.path} @${finding.width}: ${finding.targets.join(" | ")}`)).toEqual([]);
}

test.describe("accessibility scans", () => {
  test.describe.configure({ timeout: 300_000 });

  test("public journeys", async ({ page, data }) => {
    await auditAll(page, "public", [
      "/", "/events", `/events/${data.event.id}`, "/societies", `/societies/${data.organisation.slug}`,
      `/societies/${data.organisation.slug}/memberships`, `/societies/${data.organisation.slug}/merchandise`,
      "/login", "/signup", "/forgot-password", "/guest/recover"
    ]);
  });

  test("member journeys", async ({ page, data }) => {
    const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date() });
    await prisma.ticket.create({ data: { orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, issueSequence: 1 } });
    const grant = await createMembershipGrant(data.organisation.id, data.member.id, data.member.email);
    const line = await prisma.commerceOrderLine.findUniqueOrThrow({ where: { id: grant.commerceOrderLineId } });
    await login(page, data.member.email, "/dashboard");
    await auditAll(page, "member", [
      "/dashboard", "/tickets", "/purchases", `/purchases/tickets/${order.id}`, "/memberships", `/memberships/orders/${line.orderId}`,
      "/dashboard/organisations", "/account/settings", `/events/${data.event.id}/checkout?ticketTypeId=${data.ticket.id}&quantity=1`
    ]);
  });

  test("organiser journeys", async ({ page, data }) => {
    const buyer = await createMember();
    const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: buyer.id, status: "paid", paidAt: new Date() });
    await prisma.ticket.create({ data: { orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, issueSequence: 1 } });
    const grant = await createMembershipGrant(data.organisation.id, buyer.id, buyer.email);
    const product = await prisma.merchandiseProduct.create({ data: { organisationId: data.organisation.id, name: "Hoodie", status: "draft" } });
    const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId: data.organisation.id, sku: unique("SKU").toUpperCase(), priceAmount: 2500, remaining: 9, size: "M" } });
    const merch = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId: data.organisation.id, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 250, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 2500, name: "Hoodie", merchandiseVariantId: variant.id }]
    }));
    await prisma.commerceOrder.update({ where: { id: merch.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date(), stripeSessionId: unique("cs"), pickupStatus: "pending" } });
    await login(page, data.owner.email, "/dashboard");
    await auditAll(page, "organiser", [
      "/dashboard", "/dashboard/events", "/dashboard/events/new", `/dashboard/events/${data.event.id}`, `/dashboard/events/${data.event.id}/edit`,
      `/dashboard/events/${data.event.id}/tickets`, "/dashboard/calendar", "/dashboard/calendar?view=week", "/dashboard/calendar?view=agenda",
      "/dashboard/orders", `/dashboard/orders/${order.id}`, "/dashboard/analytics", "/dashboard/history",
      "/dashboard/memberships", `/dashboard/memberships/${grant.membershipProductId}`, "/dashboard/memberships/members", `/dashboard/memberships/members/${grant.id}`,
      "/dashboard/merchandise", `/dashboard/merchandise/${product.id}`, "/dashboard/merchandise/pickups", `/dashboard/merchandise/orders/${merch.id}`,
      "/dashboard/settings/profile", "/dashboard/settings/staff", "/dashboard/settings", "/dashboard/notifications"
    ]);
  });
});
