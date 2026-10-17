import { test, expect, login, prisma, selectStaffContext } from "./fixtures";

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
  await page.getByLabel("Year", { exact: true }).selectOption(year);
  await page.getByRole("radio", { name: "Semester 1" }).check();
  await expect(page.getByLabel("First day")).toHaveValue(`${year}-01-01`);
  await expect(page.getByLabel("Last day")).toHaveValue(`${year}-06-30`);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(`Semester 1 ${year}`);
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

test("a member buys a free membership through checkout and the owner finds them on the Members tab", async ({ page, data }) => {
  const plan = await prisma.membershipProduct.create({
    data: {
      organisationId: data.organisation.id, name: "Semester 2 free", priceAmount: 0, entitlements: ["members_only_events"], status: "published", publishedAt: new Date(),
      startsAt: new Date(Date.now() - 86_400_000), endsAt: new Date(Date.now() + 100 * 86_400_000)
    }
  });
  await prisma.user.update({ where: { id: data.member.id }, data: { firstName: "Robin", lastName: "Member" } });
  await login(page, data.member.email, "/dashboard");
  const { token } = await (await page.request.get("/api/security/csrf")).json();
  const bought = await page.request.post("/api/payments/checkout/membership", {
    headers: { Origin: "http://localhost:3100", "x-thunderstrux-csrf-token": token },
    data: { organisationId: data.organisation.id, selection: { planId: plan.id }, expectedTotal: 0, idempotencyKey: "e2e-membership-free-0001" }
  });
  expect(bought.status()).toBe(200);
  expect((await bought.json()).kind).toBe("fulfilled");
  await page.context().clearCookies();

  await login(page, data.owner.email, "/dashboard/memberships/members");
  await expect(page.getByRole("link", { name: "Members", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("link", { name: "Active · 1" })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-roster-${width}.png`, fullPage: true });
  }
  await page.getByRole("link", { name: "Robin Member" }).first().click();
  await expect(page.getByRole("heading", { name: "Robin Member", level: 1 })).toBeVisible();
  await expect(page.getByText("Members-only events", { exact: true })).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/memberships-member-${width}.png`, fullPage: true });
  }

  // Ending it early: the free membership is cancelled through the dialog.
  await page.getByRole("button", { name: "Cancel free membership" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Nothing was charged, so there's nothing to refund.")).toBeVisible();
  await dialog.getByLabel("Reason").fill("Signed up twice by mistake.");
  await page.screenshot({ path: "test-results/memberships-cancel-dialog-1280.png" });
  await dialog.getByRole("button", { name: "Cancel membership" }).click();
  await expect(page.getByText("Free membership cancelled")).toBeVisible();
  await expect(page.getByText("Revoked", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel free membership" })).toHaveCount(0);
});
