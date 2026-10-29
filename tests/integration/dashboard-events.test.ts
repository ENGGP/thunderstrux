import { describe, expect, test, vi } from "vitest";
import EventsPage from "@/app/(dashboard)/dashboard/events/page";
import { prisma } from "@/lib/db";
import {
  EventLifecycleNotFoundError,
  getDashboardEvent,
  listDashboardEvents
} from "@/lib/events/event-lifecycle";
import { selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createOrganisationStaff
} from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/events",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

async function societyWithEvents() {
  const { organisation } = await createOrganisationAccount();
  const buyer = await createMember();
  const live = await createEvent({ organisationId: organisation.id, title: "Zebra Mixer", status: "published" });
  const draft = await createEvent({ organisationId: organisation.id, title: "Robotics Workshop", ticketTypes: [] });
  const past = await createEvent({ organisationId: organisation.id, title: "Zebra Reunion", status: "published" });
  await prisma.event.update({
    where: { id: past.id },
    data: { startTime: new Date(Date.now() - 2 * 86400000), endTime: new Date(Date.now() - 86400000) }
  });
  const order = { organisationId: organisation.id, eventId: live.id, ticketTypeId: live.ticketTypes[0].id, userId: buyer.id };
  const ticket = (orderId: string, issueSequence: number, validity: "active" | "void" = "active") =>
    prisma.ticket.create({ data: { orderId, eventId: live.id, ticketTypeId: live.ticketTypes[0].id, organisationId: organisation.id, issueSequence, validity } });
  const paid = await createOrder({ ...order, status: "paid", paidAt: new Date(), quantity: 2 });
  await ticket(paid.id, 1);
  await ticket(paid.id, 2);
  // Refunded: still a paid order, but its ticket no longer admits anyone (DEBT-002).
  const refunded = await createOrder({ ...order, status: "paid", paidAt: new Date(), quantity: 1 });
  await ticket(refunded.id, 1, "void");
  await createOrder({ ...order, status: "pending", quantity: 3 });
  const foreign = await createOrganisationAccount();
  await createEvent({ organisationId: foreign.organisation.id, title: "Zebra Elsewhere", status: "published" });

  return { organisation, live, draft, past };
}

describe("dashboard events read", () => {
  // UI-019: a view pages 25 at a time either way; Past and All run newest first.
  test("views page 25 at a time, back and forth, and an unreadable cursor starts again", async () => {
    const { organisation } = await createOrganisationAccount();
    const start = Date.now() - 400 * 86400000;
    const ids: string[] = [];
    for (let index = 0; index < 26; index += 1) {
      const event = await createEvent({ organisationId: organisation.id, title: `Past ${index}`, status: "published" });
      await prisma.event.update({ where: { id: event.id }, data: { startTime: new Date(start + index * 86400000), endTime: new Date(start + index * 86400000 + 3600000) } });
      ids.push(event.id);
    }
    const newest = [...ids].reverse();
    const read = (options: { view?: "past" | "all"; cursor?: string; direction?: "next" | "prev" } = {}) =>
      listDashboardEvents(organisation.id, { view: "past", publishedOnly: false, includeSales: false, ...options });
    const first = await read();
    expect(first.events.map((event) => event.id)).toEqual(newest.slice(0, 25));
    expect(first.previousCursor).toBeNull();
    const second = await read({ cursor: first.nextCursor! });
    expect(second.events.map((event) => event.id)).toEqual(newest.slice(25));
    expect(second.nextCursor).toBeNull();
    expect((await read({ cursor: second.previousCursor!, direction: "prev" })).events.map((event) => event.id)).toEqual(newest.slice(0, 25));
    expect((await read({ view: "all" })).events[0].id).toBe(newest[0]);
    const restarted = await read({ cursor: "not-a-cursor", direction: "prev" });
    expect(restarted.restarted).toBe(true);
    expect(restarted.events.map((event) => event.id)).toEqual(newest.slice(0, 25));
  }, 90_000);

  test("views, counts, search and sales stay inside the society", async () => {
    const { organisation, live, draft, past } = await societyWithEvents();
    const read = (view: "upcoming" | "past", query?: string) =>
      listDashboardEvents(organisation.id, { view, query, publishedOnly: false, includeSales: true });

    const upcoming = await read("upcoming");
    expect(upcoming.events.map((event) => event.id).sort()).toEqual([live.id, draft.id].sort());
    expect(upcoming.counts).toEqual({ upcoming: 2, drafts: 1, past: 1, all: 3 });
    // Sold counts tickets that still admit someone: not refunded ones or unpaid holds.
    expect(upcoming.events.find((event) => event.id === live.id)).toMatchObject({ sold: 2, remaining: 10 });
    expect((await read("past")).events.map((event) => event.id)).toEqual([past.id]);

    const search = await read("upcoming", "zebra");
    expect(search.events.map((event) => event.id)).toEqual([live.id]);
    expect(search.counts).toEqual({ upcoming: 1, drafts: 0, past: 1, all: 2 });
  });

  test("check-in staff get published events and no sales read", async () => {
    const { organisation, live } = await societyWithEvents();
    const groupBy = vi.spyOn(prisma.ticket, "groupBy");

    const result = await listDashboardEvents(organisation.id, {
      view: "upcoming",
      publishedOnly: true,
      includeSales: false
    });

    expect(result.events.map((event) => event.id)).toEqual([live.id]);
    expect(result.events[0].sold).toBeNull();
    expect(result.counts.drafts).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  test("blocked actions carry their reason and foreign events are not found", async () => {
    const { organisation, live, draft } = await societyWithEvents();
    const other = await createOrganisationAccount();

    expect(await getDashboardEvent(organisation.id, draft.id)).toMatchObject({
      publishBlocker: "Add a ticket type before publishing.",
      unpublishBlocker: null,
      deleteBlocker: null
    });
    expect(await getDashboardEvent(organisation.id, live.id)).toMatchObject({
      publishBlocker: null,
      unpublishBlocker: "This event has orders, so it stays published.",
      deleteBlocker: "Events with orders or tickets cannot be deleted."
    });
    await expect(getDashboardEvent(other.organisation.id, live.id)).rejects.toBeInstanceOf(
      EventLifecycleNotFoundError
    );
  });

  test("the page shows sales and actions to managers but not to check-in staff", async () => {
    const { organisation, live } = await societyWithEvents();
    const staff = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: staff.id, role: "owner" });
    setMockSession({ userId: staff.id, email: staff.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: organisation.id });
    const render = async (view?: string) =>
      renderPage(await EventsPage({ searchParams: Promise.resolve({ view }) }));

    const managed = await render();
    expect(managed).toContain("2 sold · 10 left");
    expect(managed).toContain("Drafts");
    expect(managed).toContain(`More actions for ${live.title}`);
    expect(managed).toContain(`href="/dashboard/events/${live.id}"`);

    await prisma.organisationStaff.updateMany({
      where: { userId: staff.id },
      data: { role: "check_in_staff" }
    });
    const checkIn = await render("drafts");
    expect(checkIn).not.toContain("Drafts");
    expect(checkIn).not.toContain("sold");
    expect(checkIn).not.toContain("More actions");
    expect(checkIn).toContain(`href="/dashboard/events/${live.id}/tickets"`);
  });
});
