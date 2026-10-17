import { test, expect, prisma, login, selectStaffContext } from "./fixtures";
import { createOrder } from "@/tests/helpers/test-data";

test("finance staff see the refund confirmation, a wrong reference refunds nothing, and a refunded order says so", async ({ page, data }) => {
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "finance_manager" } });
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
  await prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId: "acct_e2e_refunds" } });

  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.goto(`/dashboard/orders/${order.id}`);
  await page.getByRole("button", { name: "Refund whole order" }).click();
  const dialog = page.getByRole("dialog", { name: /Refund \$30\.00 to/ });
  await expect(dialog).toContainText("Anyone already checked in stays in the attendance record.");
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/order-refund-dialog-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Refused before Stripe: nothing is recorded and the tickets stay valid.
  await dialog.getByLabel("Reason").fill("Buyer asked for a refund.");
  await dialog.getByLabel(/^Type .+ to confirm$/).fill("WRONG1");
  await dialog.getByRole("button", { name: "Refund $30.00" }).click();
  await expect(dialog.getByRole("alert")).toContainText("to confirm");
  expect(await prisma.refundRequest.count({ where: { orderId: order.id } })).toBe(0);

  // A refund Stripe confirmed (recorded here directly: the browser campaign has no Stripe).
  await prisma.order.update({ where: { id: order.id }, data: { refundStatus: "refunded" } });
  await prisma.refundRequest.create({ data: {
    orderId: order.id, organisationId: data.organisation.id, amount: 3000, reason: "Buyer asked for a refund.", actorUserId: data.manager.id,
    operationKey: `order-refund:e2e-${order.id}`, status: "succeeded", resolvedAt: new Date()
  } });
  await page.goto(`/dashboard/orders/${order.id}`);
  await expect(page.getByText("Refunded $30.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund whole order" })).toHaveCount(0);
  await page.goto("/dashboard/orders");
  await expect(page.getByText("Refunded").first()).toBeVisible();
});
