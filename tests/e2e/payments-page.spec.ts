import { test, expect, login } from "./fixtures";

// A society without Stripe: the page needs no provider call, so it renders in
// the campaign phase that has no Stripe key. Connected states are covered by
// integration tests, because they read the account from Stripe.
test("the Payments page explains connecting, fees and what free tickets need", async ({ page, data }) => {
  await login(page, data.owner.email, "/dashboard/settings");

  await expect(page.getByRole("heading", { name: "Payments", level: 1 })).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toBeVisible();
  await expect(page.getByText("Free tickets already work without it.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Stripe", exact: true })).toBeVisible();
  const fees = page.locator("section").filter({ has: page.getByRole("heading", { name: "Fees" }) });
  await expect(fees.getByText("$18.00")).toBeVisible();
  await expect(fees.getByText("$2.00")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Disconnect Stripe" })).toHaveCount(0);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/payments-${width}.png`, fullPage: true });
  }
});
