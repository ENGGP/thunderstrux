import { test, expect, prisma, login, createEvent } from "./fixtures";

test("a visitor who is not signed in can read an event, then signs in and lands on checkout", async ({ page, data }) => {
  await prisma.organisation.update({
    where: { id: data.organisation.id },
    data: { stripeAccountId: "acct_e2e_public", stripeChargesEnabled: true, supportEmail: "help@society.example", refundPolicy: "Refunds up to 48 hours before." }
  });

  await page.goto(`/events/${data.event.id}`);
  await expect(page).toHaveURL(`http://localhost:3100/events/${data.event.id}`);
  await expect(page.getByRole("heading", { name: data.event.title, exact: true })).toBeVisible();
  await expect(page.getByText("help@society.example")).toBeVisible();
  await expect(page.getByText("Refunds up to 48 hours before.")).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/public-event-anonymous-${width}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Sign in to buy" }).click();
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await page.getByLabel("Email", { exact: true }).fill(data.member.email);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/events/${data.event.id}/checkout\\?ticketTypeId=${data.ticket.id}&quantity=1$`));
  await expect(page.getByRole("heading", { name: "Review your order" })).toBeVisible();
});

test("organisers preview a draft exactly as buyers will see it, with buying off", async ({ page, data }) => {
  const draft = await createEvent({ organisationId: data.organisation.id, title: "Draft Showcase" });
  await login(page, data.owner.email, `/dashboard/events/${draft.id}`);

  await page.getByRole("navigation", { name: "Event sections" }).getByRole("link", { name: "Preview" }).click();
  await expect(page.getByRole("region", { name: "Draft preview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Draft Showcase", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get tickets" })).toBeDisabled();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/draft-preview-${width}.png`, fullPage: true });
  }

  // The draft itself stays hidden from the public, and a published event has no Preview tab.
  await page.goto(`/events/${draft.id}`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await page.goto(`/dashboard/events/${data.event.id}`);
  await expect(page.getByRole("navigation", { name: "Event sections" }).getByRole("link", { name: "Preview" })).toHaveCount(0);
});

// T46 (design round D1): the public Fees, Help and Privacy pages, linked from every footer.
test("a visitor finds Fees, Help and Privacy in the footer, with the fee worked out for them", async ({ page }) => {
  await page.goto("/societies");
  const footer = page.getByRole("navigation", { name: "Footer" });
  await footer.getByRole("link", { name: "Fees" }).click();
  await expect(page.getByRole("heading", { name: "Fees", level: 1 })).toBeVisible();
  await expect(page.getByText("3.75% plus $0.89 for each ticket, membership or merchandise order", { exact: false })).toBeVisible();
  const examples = page.getByRole("table");
  for (const [order, receives] of [["One $5.00 ticket", "$3.92"], ["Two $12.00 tickets", "$21.32"], ["A $25.00 membership", "$23.17"], ["Merchandise order of $55.00", "$52.05"]]) {
    await expect(examples.getByRole("row", { name: new RegExp(order.replaceAll("$", "\$")) })).toContainText(receives);
  }
  for (const [name, heading] of [["Fees", "What buyers pay"], ["Help", "Refunds"], ["Privacy", "Who can see it"]]) {
    await page.goto("/societies");
    await footer.getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/policy-${name.toLowerCase()}-${width}.png`, fullPage: true });
    }
  }
  // No support address is configured here, so no placeholder is shown.
  await expect(page.getByText("@", { exact: false })).toHaveCount(0);
  await page.goto("/help");
  await expect(page.getByRole("link", { name: "Find your purchase" })).toHaveAttribute("href", "/guest/recover");
  await expect(page.getByText("Never send card details", { exact: false })).toBeVisible();
});
