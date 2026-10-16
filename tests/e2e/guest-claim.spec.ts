import { execFileSync } from "node:child_process";
import { test, expect, login, createEvent, createMember } from "./fixtures";

test("a guest who later signs in with the same email adds the order to their account", async ({ page, data }) => {
  const event = await createEvent({ organisationId: data.organisation.id, status: "published", title: "Claimable Quiz Night", ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }] });
  const email = `claim-${Date.now()}@example.com`;

  await page.goto(`/events/${event.id}`);
  await page.getByRole("button", { name: "Continue as guest" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("status")).toContainText(email);
  execFileSync("node", ["scripts/process-notifications.mjs"], { stdio: "pipe" });
  const messages = await (await page.request.get("http://mail-capture:8025/messages")).json();
  const link = messages.filter((item: { data: { to: string } }) => item.data.to === email).at(-1).data.text.split("\n\n").at(-1);
  await page.goto(link);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Confirm free registration" }).click();
  await expect(page.getByRole("heading", { name: "You're going to Claimable Quiz Night" })).toBeVisible();
  const orderPath = new URL(page.url()).pathname;

  // The same browser signs in with an account for the same, verified email.
  await createMember({ email });
  await login(page, email, orderPath);
  await expect(page.getByText("Add this order to your account?")).toBeVisible();
  await page.getByRole("button", { name: "Add to my account" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to your account?" });
  await expect(dialog).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: `test-results/guest-claim-dialog-${width}.png`, fullPage: true });
  }
  await dialog.getByRole("button", { name: "Add to my account" }).click();
  // The page refreshes into its claimed state.
  await expect(page.getByText("This order is in your account")).toBeVisible();

  await page.goto("/tickets");
  await expect(page.getByText("Claimable Quiz Night")).toBeVisible();
});
