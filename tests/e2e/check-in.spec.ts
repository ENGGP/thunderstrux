import { test, expect, prisma, login, selectStaffContext, createMember } from "./fixtures";
import { createOrder } from "@/tests/helpers/test-data";

// A refusal that saved nothing (lost access, signed out, rate limited) says so on the card and leaves the ticket as it was.
test("a check-in the server refuses says why on the card and admits no one", async ({ page, data }) => {
  const order = await createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId: data.member.id, status: "paid", paidAt: new Date(), quantity: 1, unitPrice: 1500 });
  const ticket = await prisma.ticket.create({ data: { issueSequence: 1, orderId: order.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id } });
  await login(page, data.owner.email, `/dashboard/events/${data.event.id}/tickets`);
  await page.route("**/api/tickets/*/check-in", (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: { code: "FORBIDDEN", message: "Forbidden", details: [] } }) }));
  await page.getByRole("button", { name: /^Check in / }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /^Check in / }) });
  await expect(card.getByRole("alert")).toContainText("can't check people in");
  expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).checkedInAt).toBeNull();
});

test("check-in staff find a ticket on a phone, admit it once, see why others can't come in, and recover from a lost answer", async ({ page, data }) => {
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "check_in_staff" } });
  const buyer = await prisma.user.update({ where: { id: data.member.id }, data: { firstName: "Sam", lastName: "Lee" } });
  const others = await createMember();
  await prisma.user.update({ where: { id: others.id }, data: { firstName: "Samira", lastName: "Haddad" } });
  const sale = (userId: string, quantity: number) => createOrder({ organisationId: data.organisation.id, eventId: data.event.id, ticketTypeId: data.ticket.id, userId, status: "paid", paidAt: new Date(), quantity, unitPrice: 1500 });
  const sams = await sale(buyer.id, 2);
  const samira = await sale(others.id, 1);
  await prisma.ticket.createMany({ data: [
    ...[1, 2].map((issueSequence) => ({ issueSequence, orderId: sams.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id })),
    { issueSequence: 1, orderId: samira.id, eventId: data.event.id, ticketTypeId: data.ticket.id, organisationId: data.organisation.id, validity: "void" as const, validityReason: "refunded", validityChangedAt: new Date() }
  ] });
  const [first, second] = await prisma.ticket.findMany({ where: { orderId: sams.id }, orderBy: { issueSequence: "asc" } });

  await login(page, data.manager.email);
  await selectStaffContext(page, data.organisation.id);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/dashboard/events/${data.event.id}/tickets`);
  await expect(page.getByText("0 of 2 checked in")).toBeVisible();
  await page.getByLabel("Find a ticket").fill("sam");
  const results = page.getByRole("list", { name: "Matching tickets" });
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await expect(results.getByRole("listitem", { name: "Samira Haddad, Don't admit" })).toContainText("Refunded on");
  await expect(results.getByRole("listitem", { name: "Samira Haddad, Don't admit" }).getByRole("button")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/check-in-search-390.png", fullPage: true });

  // Admit the first ticket by its reference.
  await page.getByLabel("Find a ticket").fill(first.id.slice(-6).toUpperCase());
  await expect(results.getByRole("listitem")).toHaveCount(1);
  await results.getByRole("button", { name: /^Check in/ }).click();
  await expect(results.getByRole("listitem", { name: "Sam Lee, Checked in" })).toContainText("Checked in just now");
  await expect(page.getByText("1 of 2 checked in")).toBeVisible();

  // The check-in saves but its answer never arrives: the card says it doesn't know, then reloads the truth.
  await page.route("**/api/tickets/*/check-in", async (route) => {
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByLabel("Find a ticket").fill(second.id.slice(-6).toUpperCase());
  await results.getByRole("button", { name: /^Check in/ }).click();
  await expect(results.getByRole("listitem", { name: "Sam Lee, Status unknown" })).toBeVisible();
  await page.screenshot({ path: "test-results/check-in-unknown-390.png", fullPage: true });
  await page.unroute("**/api/tickets/*/check-in");
  await results.getByRole("button", { name: "Reload ticket" }).click();
  await expect(results.getByRole("listitem", { name: "Sam Lee, Checked in" })).toBeVisible();
  expect(await prisma.auditLog.count({ where: { targetId: second.id, action: "ticket.checked_in" } })).toBe(1);

  // A disputed ticket arriving at the door is held for review.
  await prisma.ticket.update({ where: { id: first.id }, data: { validity: "refund_review", validityReason: "disputed", checkedInAt: null } });
  await page.getByLabel("Find a ticket").fill(first.id.slice(-6).toUpperCase());
  await expect(results.getByRole("listitem", { name: "Sam Lee, Under review" })).toContainText("Ask an owner or finance manager");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByLabel("Find a ticket").fill("sam");
  await expect(results.getByRole("listitem")).toHaveCount(3);
  await page.screenshot({ path: "test-results/check-in-search-1280.png", fullPage: true });
});
