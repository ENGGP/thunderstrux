import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { test, expect, prisma, login, submitTwice } from "./fixtures";
import { formatDayInput } from "@/lib/date-input";
import { toZonedInput, zonedCandidates } from "@/lib/zoned-time";
import { createOrder } from "@/tests/helpers/test-data";

test("organisers build an event in the society's time zone with a dollar price and an image, then close sales", async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { timeZone: "Australia/Sydney" } });
  const day = toZonedInput(new Date(Date.now() + 40 * 24 * 3600 * 1000), "Australia/Sydney").slice(0, 10);
  await login(page, data.owner.email, "/dashboard/events/new");

  await expect(page.getByText(/Times are in Sydney time \(AE[DS]T, UTC\+1[01]\)/)).toBeVisible();
  await page.getByLabel("Title", { exact: true }).fill("Builder Night");
  await page.getByLabel("Description", { exact: true }).fill("Made in the builder");
  await page.getByLabel("Location", { exact: true }).fill("Great Hall");
  const when = (label: string) => page.getByRole("group", { name: label, exact: true });
  // Typed into the house date picker, then picked from its calendar by keyboard.
  await when("Starts").getByLabel("Date", { exact: true }).fill(day);
  await when("Starts").getByLabel("Date", { exact: true }).press("Enter");
  await when("Starts").getByLabel("Time").selectOption("18:00");
  await when("Ends").getByLabel("Date", { exact: true }).fill(day);
  await when("Ends").getByLabel("Date", { exact: true }).press("Enter");
  await when("Ends").getByRole("button", { name: "Choose date from a calendar" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: "test-results/date-picker-open.png" });
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await when("Ends").getByLabel("Time").selectOption("21:00");
  await expect(when("Ends").getByLabel("Date", { exact: true })).toHaveValue(formatDayInput(day));
  // The close time follows the start until it is changed.
  await expect(when("Ticket sales close").getByLabel("Date", { exact: true })).toHaveValue(formatDayInput(day));
  await expect(when("Ticket sales close").getByLabel("Time")).toHaveValue("18:00");
  await page.getByLabel("Name", { exact: true }).fill("General");
  await page.getByLabel("Price", { exact: true }).fill("15.5");
  await page.getByLabel("Quantity", { exact: true }).fill("40");
  // PAY-009: a busy event holds tickets for less than the 20-minute default.
  await expect(page.getByLabel("Checkout hold (minutes)")).toHaveValue("20");
  await page.getByLabel("Checkout hold (minutes)").fill("10");
  // Rounded with the same fee function checkout uses; the seeded society has no Stripe yet.
  await expect(page.getByText("For one ticket you receive $14.03", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "set up payments" })).toBeVisible();
  await page.getByRole("radio", { name: /Link only/ }).check();

  const buffer = await sharp({ create: { width: 32, height: 18, channels: 3, background: "teal" } }).png().toBuffer();
  await page.locator('input[type="file"]').setInputFiles({ name: "hero.png", mimeType: "image/png", buffer });
  await expect(page.getByRole("img", { name: "Event image preview" })).toBeVisible();
  // UI-018: the image gets a description for screen readers, used on the event page.
  await page.getByLabel("Image description (optional)").fill("Teal banner with the society logo");
  await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();

  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // The save bar's status fits whole at every width: "Unsaved" on a phone, never "Unsaved ch…".
    const saveStatus = page.getByRole("status").filter({ hasText: "Unsaved changes" }).locator("..");
    expect(await saveStatus.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/event-builder-${width}.png`, fullPage: true });
  }

  await submitTwice(page, page.getByRole("form", { name: "Event details" }), "/api/events");
  await page.waitForURL((url) => /^\/dashboard\/events\/[^/]+$/.test(url.pathname) && !url.pathname.endsWith("/new"));
  const event = await prisma.event.findFirstOrThrow({
    where: { organisationId: data.organisation.id, title: "Builder Night" },
    include: { ticketTypes: true }
  });
  const [start] = zonedCandidates(`${day}T18:00`, "Australia/Sydney");
  expect(event).toMatchObject({ visibility: "unlisted", startTime: start, salesCloseAt: start, status: "draft", checkoutHoldMinutes: 10 });
  expect(event.heroAssetId).not.toBeNull();
  expect(event.heroAlt).toBe("Teal banner with the society logo");
  expect(event.ticketTypes[0]).toMatchObject({ price: 1550, quantity: 40 });
  await expect(page.getByRole("heading", { name: "Ready to publish?" })).toBeVisible();
  await expect(page.getByText("Sydney time", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: "test-results/event-summary-draft.png", fullPage: true });

  await page.goto(`/dashboard/events/${event.id}/preview`);
  await expect(page.getByRole("img", { name: "Teal banner with the society logo" })).toBeVisible();
  await page.goto(`/dashboard/events/${event.id}/edit`);
  await expect(page.getByLabel("Image description (optional)")).toHaveValue("Teal banner with the society logo");
  await expect(page.getByLabel("Price", { exact: true })).toHaveValue("15.50");
  await expect(when("Starts").getByLabel("Date", { exact: true })).toHaveValue(formatDayInput(day));
  await expect(when("Starts").getByLabel("Time")).toHaveValue("18:00");
  await expect(page.getByText("No sales yet")).toBeVisible();

  // A published event closes sales from More and keeps its public page.
  await page.goto(`/dashboard/events/${data.event.id}`);
  await page.getByRole("button", { name: `More actions for ${data.event.title}` }).click();
  await page.getByRole("button", { name: /^Close sales/ }).click();
  await expect(page.getByText("Sales closed. The event stays published.")).toBeVisible();
  await expect(page.getByText("Sales closed", { exact: true }).first()).toBeVisible();
  expect(await prisma.event.findUniqueOrThrow({ where: { id: data.event.id } })).toMatchObject({ status: "published", saleState: "closed" });
});

// T30: a new place for an event with a sold ticket reaches the holder once,
// through the worker and Docker mail capture; the member can turn the one
// optional email off in Account settings.
test("moving a ticketed event emails the holder, and a member turns renewal reminders off", async ({ page, data }) => {
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date() });
  await prisma.ticket.create({ data: { orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, issueSequence: 1 } });
  await login(page, data.owner.email, `/dashboard/events/${data.event.id}/edit`);
  await expect(page.getByText("Ticket holders get an email only if you change the time or place.", { exact: false })).toBeVisible();
  // Typing before the form is interactive is lost, so wait until it counts as a change.
  await expect(async () => {
    await page.getByLabel("Location", { exact: true }).fill("Great Hall");
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Event saved" })).toBeVisible();

  // Skip the pause that lets a quick correction replace the change.
  const change = await prisma.eventChange.findFirstOrThrow({ where: { eventId: data.event.id } });
  await prisma.eventChange.update({ where: { id: change.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await page.request.get("http://mail-capture:8025/messages")).json();
  const sent = messages.filter((message: { data: { to: string; subject: string } }) => message.data.to === data.member.email && message.data.subject === `Change to ${data.event.title}`);
  expect(sent).toHaveLength(1);
  expect(sent[0].data.text).toContain("Where: now Great Hall. It was Integration Room.");

  await page.context().clearCookies();
  await login(page, data.member.email, "/account/settings#notifications");
  const reminders = page.getByRole("checkbox", { name: /Membership renewal reminders/ });
  await expect(reminders).toBeChecked();
  await reminders.uncheck();
  await page.getByRole("button", { name: "Save preferences", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Preferences saved." })).toBeVisible();
  await page.locator("#notifications").screenshot({ path: "test-results/account-notifications.png" });
  expect((await prisma.user.findUniqueOrThrow({ where: { id: data.member.id } })).renewalReminders).toBe(false);
});
