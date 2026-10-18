import sharp from "sharp";
import type { Page } from "@playwright/test";
import { test, expect, login, prisma, selectStaffContext } from "./fixtures";

async function shoot(page: Page, name: string) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/merchandise-${name}-${width}.png`, fullPage: true });
  }
}

// T25: an owner drafts a product with a photo and two options, sees the
// publish check, publishes it and archives it.
test("an owner drafts a product with a photo and options, publishes it and archives it", async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { pickupPolicy: "EngSoc office, Level 2. Tuesdays and Thursdays, 12 to 2 pm." } });
  await login(page, data.owner.email, "/dashboard/merchandise");
  await expect(page.getByRole("heading", { name: "No products yet" })).toBeVisible();
  await page.getByRole("link", { name: "New product" }).first().click();
  await expect(page.getByRole("heading", { name: "New product", level: 1 })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("EngSoc hoodie");
  const png = await sharp({ create: { width: 40, height: 50, channels: 3, background: "#1f2a44" } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "hoodie.png", mimeType: "image/png", buffer: png });
  await expect(page.getByRole("img", { name: "EngSoc hoodie, photo 1 of 1" })).toBeVisible();

  const options = page.locator("#variants li");
  await options.nth(0).getByLabel("Colour").fill("Navy");
  await options.nth(0).getByLabel("Size").fill("L");
  await options.nth(0).getByLabel("Price").fill("45");
  await options.nth(0).getByLabel("Stock left").fill("5");
  await page.getByRole("button", { name: "Add option" }).click();
  await options.nth(1).getByLabel("Colour").fill("Sticker pack");
  await options.nth(1).getByLabel("Price").fill("0");
  await options.nth(1).getByLabel("Stock left").fill("20");
  await page.getByRole("button", { name: "Save draft" }).click();

  await expect(page.getByRole("heading", { name: "EngSoc hoodie", level: 1 })).toBeVisible();
  await expect(options.nth(0).getByLabel("SKU")).toHaveValue("ENGSOC-HOODIE-NAVY-L");
  // Paid options wait for payments; the free one in stock lets it publish.
  await expect(page.getByText("Ready to publish")).toBeVisible();
  await shoot(page, "editor");

  await page.getByRole("button", { name: "Publish product" }).click();
  await expect(page.getByRole("heading", { name: "On sale" })).toBeVisible();
  await page.goto("/dashboard/merchandise");
  await expect(page.getByRole("link", { name: "EngSoc hoodie" }).first()).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).first()).toBeVisible();
  await shoot(page, "products");

  await page.getByRole("link", { name: "Edit EngSoc hoodie" }).first().click();
  await page.getByRole("button", { name: "Archive product" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archive product" }).click();
  await expect(page.getByRole("button", { name: "Restore as draft" })).toBeVisible();
  expect(await prisma.merchandiseProduct.findFirstOrThrow({ where: { organisationId: data.organisation.id } })).toMatchObject({ status: "archived" });
});

test("staff without merchandise:manage see no Merchandise item and get not found", async ({ page, data }) => {
  await login(page, data.manager.email, "/dashboard");
  await selectStaffContext(page, data.organisation.id);
  await expect(page.getByRole("navigation", { name: "Organisation navigation" }).getByRole("link", { name: "Events" }).first()).toBeAttached();
  await expect(page.getByRole("link", { name: "Merchandise" })).toHaveCount(0);
  expect((await page.goto("/dashboard/merchandise"))?.status()).toBe(404);
});
