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
  await page.getByRole("link", { name: "Explore societies", exact: true }).click();
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
    `http://localhost:3100/societies/${data.organisation.slug}`,
  );
  expect(
    await prisma.organisationMember.count({
      where: { userId: data.member.id, organisationId: data.organisation.id },
    }),
  ).toBe(0);
  await page.getByRole("button", { name: "Join society", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /^You've joined / }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("status").filter({ hasText: /^You've joined / }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Manage in My societies" }).click();
  await page
    .getByLabel("Search societies")
    .fill("Discovery campus society");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const searchCard = page
    .locator("article")
    .filter({
      has: page.getByRole("link", {
        name: "Discovery campus society",
        exact: true,
      }),
    });
  await expect(
    searchCard.getByRole("button", { name: "Joined", exact: true }),
  ).toBeVisible();
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
  await card
    .getByRole("button", { name: "Leave society", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Leave society", exact: true })
    .click();
  await expect(card).toHaveCount(0);
  await expect(
    searchCard.getByRole("button", { name: "Join society", exact: true }),
  ).toBeEnabled();
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

test("personal search paginates and ignores an older response", async ({
  page,
  data,
}) => {
  let releaseSlow!: () => void;
  const slowGate = new Promise<void>((resolve) => {
    releaseSlow = resolve;
  });
  let slowStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    slowStarted = resolve;
  });
  await page.route("**/api/orgs/search?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    const q = params.get("q");
    if (q === "slow") {
      slowStarted();
      await slowGate;
    }
    const name =
      q === "slow"
        ? "Older search result"
        : q === "fresh"
          ? "Fresh search result"
          : params.has("cursor")
            ? "Second search result"
            : "First search result";
    await route.fulfill({
      json: {
        organisations: [
          { id: name, name, slug: name.replaceAll(" ", "-"), joined: false },
        ],
        pageInfo: {
          nextCursor: !q && !params.has("cursor") ? "next" : null,
          previousCursor: params.has("cursor") ? "prev" : null,
        },
      },
    });
  });
  await login(page, data.member.email, "/dashboard/organisations");
  await expect(
    page.getByRole("heading", { name: "First search result" }),
  ).toBeVisible();
  // Paging replaces the list, both ways (UI-025).
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(
    page.getByRole("heading", { name: "Second search result" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "First search result" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Previous page" })).toBeVisible();
  const query = page.getByLabel("Search societies");
  await query.fill("slow");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await started;
  await query.fill("fresh");
  await query.evaluate((input) =>
    (input as HTMLInputElement).form!.requestSubmit(),
  );
  await expect(
    page.getByRole("heading", { name: "Fresh search result" }),
  ).toBeVisible();
  const oldResponse = page.waitForResponse(
    (response) => new URL(response.url()).searchParams.get("q") === "slow",
  );
  releaseSlow();
  await oldResponse;
  await expect(
    page.getByRole("heading", { name: "Older search result" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Fresh search result" }),
  ).toBeVisible();
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
    `/societies/${data.organisation.slug}`,
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
