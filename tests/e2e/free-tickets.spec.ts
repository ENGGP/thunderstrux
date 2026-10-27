import { test, expect, prisma, login, createEvent } from "./fixtures";

// The campaign runs this with no Stripe key configured, so a free registration
// that reached Stripe would fail here.
test("members register for free tickets through the checkout page without Stripe", async ({ page, data }) => {
  const event = await createEvent({
    organisationId: data.organisation.id,
    status: "published",
    title: "Free Mixer",
    ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }]
  });
  await prisma.organisation.update({
    where: { id: data.organisation.id },
    data: { supportEmail: "help@society.example", refundPolicy: "Cancel up to a day before." }
  });

  await login(page, data.member.email, `/events/${event.id}`);
  await expect(page.getByText("Free", { exact: true }).first()).toBeVisible();
  await page.getByLabel("Quantity").fill("2");
  await page.getByRole("button", { name: "Get free tickets" }).click();

  await expect(page.getByRole("heading", { name: "Confirm your free tickets" })).toBeVisible();
  await expect(page.getByText("Booking for", { exact: false })).toBeVisible();
  await expect(page.getByText("No payment needed.")).toBeVisible();
  await expect(page.getByText("Can't make it? Cancel up to a day before.")).toBeVisible();
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/free-checkout-${width}.png`, fullPage: true });
  }

  await page.getByRole("button", { name: "Confirm free registration" }).click();
  await expect(page.getByRole("heading", { name: "Free registration confirmed" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Ticket numbers" }).getByRole("listitem")).toHaveCount(2);
  // Just issued, so the numbers arrive one by one.
  await expect(page.getByRole("list", { name: "Ticket numbers" })).toHaveClass(/issued-stagger/);
  await page.screenshot({ path: "test-results/free-confirmed-1280.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });

  const order = await prisma.order.findFirstOrThrow({
    where: { eventId: event.id, userId: data.member.id },
    include: { tickets: true, reservation: true, emailOutboxJobs: true }
  });
  expect(order).toMatchObject({ paymentKind: "free", status: "paid", totalAmount: 0, feeAmount: 0, stripeSessionId: null, reservation: null });
  expect(order.tickets).toHaveLength(2);
  expect(order.emailOutboxJobs).toHaveLength(1);
  expect((await prisma.ticketType.findFirstOrThrow({ where: { eventId: event.id } })).quantity).toBe(18);

  await page.getByRole("link", { name: "View my tickets" }).click();
  // The wallet groups the event's two ticket faces, each marked free.
  const group = page.getByRole("region", { name: /^Free Mixer/ });
  await expect(group.getByRole("article")).toHaveCount(2);
  await expect(group.getByText("Ticket 1 of 2 · Free")).toBeVisible();
});
