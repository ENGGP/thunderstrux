import { test, expect, prisma, login } from "./fixtures";

// T38: an owner edits an event, then finds who changed what in History,
// filters it and reads it on a phone.
test("an owner reads what changed in History and filters it", async ({ page, data }) => {
  await prisma.event.update({ where: { id: data.event.id }, data: { title: "Engineering Mixer" } });
  await login(page, data.owner.email, `/dashboard/events/${data.event.id}/edit`);
  // Typing before the form is interactive is lost, so wait until it counts as a change.
  await expect(async () => {
    await page.getByLabel("Location", { exact: true }).fill("The Pav");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Event saved" })).toBeVisible();

  await page.getByRole("link", { name: "History", exact: true }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "History" })).toBeVisible();
  const edit = page.getByRole("listitem").filter({ hasText: "edited Engineering Mixer" });
  await expect(edit).toContainText("Owner");
  await expect(edit).toContainText("Integration Room");
  await expect(edit).toContainText("The Pav");

  await page.getByLabel("What").selectOption("events");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/category=events/);
  await expect(page.getByRole("listitem").filter({ hasText: "edited Engineering Mixer" })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/history-${width}.png`, fullPage: true });
  }
});
