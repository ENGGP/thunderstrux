import { beforeEach, describe, expect, test, vi } from "vitest";
import DashboardPage from "@/app/(dashboard)/dashboard/page";
import { createCommerceOrder } from "@/lib/commerce/orders";
import { prisma } from "@/lib/db";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createMembershipGrant, createOrder, createOrganisationAccount, createOrganisationStaff, joinOrganisation, unique } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

beforeEach(() => {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
});

const page = async () => renderPage(await DashboardPage());
const day = 86_400_000;
const at = (offset: number) => new Date(Date.now() + offset);

async function eventAt(organisationId: string, title: string, start: Date, status: "draft" | "published" = "published") {
  const event = await createEvent({ organisationId, title, status });
  return prisma.event.update({ where: { id: event.id }, data: { startTime: start, endTime: new Date(start.getTime() + 2 * 3600_000), salesCloseAt: start }, include: { ticketTypes: true } });
}

// A society with something in every family needing attention.
async function busySociety() {
  const account = await createOrganisationAccount({ stripeReady: true });
  const organisationId = account.organisation.id;
  await prisma.organisation.update({ where: { id: organisationId }, data: { onboardingCompletedAt: new Date() } });
  const mixer = await eventAt(organisationId, "Engineering Mixer", at(day));
  await eventAt(organisationId, "CAD workshop", at(3 * day), "draft");
  const buyer = await createMember();
  const review = await createOrder({ organisationId, eventId: mixer.id, ticketTypeId: mixer.ticketTypes[0].id, userId: buyer.id, status: "paid", paidAt: new Date() });
  await prisma.order.update({ where: { id: review.id }, data: { requiresCompensationReview: true } });
  const product = await prisma.merchandiseProduct.create({ data: { organisationId, name: "Hoodie", status: "published", publishedAt: new Date(), firstPublishedAt: new Date() } });
  const variant = await prisma.merchandiseVariant.create({ data: { productId: product.id, organisationId, sku: unique("SKU").toUpperCase(), priceAmount: 2500, remaining: 9 } });
  for (const pickupStatus of ["pending", "pending", "ready"] as const) {
    const order = await prisma.$transaction((tx) => createCommerceOrder(tx, {
      organisationId, kind: "merchandise", buyer: { userId: buyer.id }, buyerEmail: buyer.email, paymentKind: "stripe", feeAmount: 250, source: "checkout",
      lines: [{ quantity: 1, unitAmount: 2500, name: "Hoodie", merchandiseVariantId: variant.id }]
    }));
    await prisma.commerceOrder.update({ where: { id: order.id }, data: { status: "paid", paidAt: new Date(), fulfilledAt: new Date(), stripeSessionId: unique("cs"), pickupStatus } });
  }
  await createMembershipGrant(organisationId, buyer.id, buyer.email, { startsAt: at(-100 * day), endsAt: at(3 * day) });
  await prisma.notificationOutbox.create({ data: { eventKey: unique("failed"), recipient: "a@example.com", template: "business_notice", organisationId, privacy: "business", status: "failed", encryptedPayload: "x" } });
  setMockSession({ userId: account.user.id, email: account.user.email, accountRole: "organisation" });
  const staff = async (role: "event_manager" | "check_in_staff") => {
    const member = await createMember();
    await createOrganisationStaff({ organisationId, userId: member.id, role });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId });
  };
  return { ...account, mixer, staff };
}

describe("dashboards (T34)", () => {
  test("a new society's owner gets the setup steps and honest zero tiles", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const html = await page();
    for (const text of [`Get ${organisation.name} ready`, "Set up payments", "Finish your society profile", "Schedule your first event", "Nothing scheduled yet", "Sales this month", "$0.00", "Members now"]) expect(html).toContain(text);
    expect(html).not.toContain("Needs your attention");
  });

  test("an owner sees a task for every family, money, members and recent orders across families", async () => {
    await busySociety();
    const html = await page();
    for (const text of [
      "Needs your attention", "1 payment in review", "2 merchandise orders to prepare", "1 more is ready and waiting to be collected",
      "1 membership end in the next 7 days", "Your next membership isn&#x27;t on sale yet.", "Plan the next membership",
      "1 email couldn&#x27;t be delivered", "CAD workshop is still a draft", "Sales this month", "Members now", "Recent orders", "Merch", "Ticket", "Open calendar"
    ]) expect(html).toContain(text);
  });

  test("recent orders and recent purchases leave out checkouts that didn't complete", async () => {
    const { user, organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await eventAt(organisation.id, "Quiz night", at(day));
    const buyer = await createMember();
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id, status: "expired" });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    expect(await page()).toContain("No orders yet.");
    setMockSession({ userId: buyer.id, email: buyer.email, accountRole: "member" });
    expect(await page()).not.toContain("Quiz night");
  });

  test("an event manager gets event tasks and ticket counts without money, orders or members", async () => {
    const { staff } = await busySociety();
    await staff("event_manager");
    const html = await page();
    expect(html).toContain("CAD workshop is still a draft");
    expect(html).toContain("Tickets issued this month");
    for (const hidden of ["payment in review", "merchandise orders to prepare", "membership end", "couldn&#x27;t be delivered", "Sales this month", "Holding a membership today", "View all orders"]) expect(html).not.toContain(hidden);
    expect(html).not.toMatch(/\$\d/);
  });

  test("check-in staff land on today's door: published events today, no drafts or money", async () => {
    const { organisation, staff } = await busySociety();
    const today = await eventAt(organisation.id, "Movie night", at(60_000));
    // EVT-009: a cancelled event has no door, today or later in the week.
    for (const [title, start] of [["Rained out", at(60_000)], ["Called off", at(2 * day)]] as const) {
      const event = await eventAt(organisation.id, title, start);
      await prisma.event.update({ where: { id: event.id }, data: { cancelledAt: new Date() } });
    }
    await staff("check_in_staff");
    const html = await page();
    expect(html).toContain("Today at the door");
    expect(html).toContain("Movie night");
    for (const cancelled of ["Rained out", "Called off"]) expect(html).not.toContain(cancelled);
    expect(html).toContain(`/dashboard/events/${today.id}/tickets`);
    for (const hidden of ["CAD workshop", "Recent orders", "Sales this month", "New event"]) expect(html).not.toContain(hidden);
  });

  test("a member's next plans are their next valid ticket; a checkout still confirming is only a purchase", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    await joinOrganisation(member.id, organisation.id);
    const soon = await eventAt(organisation.id, "Halloween Social", at(2 * day));
    const later = await eventAt(organisation.id, "Robot Wars", at(9 * day));
    const pending = await eventAt(organisation.id, "Pending Gala", at(day));
    for (const event of [soon, later]) {
      const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: member.id, status: "paid", paidAt: new Date() });
      await prisma.ticket.create({ data: { orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id, issueSequence: 1 } });
    }
    await createOrder({ organisationId: organisation.id, eventId: pending.id, ticketTypeId: pending.ticketTypes[0].id, userId: member.id, status: "pending" });
    await createMembershipGrant(organisation.id, member.id, member.email, { startsAt: at(-day), endsAt: at(5 * day) });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const html = await page();
    expect(html.indexOf("Your next plans")).toBeLessThan(html.indexOf("Halloween Social"));
    for (const text of ["Also coming up", "Robot Wars", "Recent purchases", "Waiting for payment", "Membership active", "Memberships don&#x27;t renew automatically", "Societies you&#x27;ve joined", organisation.name]) expect(html).toContain(text);
    expect(html.indexOf("Pending Gala")).toBeGreaterThan(html.indexOf("Recent purchases"));

    const newcomer = await createMember();
    setMockSession({ userId: newcomer.id, email: newcomer.email, accountRole: "member" });
    const empty = await page();
    for (const text of ["Nothing booked yet", "Explore events", "No memberships", "You haven&#x27;t joined a society"]) expect(empty).toContain(text);
  });

  // UI-019: the readers leave out checkouts that didn't complete, so ten newer
  // ones never crowd out real purchases; five joined societies, then See all.
  test("recent purchases survive many newer checkouts that didn't complete, and joined societies stop at five", async () => {
    const member = await createMember();
    const { organisation } = await createOrganisationAccount();
    for (const [index, title] of ["Real one", "Real two", "Real three"].entries()) {
      const event = await eventAt(organisation.id, title, at((index + 2) * day));
      await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: member.id, status: "paid", paidAt: at(-day), createdAt: at(-day - index) });
    }
    const lapsed = await eventAt(organisation.id, "Lapsed checkout", at(5 * day));
    for (let index = 0; index < 10; index += 1) await createOrder({ organisationId: organisation.id, eventId: lapsed.id, ticketTypeId: lapsed.ticketTypes[0].id, userId: member.id, status: "expired" });
    for (let index = 0; index < 6; index += 1) await joinOrganisation(member.id, (await createOrganisationAccount()).organisation.id);
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const html = await page();
    for (const title of ["Real one", "Real two", "Real three", "See all 6"]) expect(html).toContain(title);
    expect(html).not.toContain("Lapsed checkout");
  });
});
