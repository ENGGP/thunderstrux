import sharp from "sharp";
import { test, expect, prisma, login } from "./fixtures";
import { toZonedInput, zonedCandidates } from "@/lib/zoned-time";

test("organisers build an event in the society's time zone with a dollar price and an image, then close sales", async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { timeZone: "Australia/Sydney" } });
  const day = toZonedInput(new Date(Date.now() + 40 * 24 * 3600 * 1000), "Australia/Sydney").slice(0, 10);
  await login(page, data.owner.email, "/dashboard/events/new");

  await expect(page.getByText(/Times are in Sydney time \(AE[DS]T, UTC\+1[01]\)/)).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Builder Night");
  await page.getByLabel("Description", { exact: true }).fill("Made in the builder");
  await page.getByLabel("Location", { exact: true }).fill("Great Hall");
  await page.getByLabel("Starts", { exact: true }).fill(`${day}T18:00`);
  await page.getByLabel("Ends", { exact: true }).fill(`${day}T21:00`);
  // The close time follows the start until it is changed.
  await expect(page.getByLabel("Ticket sales close", { exact: true })).toHaveValue(`${day}T18:00`);
  await page.getByLabel("Name", { exact: true }).fill("General");
  await page.getByLabel("Price", { exact: true }).fill("15.5");
  await page.getByLabel("Quantity", { exact: true }).fill("40");
  await page.getByRole("radio", { name: /Link only/ }).check();

  const buffer = await sharp({ create: { width: 32, height: 18, channels: 3, background: "teal" } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "hero.png", mimeType: "image/png", buffer });
  await expect(page.getByRole("img", { name: "Event image preview" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "You have unsaved changes." })).toBeVisible();

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/event-builder-${width}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Create event", exact: true }).click();
  await page.waitForURL((url) => /^\/dashboard\/events\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"));
  const event = await prisma.event.findFirstOrThrow({
    where: { organisationId: data.organisation.id, title: "Builder Night" },
    include: { ticketTypes: true }
  });
  const [start] = zonedCandidates(`${day}T18:00`, "Australia/Sydney");
  expect(event).toMatchObject({ visibility: "unlisted", startTime: start, salesCloseAt: start, status: "draft" });
  expect(event.heroAssetId).not.toBeNull();
  expect(event.ticketTypes[0]).toMatchObject({ price: 1550, quantity: 40 });
  await expect(page.getByRole("heading", { name: "Ready to publish?" })).toBeVisible();
  await expect(page.getByText("Sydney time", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/event-summary-draft.png", fullPage: true });

  await page.goto(`/dashboard/events/${event.id}/edit`);
  await expect(page.getByLabel("Price", { exact: true })).toHaveValue("15.50");
  await expect(page.getByLabel("Starts", { exact: true })).toHaveValue(`${day}T18:00`);
  await expect(page.getByText("No sales yet")).toBeVisible();

  // A published event closes sales from More and keeps its public page.
  await page.goto(`/dashboard/events/${data.event.id}`);
  await page.getByRole("button", { name: `More actions for ${data.event.title}` }).click();
  await page.getByRole("button", { name: /^Close sales/ }).click();
  await expect(page.getByText("Sales closed. The event stays published.")).toBeVisible();
  await expect(page.getByText("Sales closed", { exact: true }).first()).toBeVisible();
  expect(await prisma.event.findUniqueOrThrow({ where: { id: data.event.id } })).toMatchObject({ status: "published", saleState: "closed" });
});
