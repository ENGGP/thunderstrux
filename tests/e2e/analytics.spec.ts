import { test, expect, prisma, login } from "./fixtures";
import { createOrder } from "@/tests/helpers/test-data";

// T32: the owner reaches Analytics from the sidebar, picks a quick range and
// moves between tabs; the chart's numbers are in the table beside it.
test("an owner reads ticket sales on Analytics and switches range and tab", async ({ page, data }) => {
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, status: "paid", quantity: 2, unitPrice: 1200, paidAt: new Date() });
  for (const issueSequence of [1, 2]) {
    await prisma.ticket.create({ data: { orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, issueSequence } });
  }
  await login(page, data.owner.email, "/dashboard");
  await page.getByRole("link", { name: "Analytics", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "Analytics" })).toBeVisible();
  await expect(page.getByText("$24.00").first()).toBeVisible();
  await expect(page.getByRole("table", { name: "Sales by day, in numbers" })).toBeVisible();

  await page.getByRole("link", { name: "Last 12 months" }).click();
  await expect(page).toHaveURL(/bucket=month/);
  await expect(page.getByRole("link", { name: "Last 12 months" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("table", { name: "Sales by month, in numbers" })).toBeVisible();
  // The form follows the URL after a quick range, not the inputs it had before.
  await expect(page.getByLabel("Group by")).toHaveValue("month");
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/analytics-tickets-${width}.png`, fullPage: true });
  }

  await page.getByRole("navigation", { name: "Analytics sections" }).getByRole("link", { name: "Merchandise" }).click();
  await expect(page.getByRole("heading", { name: "Pickups and stock, now" })).toBeVisible();
  await expect(page).toHaveURL(/tab=merchandise.*bucket=month|bucket=month.*tab=merchandise/);
});
