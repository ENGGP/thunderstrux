import sharp from "sharp";
import { test, expect, prisma, login } from "./fixtures";
import { createUser } from "@/tests/helpers/test-data";

test("society profile saves branding, keeps conflicting edits and remains public on mobile", async ({
  page,
  browser,
  data,
}) => {
  await login(page, data.owner.email);
  await page
    .getByRole("link", { name: "Settings", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Society profile" }),
  ).toBeVisible();
  await page
    .getByLabel("Description", { exact: true })
    .fill("Campus friends <script>alert('escaped')</script>");
  await page
    .getByLabel("Public contact email")
    .fill("society-contact@example.com");
  await page.getByLabel("Public contact email").focus();
  expect(
    await page
      .getByLabel("Public contact email")
      .evaluate((element) => getComputedStyle(element).outlineWidth),
  ).toBe("2px");
  await page.setViewportSize({ width: 390, height: 900 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/society-profile-form-mobile.png",
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Save profile", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "Profile saved." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "2. Branding" }).click();
  const buffer = await sharp({
    create: { width: 20, height: 20, channels: 3, background: "purple" },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Logo image")
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer });
  await expect(
    page.getByRole("status").filter({ hasText: "Image uploaded" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "logo preview" })).toBeVisible();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Profile saved." }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Public contact email")).toHaveValue(
    "society-contact@example.com",
  );
  const current = await prisma.organisation.findUniqueOrThrow({
    where: { id: data.organisation.id },
  });
  await prisma.organisation.update({
    where: { id: current.id },
    data: { name: "Committee updated name", profileVersion: { increment: 1 } },
  });
  await page.getByLabel("Society name").fill("Unsaved local edit");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.locator("form").getByRole("alert")).toContainText("profile changed");
  await expect(page.getByLabel("Society name")).toHaveValue(
    "Unsaved local edit",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Reload latest profile" }).click();
  await expect(page.getByLabel("Society name")).toHaveValue(
    "Committee updated name",
  );
  await page.getByRole("button", { name: "4. Finish" }).click();
  await expect(
    page.getByText("Profile complete.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "View public profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Committee updated name" }),
  ).toBeVisible();
  await expect(
    page.getByText("Campus friends <script>alert('escaped')</script>", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Committee updated name logo" }),
  ).toBeVisible();
  const anonymous = await browser.newContext({ baseURL: "http://localhost:3100" });
  try {
    const publicPage = await anonymous.newPage();
    await publicPage.goto(`/organisations/${data.organisation.slug}`);
    await expect(publicPage.getByRole("heading", { name: "Committee updated name" })).toBeVisible();
    expect(await publicPage.locator("body").textContent()).not.toContain(data.owner.email);
    for (const width of [1280, 390]) {
      await publicPage.setViewportSize({ width, height: 900 });
      expect(await publicPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await publicPage.screenshot({ path: `test-results/society-profile-${width}.png` });
    }
  } finally { await anonymous.close(); }
});
test("new organisation bootstrap selects its resumable profile without a stale personal context", async ({
  page,
}) => {
  const user = await createUser({ accountRole: "organisation" });
  await login(page, user.email, "/dashboard/create");
  const { token } = await (await page.request.get("/api/security/csrf")).json();
  expect(
    (
      await page.request.post("/api/me/context", {
        headers: {
          Origin: "http://localhost:3100",
          "x-thunderstrux-csrf-token": token,
        },
        data: { mode: "personal" },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await page.getByLabel("Organisation name").fill("New campus society");
  await page
    .getByRole("button", { name: "Create organisation", exact: true })
    .click();
  await expect(page).toHaveURL(
    "http://localhost:3100/dashboard/settings/profile",
  );
  await expect(page.getByLabel("Society name")).toHaveValue(
    "New campus society",
  );
  await page.getByRole("button", { name: "4. Finish" }).click();
  await expect(
    page.getByText("Profile incomplete:", { exact: false }),
  ).toBeVisible();
});
