import { test, expect, prisma, login, selectStaffContext } from "./fixtures";
import { createOrder } from "@/tests/helpers/test-data";

test("finance staff pick tickets to refund or cancel, a wrong reference changes nothing, a ticket cancelled without a refund stops working, and a refunded order says so", async ({ page, data }) => {
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "finance_manager" } });
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date(), quantity: 2, unitPrice: 1500 });
  await prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId: "acct_e2e_refunds", buyerEmailSnapshot: data.member.email, buyerIdentityCapturedAt: new Date(), buyerIdentityProvenance: "purchase" } });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id })) });
  const [first, second] = await prisma.ticket.findMany({ where: { orderId: order.id }, orderBy: { issueSequence: "asc" } });
  const reference = (id: string) => id.slice(-6).toUpperCase();

  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.goto(`/dashboard/orders/${order.id}`);
  // DEBT-002, as Humanitix: every valid ticket picked, for their full price, cancelled and emailed.
  await page.getByRole("button", { name: "Refund or cancel tickets" }).click();
  const dialog = page.getByRole("dialog", { name: /Refund or cancel .+ tickets\?/ });
  await expect(dialog.getByRole("checkbox", { name: new RegExp(reference(first.id)) })).toBeChecked();
  await expect(dialog.getByLabel("Refund amount")).toHaveValue("30.00");
  await expect(dialog).toContainText("Anyone already checked in stays in the attendance record.");
  // Picking fewer tickets resets the amount to their value; staff may lower it.
  await dialog.getByRole("checkbox", { name: new RegExp(reference(first.id)) }).uncheck();
  await expect(dialog.getByLabel("Refund amount")).toHaveValue("15.00");
  await dialog.getByLabel("Refund amount").fill("10");
  await expect(dialog).toContainText(`Refund $10.00 and cancel ${reference(second.id)}.`);
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/order-refund-dialog-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  // Refused before Stripe: nothing is recorded and the tickets stay valid.
  await dialog.getByLabel("Reason").fill("Buyer asked for a refund.");
  await dialog.getByLabel(/^Type .+ to confirm$/).fill("WRONG1");
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog.getByRole("alert")).toContainText("to confirm");
  expect(await prisma.refundRequest.count({ where: { orderId: order.id } })).toBe(0);

  // $0 cancels without a refund, so it needs no Stripe: the ticket stops working at once.
  await dialog.getByLabel("Refund amount").fill("0");
  await expect(dialog).toContainText(`No refund and cancel ${reference(second.id)}.`);
  await dialog.getByLabel(/^Type .+ to confirm$/).fill(reference(order.id));
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
  const tickets = page.getByRole("heading", { name: "Tickets", exact: true }).locator("..");
  await expect(tickets.getByRole("listitem").filter({ hasText: reference(second.id) })).toContainText("Cancelled");
  await expect(tickets.getByRole("listitem").filter({ hasText: reference(first.id) })).toContainText("Valid");
  await expect(page.getByText("Tickets cancelled without a refund")).toBeVisible();
  expect(await prisma.refundRequest.count({ where: { orderId: order.id } })).toBe(0);
  await page.screenshot({ path: "test-results/order-ticket-cancelled-1280.png", fullPage: true });

  // A refund Stripe confirmed (recorded here directly: the browser campaign has no Stripe).
  await prisma.order.update({ where: { id: order.id }, data: { refundStatus: "refunded" } });
  await prisma.refundRequest.create({ data: {
    orderId: order.id, organisationId: data.organisation.id, amount: 3000, reason: "Buyer asked for a refund.", actorUserId: data.manager.id,
    operationKey: `order-refund:e2e-${order.id}`, status: "succeeded", resolvedAt: new Date()
  } });
  await page.goto(`/dashboard/orders/${order.id}`);
  await expect(page.getByText("Refunded $30.00")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund or cancel tickets" })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Refund or cancel tickets" })).toHaveCount(0);
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
  await expect(page.getByRole("button", { name: "Refund or cancel tickets" })).toBeVisible();

  const partial = await paidOrder();
  await prisma.order.update({ where: { id: partial.id }, data: { externalRefundedAmount: 1500 } });
  await page.goto(`/dashboard/orders/${partial.id}`);
  await expect(page.getByText("Partly refunded in Stripe: needs review")).toBeVisible();
  await page.screenshot({ path: "test-results/order-partial-refund-1280.png", fullPage: true });
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.getByText("Partly refunded in Stripe", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refund the rest" })).toBeVisible();
});

test("finance staff cancel a free registration: the dialog names the consequences and the order reads Cancelled", async ({ page, data }) => {
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "finance_manager" } });
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date(), paymentKind: "free", unitPrice: 0, quantity: 2 });
  await prisma.ticket.createMany({ data: [1, 2].map((issueSequence) => ({ issueSequence, orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id })) });

  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.goto(`/dashboard/orders/${order.id}`);
  await page.getByRole("button", { name: "Cancel registration" }).click();
  const dialog = page.getByRole("dialog", { name: /free registration\?$/ });
  await expect(dialog).toContainText("The places don't go back on sale by themselves.");
  await expect(dialog.getByRole("button", { name: "Keep registration" })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/free-cancel-dialog-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });

  await dialog.getByLabel("Reason").fill("Duplicate registration.");
  await dialog.getByRole("button", { name: "Cancel registration" }).click();
  await expect(page.getByText("Registration cancelled", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing was charged, so there is nothing to refund.").first()).toBeVisible();
  await page.screenshot({ path: "test-results/free-cancelled-1280.png", fullPage: true });
  expect(await prisma.ticket.count({ where: { orderId: order.id, validity: "void", validityReason: "cancelled" } })).toBe(2);
  await page.goto("/dashboard/orders");
  await expect(page.getByText("Cancelled", { exact: true }).filter({ visible: true }).first()).toBeVisible();
});
