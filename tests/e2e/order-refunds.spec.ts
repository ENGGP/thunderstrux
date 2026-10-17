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
  // The list renders a phone copy too; check the one on screen.
  await expect(page.getByText("Refunded", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});

test("a disputed order pauses refunds until staff restore it, and a partial refund made in Stripe can be reviewed", async ({ page, data }) => {
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "finance_manager" } });
  const paidOrder = async () => {
    const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
    await prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId: "acct_e2e_reviews" } });
    return order;
  };

  // Recorded here directly, as the dispute webhook would: the browser campaign has no Stripe.
  const disputed = await paidOrder();
  await prisma.order.update({ where: { id: disputed.id }, data: { disputeStatus: "open" } });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: disputed.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, validity: "refund_review" as const, validityReason: "disputed" })) });
  await prisma.purchaseDispute.create({ data: { orderId: disputed.id, organisationId: data.organisation.id, stripeDisputeId: `dp_e2e_${disputed.id}`, stripeChargeId: "ch_e2e", amount: 3000, currency: "aud", providerStatus: "needs_response", evidenceDueBy: new Date(Date.now() + 14 * 86400000) } });

  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.goto(`/dashboard/orders/${disputed.id}`);
  await expect(page.getByText("The buyer has disputed this payment")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the dispute in Stripe" })).toHaveAttribute("href", `https://dashboard.stripe.com/test/disputes/dp_e2e_${disputed.id}`);
  await expect(page.getByRole("button", { name: "Refund whole order" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resend tickets" })).toBeDisabled();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/order-dispute-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await prisma.order.update({ where: { id: disputed.id }, data: { disputeStatus: "won" } });
  await prisma.purchaseDispute.updateMany({ where: { orderId: disputed.id }, data: { providerStatus: "won", closedAt: new Date() } });
  await page.reload();
  await page.getByRole("button", { name: "Restore tickets" }).click();
  const dialog = page.getByRole("dialog", { name: "Restore the disputed tickets?" });
  await dialog.getByLabel("Reason").fill("Stripe closed the dispute in our favour.");
  await dialog.getByRole("button", { name: "Restore tickets" }).click();
  await expect(page.getByText("Stripe closed the dispute in the society's favour")).toHaveCount(0);
  expect(await prisma.ticket.count({ where: { orderId: disputed.id, validity: "active" } })).toBe(2);
  await expect(page.getByRole("button", { name: "Refund whole order" })).toBeVisible();

  const partial = await paidOrder();
  await prisma.order.update({ where: { id: partial.id }, data: { externalRefundedAmount: 1500 } });
  await page.goto(`/dashboard/orders/${partial.id}`);
  await expect(page.getByText("Partly refunded in Stripe: needs review")).toBeVisible();
  await page.screenshot({ path: "test-results/order-partial-refund-1280.png", fullPage: true });
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.getByText("Partly refunded in Stripe", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund the rest" })).toBeVisible();
});
