import { test, expect, prisma, login } from "./fixtures";
import { createOrder } from "@/tests/helpers/test-data";

// Tickets for one of the seed member's orders, numbered from 1.
async function issue(order: { id: string; eventId: string; ticketTypeId: string; organisationId: string }, count: number) {
  await prisma.ticket.createMany({ data: Array.from({ length: count }, (_, index) => ({ issueSequence: index + 1, orderId: order.id, eventId: order.eventId, ticketTypeId: order.ticketTypeId, organisationId: order.organisationId })) });
}

test("a member sees every purchase in their own words and a wallet of ticket faces, on desktop and phone", async ({ page, data }) => {
  const base = { organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id };
  const paid = await createOrder({ ...base, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
  await issue(paid, 2);
  await prisma.ticket.updateMany({ where: { orderId: paid.id, issueSequence: 2 }, data: { checkedInAt: new Date() } });
  const refunded = await createOrder({ ...base, status: "paid", paidAt: new Date(), unitPrice: 1200 });
  await issue(refunded, 1);
  await prisma.order.update({ where: { id: refunded.id }, data: { refundStatus: "refunded" } });
  await prisma.ticket.updateMany({ where: { orderId: refunded.id }, data: { validity: "void", validityReason: "refunded", validityChangedAt: new Date() } });
  await createOrder({ ...base, status: "expired" });

  await login(page, data.member.email, "/tickets");
  await expect(page.getByRole("link", { name: /^Upcoming/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("article")).toHaveCount(2);
  await expect(page.getByRole("article").filter({ hasText: "Checked in" })).toHaveCount(1);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/wallet-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("link", { name: /^Not valid/ }).click();
  await expect(page.getByRole("article").filter({ hasText: "Refunded" })).toHaveCount(1);

  await page.getByRole("navigation", { name: "Personal navigation" }).getByRole("link", { name: "Purchases" }).click();
  const list = page.getByRole("region", { name: "Purchases" });
  await expect(list.getByText("Didn't complete").filter({ visible: true })).toHaveCount(1);
  await expect(list.getByText("Refunded", { exact: true }).filter({ visible: true })).toHaveCount(1);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/purchases-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/purchases/tickets/${paid.id}`);
  await expect(page.getByRole("heading", { name: "What happened" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Show tickets in My tickets" })).toBeVisible();
  await page.screenshot({ path: "test-results/purchase-order-1280.png", fullPage: true });

  // Another member's order is the same not-found page.
  const other = await createOrder({ ...base, userId: data.manager.id, status: "paid", paidAt: new Date() });
  await page.goto(`/purchases/tickets/${other.id}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
});

test("back from Stripe, the success page says it is confirming until the webhook lands, then updates by itself", async ({ page, data }) => {
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, quantity: 2, unitPrice: 1500 });
  await prisma.order.update({ where: { id: order.id }, data: { buyerEmailSnapshot: data.member.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });

  await login(page, data.member.email, "/tickets");
  await page.goto(`/success?session_id=${order.stripeSessionId}`);
  await expect(page.getByRole("heading", { name: "Confirming your payment" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: "test-results/success-confirming-390.png", fullPage: true });

  // The webhook lands while the page is open; the poller refreshes it.
  await prisma.order.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date() } });
  await issue(order, 2);
  await expect(page.getByRole("heading", { name: "You're going" })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("they're in My tickets now")).toBeVisible();
  await page.screenshot({ path: "test-results/success-confirmed-390.png", fullPage: true });

  await page.goto(`/cancel?order=${order.id}`);
  await expect(page.getByRole("heading", { name: "Your order went through" })).toBeVisible();
});
