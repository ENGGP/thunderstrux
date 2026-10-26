import { execFileSync } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, createEvent } from "./fixtures";

// The newest emailed link for an address, after the notification worker sends what is queued.
async function emailedLink(request: APIRequestContext, to: string, subject: string) {
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await request.get("http://mail-capture:8025/messages")).json();
  const message = messages.filter((item: { data: { to: string; subject: string } }) => item.data.to === to && item.data.subject.includes(subject)).at(-1);
  expect(message, `an email "${subject}" to ${to}`).toBeTruthy();
  return message.data.text.split("\n\n").at(-1) as string;
}

test("a guest gets free tickets with a verified email, then finds them again from another browser", async ({ page, data, browser }) => {
  const event = await createEvent({ organisationId: data.organisation.id, status: "published", title: "Guest Games Night", ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }] });
  const email = `guest-${Date.now()}@example.com`;

  await page.goto(`/events/${event.id}`);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await expect(page.getByRole("heading", { name: "Where should we send your tickets?" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("First name").fill("Gia");
  await page.getByLabel("Last name").fill("Guest");
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/guest-checkout-email-${width}.png`, fullPage: true });
  }

  await page.goto(await emailedLink(page.request, email, "Confirm your email"));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "Confirm your free tickets" })).toBeVisible();
  await expect(page.getByText("Buying as a guest")).toBeVisible();
  await page.screenshot({ path: "test-results/guest-checkout-review-390.png", fullPage: true });
  await page.getByRole("button", { name: "Confirm free registration" }).click();
  await expect(page.getByRole("heading", { name: "You're going to Guest Games Night" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Your tickets" })).toContainText("Free entry");
  const orderUrl = page.url();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/guest-order-${width}.png`, fullPage: true });
  }

  // Another browser: the order address alone shows nothing; Find your purchase opens it.
  const other = await browser.newContext({ baseURL: "http://localhost:3100" });
  try {
    const stranger = await other.newPage();
    await stranger.goto(orderUrl);
    await expect(stranger.getByRole("heading", { name: "Open your order from your email" })).toBeVisible();
    await expect(stranger.getByText("Guest Games Night")).toHaveCount(0);

    await stranger.getByRole("link", { name: "Find your purchase" }).click();
    await stranger.getByLabel("Email").fill(email);
    await stranger.getByRole("button", { name: "Send my links" }).click();
    await expect(stranger.getByRole("status")).toContainText("we've sent a link for each one");
    await stranger.goto(await emailedLink(stranger.request, email, "Your Thunderstrux order"));
    await stranger.getByRole("button", { name: "Continue" }).click();
    await expect(stranger).toHaveURL(orderUrl);
    await expect(stranger.getByRole("heading", { name: "You're going to Guest Games Night" })).toBeVisible();
  } finally {
    await other.close();
  }
});
