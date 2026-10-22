import { test, expect, prisma, login, selectStaffContext, createMember, createOrganisationStaff } from "./fixtures";
import { createOrder } from "@/tests/helpers/test-data";

// T34: every role and mode lands on an overview made for it, on desktop and phone.
const fits = async (page: import("@playwright/test").Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test("owner, event manager and check-in staff each get their own society overview", async ({ page, data }) => {
  // The fixture event starts in an hour, so it is today's door too.
  const start = new Date(Date.now() + 3600_000);
  await prisma.event.update({ where: { id: data.event.id }, data: { title: "Engineering Mixer", startTime: start, endTime: new Date(start.getTime() + 2 * 3600_000), salesCloseAt: start } });

  await login(page, data.owner.email, "/dashboard");
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Needs your attention|ready$/ })).toBeVisible();
  await expect(page.getByText("Sales this month")).toBeVisible();
  await expect(page.getByRole("link", { name: "Engineering Mixer" }).first()).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
    await page.screenshot({ path: `test-results/overview-owner-${width}.png`, fullPage: true });
  }
  await page.context().clearCookies();
  await page.setViewportSize({ width: 1280, height: 900 });

  await login(page, data.manager.email, "/dashboard");
  await selectStaffContext(page, data.organisation.id);
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  await expect(page.getByText("Tickets issued this month")).toBeVisible();
  await expect(page.getByText("Sales this month")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent orders" })).toHaveCount(0);
  await page.context().clearCookies();

  const volunteer = await createMember();
  await createOrganisationStaff({ organisationId: data.organisation.id, userId: volunteer.id, role: "check_in_staff" });
  await login(page, volunteer.email, "/dashboard");
  await selectStaffContext(page, data.organisation.id);
  await expect(page.getByRole("heading", { level: 1, name: "Today at the door" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 900 });
  await fits(page);
  await page.screenshot({ path: "test-results/overview-door-390.png", fullPage: true });
  await page.getByRole("link", { name: "Open check-in for Engineering Mixer" }).click();
  await expect(page).toHaveURL(new RegExp(`/dashboard/events/${data.event.id}/tickets`));
});

test("a member's overview leads with their next valid ticket", async ({ page, data }) => {
  const start = new Date(Date.now() + 2 * 86_400_000);
  await prisma.event.update({ where: { id: data.event.id }, data: { title: "Halloween Social", startTime: start, endTime: new Date(start.getTime() + 3 * 3600_000), salesCloseAt: start } });
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date() });
  await prisma.ticket.create({ data: { orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, issueSequence: 1 } });

  await login(page, data.member.email, "/dashboard");
  await expect(page.getByText("Your next plans")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Halloween Social" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent purchases" })).toBeVisible();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await fits(page);
    await page.screenshot({ path: `test-results/overview-personal-${width}.png`, fullPage: true });
  }
  await page.getByRole("link", { name: "View tickets" }).click();
  await expect(page).toHaveURL(/\/tickets$/);
});
