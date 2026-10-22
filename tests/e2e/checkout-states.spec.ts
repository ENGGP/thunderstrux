import type { Page } from "@playwright/test";
import { test, expect, prisma, login, createEvent } from "./fixtures";

// Each refusal changes the server state after the review page loaded, then
// checks the screen the real API answer picks. The campaign runs this with no
// Stripe key configured; every refusal here comes before Stripe is read.

async function noSidewaysScroll(page: Page, name: string) {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/checkout-${name}-${width}.png`, fullPage: true });
  }
}

function checkoutPath(eventId: string, ticketTypeId: string, quantity: number) {
  return `/events/${eventId}/checkout?ticketTypeId=${ticketTypeId}&quantity=${quantity}`;
}

test("a price changed while reviewing shows the new total and continues at it", async ({ page, data }) => {
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { stripeAccountId: "acct_e2e_ready", stripeChargesEnabled: true } });
  const event = await createEvent({
    organisationId: data.organisation.id,
    status: "published",
    ticketTypes: [{ name: "General admission", price: 1500, quantity: 20 }]
  });
  const ticketType = event.ticketTypes[0];

  await login(page, data.member.email, checkoutPath(event.id, ticketType.id, 2));
  await prisma.ticketType.update({ where: { id: ticketType.id }, data: { price: 1700 } });
  await page.getByRole("button", { name: "Pay $30.00" }).click();

  const screen = page.getByRole("alert").filter({ hasText: "The price changed" });
  await expect(screen).toContainText("General admission is now $17.00 per ticket. Your new total is $34.00. Nothing has been charged.");
  await expect(screen.getByRole("link", { name: "Change tickets" })).toBeVisible();
  // The summary reloads with the new price beside the screen.
  await expect(page.getByText("$34.00 AUD", { exact: true })).toBeVisible();
  await noSidewaysScroll(page, "price-changed");
  expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);

  // Continuing sends the new price: the request passes the quote check and only
  // stops at the Stripe key this campaign leaves unset.
  await screen.getByRole("button", { name: "Continue at $34.00" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Payments are unavailable right now" })).toBeVisible();
  await expect(page.getByText("The price changed")).toHaveCount(0);
});

test("sold out, fewer left and sales closed each get their own screen", async ({ page, data }) => {
  const event = await createEvent({
    organisationId: data.organisation.id,
    status: "published",
    title: "Free Mixer",
    ticketTypes: [{ name: "Free entry", price: 0, quantity: 5 }]
  });
  const ticketType = event.ticketTypes[0];
  const confirm = page.getByRole("button", { name: "Confirm free registration" });

  await login(page, data.member.email, checkoutPath(event.id, ticketType.id, 3));
  await prisma.ticketType.update({ where: { id: ticketType.id }, data: { quantity: 0 } });
  await confirm.click();
  const soldOut = page.getByRole("alert").filter({ hasText: "No tickets remaining" });
  await expect(soldOut).toContainText("Someone else got the last Free entry ticket first. Nothing has been charged.");
  await expect(soldOut.getByRole("link", { name: "Back to ticket options" })).toHaveAttribute("href", `/events/${event.id}`);
  await noSidewaysScroll(page, "sold-out");

  await prisma.ticketType.update({ where: { id: ticketType.id }, data: { quantity: 1 } });
  await page.reload();
  await confirm.click();
  const fewer = page.getByRole("alert").filter({ hasText: "Only 1 ticket left" });
  await expect(fewer).toContainText("There is 1 Free entry ticket left, and you asked for 3. Nothing has been charged.");
  await noSidewaysScroll(page, "fewer-left");
  await fewer.getByRole("button", { name: "Continue with 1 ticket" }).click();
  await expect(page.getByRole("heading", { name: "Free registration confirmed" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Ticket numbers" }).getByRole("listitem")).toHaveCount(1);

  await prisma.ticketType.update({ where: { id: ticketType.id }, data: { quantity: 5 } });
  await page.goto(checkoutPath(event.id, ticketType.id, 1));
  await prisma.event.update({ where: { id: event.id }, data: { saleState: "closed" } });
  await confirm.click();
  const closed = page.getByRole("alert").filter({ hasText: "Ticket sales have closed" });
  await expect(closed).toContainText("Free Mixer is no longer selling tickets. Nothing has been charged.");
  await expect(closed.getByRole("link", { name: "Back to the event" })).toBeVisible();
});

test("a society that cannot take payments points back to its free tickets", async ({ page, data }) => {
  const event = await createEvent({
    organisationId: data.organisation.id,
    status: "published",
    ticketTypes: [
      { name: "Supporter", price: 1000, quantity: 5 },
      { name: "Free entry", price: 0, quantity: 5 }
    ]
  });
  const paid = event.ticketTypes.find((type) => type.price > 0)!;

  // The seeded society has no Stripe account.
  await login(page, data.member.email, checkoutPath(event.id, paid.id, 1));
  await page.getByRole("button", { name: "Pay $10.00" }).click();
  const screen = page.getByRole("alert").filter({ hasText: "Paid checkout unavailable" });
  await expect(screen).toContainText(`${data.organisation.name} can't take payments right now. Free tickets are still available. Nothing has been charged.`);
  await expect(screen.getByRole("link", { name: "Back to ticket options" })).toBeVisible();
  await noSidewaysScroll(page, "payments-unavailable");
});
