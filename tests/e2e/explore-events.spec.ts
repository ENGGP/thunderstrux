import { test, expect, prisma, createEvent } from "./fixtures";

test("visitors explore events by title, society and dates, on desktop and phone", async ({ page, data }) => {
  await prisma.event.update({ where: { id: data.event.id }, data: { title: "Explore Mixer Night" } });
  const ended = await createEvent({ organisationId: data.organisation.id, status: "published", title: "Explore Ended Night" });
  await prisma.event.update({ where: { id: ended.id }, data: { startTime: new Date(Date.now() - 5 * 3600_000), endTime: new Date(Date.now() - 3600_000) } });

  await page.goto("/");
  await page.getByRole("banner").getByRole("link", { name: "Explore events" }).click();
  await expect(page).toHaveURL(/\/events$/);
  await expect(page.getByRole("heading", { name: "Explore events", level: 1 })).toBeVisible();

  const filters = page.getByRole("search", { name: "Filter events" });
  await filters.getByLabel("Search by title").fill("explore");
  await filters.getByLabel("Society").selectOption({ label: data.organisation.name });
  await filters.getByRole("button", { name: "Show events" }).click();
  await expect(page).toHaveURL(new RegExp(`q=explore.*society=${data.organisation.slug}`));
  await expect(page.getByRole("link", { name: "Explore Mixer Night" })).toBeVisible();
  await expect(page.getByText("Explore Ended Night")).toHaveCount(0);

  // A range longer than 366 days is refused at the field, and no list shows.
  await filters.getByLabel("When").selectOption("custom");
  await filters.getByLabel("From").fill("2026-01-01");
  await filters.getByLabel("To").fill("2027-06-01");
  await filters.getByRole("button", { name: "Show events" }).click();
  await expect(page.getByText("Choose a range of 366 days or less.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore Mixer Night" })).toHaveCount(0);

  await page.goto("/events?q=nothing-matches-this");
  await expect(page.getByRole("heading", { name: "No events match these filters" })).toBeVisible();
  await page.getByRole("link", { name: "Clear filters" }).click();
  await expect(page).toHaveURL(/\/events$/);

  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/explore-events-${width}.png`, fullPage: true });
  }

  // On a phone, When and Society fold behind the Filters toggle.
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(filters.getByLabel("When")).toBeHidden();
  await filters.getByRole("button", { name: "Filters" }).click();
  await expect(filters.getByLabel("When")).toBeVisible();
});
