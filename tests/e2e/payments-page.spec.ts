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
  await expect(fees.getByText("$18.36")).toBeVisible();
  await expect(fees.getByText("$1.64")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Disconnect Stripe" })).toHaveCount(0);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/payments-${width}.png`, fullPage: true });
  }
});

// A failed status check must never read as "Not connected": the account may be fine.
test("when the Stripe status can't be read, the Payments page says so and offers a retry, never Connect Stripe", async ({ page, data }) => {
  await page.route("**/api/stripe/connect/status**", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Internal error", details: [] } }) }));
  await login(page, data.owner.email, "/dashboard/settings");
  await expect(page.getByText("We couldn't check your Stripe account")).toBeVisible();
  await expect(page.getByText("Not connected", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Stripe", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Fees" })).toBeVisible();

  await page.unroute("**/api/stripe/connect/status**");
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: "Connect Stripe", exact: true })).toBeVisible();
});
