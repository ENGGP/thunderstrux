import { test, expect, login, prisma } from "./fixtures";
test("anonymous society discovery and verified join/leave show fresh personal state", async ({
  page,
  data,
}) => {
  await prisma.organisation.update({
    where: { id: data.organisation.id },
    data: {
      name: "Discovery campus society",
      description: "A friendly campus community",
      supportEmail: "contact@example.com",
    },
  });
  await page.goto("/");
  await page.getByRole("link", { name: "Societies", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Discover societies" }),
  ).toBeVisible();
  await page.getByLabel("Search societies").fill("Discovery campus society");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page
    .getByRole("link", { name: "Discovery campus society", exact: true })
    .click();
  await page.getByRole("link", { name: "Sign in to join society" }).click();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await page.getByLabel("Email", { exact: true }).fill(data.member.email);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(
    `http://localhost:3100/organisations/${data.organisation.slug}`,
  );
  expect(
    await prisma.organisationMember.count({
      where: { userId: data.member.id, organisationId: data.organisation.id },
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "Join society", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^Joined$/ }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: /^Joined$/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Manage joined societies" }).click();
  const card = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Your joined societies",
        exact: true,
      }),
    })
    .locator("article")
    .filter({
      has: page.getByRole("heading", {
        name: "Discovery campus society",
        exact: true,
      }),
    });
  page.once("dialog", (dialog) => dialog.accept());
  await card.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.goto(`/organisations/${data.organisation.slug}`);
  await expect(
    page.getByRole("button", { name: "Join society", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  const heading = page.getByRole("heading", {
    name: "Discovery campus society",
    exact: true,
  });
  const headerBottom = await page
    .locator("header")
    .first()
    .evaluate((element) => element.getBoundingClientRect().bottom);
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(headerBottom);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/society-discovery-mobile.png" });
});
test("unverified discovery offers verification and empty searches remain usable", async ({
  page,
  data,
}) => {
  await prisma.user.update({
    where: { id: data.member.id },
    data: { emailVerifiedAt: null },
  });
  await login(
    page,
    data.member.email,
    `/organisations/${data.organisation.slug}`,
  );
  await expect(
    page.getByRole("link", { name: "Verify email to join society" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join society", exact: true }),
  ).toHaveCount(0);
  await page.goto("/organisations?q=no-society-with-this-name");
  await expect(
    page.getByRole("heading", { name: "No societies found" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Show all societies" }).click();
  await expect(
    page.getByRole("heading", { name: "Discover societies" }),
  ).toBeVisible();
  expect(
    await prisma.organisationMember.count({
      where: { userId: data.member.id, organisationId: data.organisation.id },
    }),
  ).toBe(0);
});
