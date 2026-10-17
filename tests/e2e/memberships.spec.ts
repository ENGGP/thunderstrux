import { test, expect, login, selectStaffContext } from "./fixtures";

// T22: an owner drafts, fixes, publishes and archives a membership plan; staff
// without memberships:manage never see it. The society has no Stripe, so a
// paid plan waits on payments and a free one publishes.
test("an owner drafts a plan, sees the publish check, publishes it free and archives it", async ({ page, data }) => {
  await login(page, data.owner.email, "/dashboard/memberships");
  await expect(page.getByRole("heading", { name: "Memberships", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No membership plans yet" })).toBeVisible();

  await page.getByRole("link", { name: "New plan" }).first().click();
  await expect(page.getByRole("heading", { name: "New membership plan", level: 1 })).toBeVisible();
  const year = String(new Date().getFullYear() + 1);
  await page.getByLabel("Year").selectOption(year);
  await page.getByRole("radio", { name: "Semester 1" }).check();
  await expect(page.getByLabel("First day")).toHaveValue(`${year}-01-01`);
  await expect(page.getByLabel("Last day")).toHaveValue(`${year}-06-30`);
  await expect(page.getByLabel("Name")).toHaveValue(`Semester 1 ${year}`);
  await page.getByLabel("Price", { exact: true }).fill("25");
  await expect(page.getByText("your society receives $22.50")).toBeVisible();
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { name: `Semester 1 ${year}`, level: 1 })).toBeVisible();
  await expect(page.getByText("Set up payments to sell a paid plan.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish plan" })).toBeDisabled();

  await page.getByLabel("Price", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Plan saved.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish plan" })).toBeEnabled();
  await page.getByRole("button", { name: "Publish plan" }).click();
  await expect(page.getByRole("heading", { name: "On sale" })).toBeVisible();
  await expect(page.getByText("Published", { exact: true })).toBeVisible();

  for (const [path, name] of [["/dashboard/memberships", "list"], [page.url().replace("http://localhost:3100", ""), "plan"]] as const) {
    await page.goto(path);
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/memberships-${name}-${width}.png`, fullPage: true });
    }
  }

  await page.getByRole("button", { name: "Archive plan" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("An archived plan can't go back on sale.")).toBeVisible();
  await dialog.getByRole("button", { name: "Archive plan" }).click();
  await expect(page.getByText("This plan no longer sells")).toBeVisible();
  await page.goto("/dashboard/memberships");
  await expect(page.getByText("Archived", { exact: true }).first()).toBeVisible();
});

test("staff without memberships:manage see no Memberships item and get not found", async ({ page, data }) => {
  await login(page, data.manager.email, "/dashboard");
  await selectStaffContext(page, data.organisation.id);
  await expect(page.getByRole("navigation", { name: "Organisation navigation" }).getByRole("link", { name: "Events" }).first()).toBeAttached();
  await expect(page.getByRole("link", { name: "Memberships" })).toHaveCount(0);
  const response = await page.goto("/dashboard/memberships");
  expect(response?.status()).toBe(404);
});
