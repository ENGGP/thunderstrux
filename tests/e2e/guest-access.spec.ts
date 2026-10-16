import { execFileSync } from "node:child_process";
import { test, expect, prisma } from "./fixtures";

test("a guest confirms their email from the link, which works once", async ({ page, data }) => {
  const email = `guest-${Date.now()}@example.com`;
  const callback = `/events/${data.event.id}`;
  const requested = await page.request.post("/api/guest/email/request", {
    data: { email, callbackUrl: callback },
    headers: { origin: "http://localhost:3100" }
  });
  expect(requested.status()).toBe(202);

  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await page.request.get("http://mail-capture:8025/messages")).json();
  const message = messages.find((item: { data: { to: string; subject: string } }) => item.data.to === email && item.data.subject.includes("Confirm your email"));
  const link: string = message.data.text.split("\n\n").at(-1);
  expect(link).toContain("/guest/access#token=");

  // Opening the link shows the page and drops the token from the address; nothing is redeemed yet.
  await page.goto(link);
  await expect(page.getByRole("heading", { name: "Carry on with your order" })).toBeVisible();
  await expect.poll(() => page.url()).not.toContain("#");
  expect(await prisma.guestAccessGrant.count({ where: { guestIdentity: { email }, consumedAt: { not: null } } })).toBe(0);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/guest-access-${width}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(`http://localhost:3100${callback}`);
  const cookie = (await page.context().cookies()).find((item) => item.name === "thunderstrux-guest");
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  const session = await page.request.get("/api/guest/session");
  expect(await session.json()).toMatchObject({ email });

  // The same link again: refused, with a way back.
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "This link has stopped working" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
});
