import { execFileSync } from "node:child_process";
import { test, expect, login, createEvent } from "./fixtures";

// The 2026-10-29 polish: Change tickets keeps the choice, "Contact {society}"
// emails the society (as Humanitix's "Contact host"), and dashboard filters fold on phones.

test("Change tickets goes back to the event with the same ticket and quantity", async ({ page, data }) => {
  const event = await createEvent({
    organisationId: data.organisation.id,
    status: "published",
    ticketTypes: [
      { name: "Early bird", price: 0, quantity: 20 },
      { name: "Supporter", price: 0, quantity: 20 }
    ]
  });
  const supporter = event.ticketTypes[1];
  await login(page, data.member.email, `/events/${event.id}/checkout?ticketTypeId=${supporter.id}&quantity=3`);
  await page.getByRole("link", { name: "Change tickets" }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${event.id}\\?ticketTypeId=${supporter.id}&quantity=3$`));
  await expect(page.getByRole("radio", { name: /Supporter/ })).toBeChecked();
  await expect(page.getByLabel("Quantity")).toHaveValue("3");
});

test("a visitor contacts the society from an event page, and the society can reply", async ({ page, data }) => {
  await page.goto(`/events/${data.event.id}`);
  await page.getByRole("link", { name: `Contact ${data.organisation.name}` }).click();
  await expect(page.getByRole("heading", { name: `Contact ${data.organisation.name}` })).toBeVisible();
  await expect(page.getByText(`About ${data.event.title}.`, { exact: false })).toBeVisible();
  // The society's own addresses are never on the page.
  await expect(page.locator("main")).not.toContainText(data.owner.email);

  await page.getByLabel("Your name").fill("Robin Visitor");
  await page.getByLabel("Your email").fill("robin.visitor@example.com");
  await page.getByLabel("Message").fill("Can I bring a friend who isn't a student?");
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/society-contact-${width}.png`, fullPage: true });
  }
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByRole("status").filter({ hasText: `Sent. ${data.organisation.name} will reply to robin.visitor@example.com.` })).toBeVisible();

  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await page.request.get("http://mail-capture:8025/messages")).json();
  const enquiry = messages.find((message: { data: { to: string; subject: string } }) => message.data.to === data.owner.email && message.data.subject.includes("enquiry"));
  expect(enquiry.data.subject).toBe(`${data.event.title} enquiry from Robin Visitor`);
  expect(enquiry.data.reply_to).toBe("robin.visitor@example.com");
  expect(enquiry.data.text).toContain("Can I bring a friend who isn't a student?");
});

test("dashboard filters fold behind a toggle on phones", async ({ page, data }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await login(page, data.owner.email, "/dashboard/orders");
  const toggle = page.getByRole("button", { name: "Filters" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("Buyer email")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Buyer email")).toBeVisible();
  await page.screenshot({ path: "test-results/orders-filters-390.png", fullPage: true });

  // A filter that is on keeps the panel open and says so.
  await page.goto("/dashboard/orders?search=nobody");
  await expect(page.getByRole("button", { name: /Filters/ })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: /Filters/ })).toContainText("1 on");
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("button", { name: /Filters/ })).toBeHidden();
  await expect(page.getByLabel("Buyer email")).toBeVisible();
});
