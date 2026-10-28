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
  await expect(list.getByText("Refunded", { exact: true }).filter({ visible: true })).toHaveCount(1);
  // A checkout that didn't complete is hidden behind a link (UI-019).
  await expect(list.getByText("Didn't complete").filter({ visible: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Show 1 checkout that didn't complete" }).click();
  await expect(list.getByText("Didn't complete").filter({ visible: true })).toHaveCount(1);
  await expect(page.getByText("Checkouts that didn't complete took no money.")).toBeVisible();
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

// Design round E1: an unpaid order says so and offers Cancel order while the hold lasts.
test("an unpaid order says it is waiting for payment, reads To pay, and asks once before cancelling", async ({ page, data }) => {
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, quantity: 1, unitPrice: 1200 });
  await prisma.ticketReservation.create({ data: { orderId: order.id, organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, quantity: 1, expiresAt: new Date(Date.now() + 20 * 60_000) } });

  await login(page, data.member.email, `/purchases/tickets/${order.id}`);
  await expect(page.getByText("Waiting for payment").first()).toBeVisible();
  await expect(page.getByText("You haven't paid yet")).toBeVisible();
  await expect(page.getByText("We're holding 1 ticket for you until", { exact: false })).toBeVisible();
  await expect(page.getByText("To pay", { exact: true })).toBeVisible();
  await expect(page.getByText("Paid", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel order" }).click();
  const dialog = page.getByRole("dialog", { name: "Cancel this order?" });
  await expect(dialog).toContainText("goes back on sale. Nothing has been charged.");
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/unpaid-order-dialog-${width}.png`, fullPage: true });
  }
  await dialog.getByRole("button", { name: "Keep it" }).click();
  await expect(dialog).toBeHidden();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/unpaid-order-${width}.png`, fullPage: true });
  }
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("pending");

  // Once the hold has ended, it didn't complete and nothing was charged.
  await prisma.ticketReservation.update({ where: { orderId: order.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
  await page.reload();
  await expect(page.getByText("Didn't complete").first()).toBeVisible();
  await expect(page.getByText("The hold ended before payment", { exact: false })).toBeVisible();
  await expect(page.getByText("Not charged", { exact: true })).toBeVisible();
});
