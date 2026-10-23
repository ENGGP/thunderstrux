import { beforeEach, describe, expect, test, vi } from "vitest";
import CalendarPage from "@/app/(dashboard)/dashboard/calendar/page";
import { GET as calendarRoute } from "@/app/api/orgs/[orgSlug]/calendar/route";
import { calendarItems, clockChanges, formatTime, laneSegments, placeDay } from "@/components/calendar/layout";
import { prisma } from "@/lib/db";
import type { CalendarEvent } from "@/lib/events/calendar";
import { clearMockSession, selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createMembershipGrant, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/dashboard/calendar",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() })
}));

beforeEach(() => {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
});

const page = (params: Record<string, string> = {}) => CalendarPage({ searchParams: Promise.resolve(params) }).then(renderPage);
const read = (slug: string, query: string) => calendarRoute(new Request(`http://localhost/api/orgs/${slug}/calendar?${query}`), routeContext({ orgSlug: slug }));

// A Brisbane society (UTC+10) with events around October 2026's edges.
async function society() {
  const account = await createOrganisationAccount();
  const organisationId = account.organisation.id;
  const event = async (title: string, start: string, end: string, status: "draft" | "published" = "published") => {
    const created = await createEvent({ organisationId, title, status });
    return prisma.event.update({ where: { id: created.id }, data: { startTime: new Date(start), endTime: new Date(end), salesCloseAt: new Date(start) } });
  };
  const camp = await event("Engineering Camp", "2026-09-30T06:00:00Z", "2026-10-02T04:00:00Z");
  await event("Ends at midnight", "2026-09-30T10:00:00Z", "2026-09-30T14:00:00Z");
  await event("Starts at midnight", "2026-10-31T14:00:00Z", "2026-10-31T16:00:00Z");
  const lateNight = await event("Halloween Social", "2026-10-31T10:00:00Z", "2026-10-31T15:00:00Z");
  const draft = await event("CAD workshop", "2026-10-21T08:00:00Z", "2026-10-21T10:00:00Z", "draft");
  const holder = await createMember();
  const grant = await createMembershipGrant(organisationId, holder.id, holder.email, { startsAt: new Date("2026-07-01T14:00:00Z"), endsAt: new Date("2026-10-31T14:00:00Z") });
  const revoked = await createMembershipGrant(organisationId, holder.id, holder.email, { startsAt: new Date("2026-07-01T14:00:00Z"), endsAt: new Date("2026-10-20T14:00:00Z") });
  await prisma.membershipGrant.update({ where: { id: revoked.id }, data: { revokedAt: new Date(), revocationReason: "Left the society." } });
  const other = await createOrganisationAccount();
  const foreign = await createEvent({ organisationId: other.organisation.id, status: "published", title: "Another society's gala" });
  await prisma.event.update({ where: { id: foreign.id }, data: { startTime: new Date("2026-10-10T08:00:00Z"), endTime: new Date("2026-10-10T10:00:00Z") } });
  setMockSession({ userId: account.user.id, email: account.user.email, accountRole: "organisation" });
  const staff = async (role: "event_manager" | "check_in_staff") => {
    const member = await createMember();
    await createOrganisationStaff({ organisationId, userId: member.id, role });
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId });
  };
  return { ...account, other, camp, lateNight, draft, grant, staff };
}

describe("society calendar (T33)", () => {
  test("the API returns what overlaps the local days: drafts and membership ends for an owner, never another society's", async () => {
    const { organisation, camp, lateNight, draft, grant } = await society();
    const response = await read(organisation.slug, "from=2026-10-01&to=2026-10-31");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await parseJsonResponse(response);
    // An event ending at the range's first midnight, or starting at its last, is outside it.
    expect(body.events.map((event: { id: string }) => event.id)).toEqual([camp.id, draft.id, lateNight.id]);
    expect(body).toMatchObject({ from: "2026-10-01", to: "2026-10-31", timeZone: "Australia/Brisbane", truncated: false });
    expect(body.membershipEnds).toEqual([{ planId: grant.membershipProductId, name: expect.any(String), lastDay: "2026-10-31", members: 1 }]);
  });

  test("check-in staff get published events only; bad ranges, other societies and signed-out callers are refused", async () => {
    const { organisation, other, camp, lateNight, staff } = await society();
    await staff("check_in_staff");
    const body = await parseJsonResponse(await read(organisation.slug, "from=2026-10-01&to=2026-10-31"));
    expect(body.events.map((event: { id: string }) => event.id)).toEqual([camp.id, lateNight.id]);
    expect(body.membershipEnds).toEqual([]);

    expect((await read(organisation.slug, "from=2026-10-01&to=2027-01-02")).status).toBe(400);
    expect((await read(organisation.slug, "from=2026-10-01&to=2026-12-31")).status).toBe(200);
    expect((await read(organisation.slug, "from=2026-02-30&to=2026-03-01")).status).toBe(400);
    expect((await read(organisation.slug, "from=2026-10-31&to=2026-10-01")).status).toBe(400);
    expect((await read(other.organisation.slug, "from=2026-10-01&to=2026-10-31")).status).toBe(404);
    clearMockSession();
    expect((await read(organisation.slug, "from=2026-10-01&to=2026-10-31")).status).toBe(401);
  });

  test("days follow the society's zone: clock changes, the repeated hour, spans and side-by-side events", () => {
    const sydney = "Australia/Sydney";
    const days = (first: string, count: number) => Array.from({ length: count }, (_, index) => new Date(Date.parse(first) + index * 86_400_000).toISOString().slice(0, 10));
    expect([...clockChanges(days("2026-09-28", 7), sydney)]).toEqual([["2026-10-04", "Clocks go forward at 2 am"]]);
    expect([...clockChanges(days("2027-03-29", 7), sydney)]).toEqual([["2027-04-04", "Clocks go back at 3 am"]]);
    expect(clockChanges(days("2026-09-28", 7), "Australia/Brisbane").size).toBe(0);
    // 2:30 am happens twice when the clocks go back; each says which.
    expect(formatTime(new Date("2027-04-03T15:30:00Z"), sydney)).toBe("2:30 am AEDT");
    expect(formatTime(new Date("2027-04-03T16:30:00Z"), sydney)).toBe("2:30 am AEST");
    expect(formatTime(new Date("2026-10-04T07:00:00Z"), sydney)).toBe("6:00 pm");
    // 11:30 pm UTC on Saturday is Sunday morning in Sydney.
    const event = (id: string, start: string, end: string): CalendarEvent => ({ id, title: id, location: "Room", status: "published", startTime: new Date(start), endTime: new Date(end) });
    const items = calendarItems([
      event("camp", "2026-10-30T05:00:00Z", "2026-11-02T03:00:00Z"),
      event("late", "2026-10-24T23:30:00Z", "2026-10-25T03:00:00Z"),
      event("night", "2026-10-24T11:00:00Z", "2026-10-24T15:00:00Z")
    ], [], sydney);
    expect(items.map((item) => [item.key, item.firstDay, item.lastDay])).toEqual([
      ["camp", "2026-10-30", "2026-11-02"], ["late", "2026-10-25", "2026-10-25"], ["night", "2026-10-24", "2026-10-24"]
    ]);
    // A day or more that ends in the small hours stays on the day it started:
    // Wed 1:00 am to Thu 3:00 am Brisbane fills Wednesday's grid from 1 am,
    // never Thursday. Ending later in the morning, it reaches the next day.
    const brisbane = "Australia/Brisbane";
    const overnight = calendarItems([
      event("workshop", "2026-12-08T15:00:00Z", "2026-12-09T17:00:00Z"),
      event("six", "2026-12-08T15:00:00Z", "2026-12-09T20:00:00Z"),
      event("hackathon", "2026-12-11T23:00:00Z", "2026-12-13T07:00:00Z")
    ], [], brisbane);
    expect(overnight.map((item) => [item.key, item.firstDay, item.lastDay, item.multiDay])).toEqual([
      ["workshop", "2026-12-09", "2026-12-09", false], ["six", "2026-12-09", "2026-12-09", false], ["hackathon", "2026-12-12", "2026-12-13", true]
    ]);
    expect(laneSegments(days("2026-12-07", 7), overnight)[0]).toMatchObject({ start: 2, end: 2, before: false, after: false });
    expect(placeDay([overnight[0].kind === "event" ? overnight[0].event : (null as never)], brisbane)[0]).toMatchObject({ top: 60, bottom: 24 * 60, clipped: true });
    expect(calendarItems([event("late-morning", "2026-12-08T15:00:00Z", "2026-12-09T21:00:00Z")], [], brisbane)[0]).toMatchObject({ firstDay: "2026-12-09", lastDay: "2026-12-10", multiDay: true });
    // The camp splits across two weeks and is flagged on each side.
    const [first] = laneSegments(days("2026-10-26", 7), items);
    expect(first).toMatchObject({ start: 4, end: 6, before: false, after: true, lane: 0 });
    expect(laneSegments(days("2026-11-02", 7), items)[0]).toMatchObject({ start: 0, end: 0, before: true, after: false });
    // Overlapping events share the day side by side; a later one takes the free column.
    const placed = placeDay([
      event("a", "2026-10-23T07:00:00Z", "2026-10-23T10:00:00Z"),
      event("b", "2026-10-23T09:00:00Z", "2026-10-23T12:00:00Z"),
      event("c", "2026-10-23T11:00:00Z", "2026-10-23T12:00:00Z")
    ], sydney);
    expect(placed.map((entry) => [entry.event.id, entry.column, entry.columns])).toEqual([["a", 0, 2], ["b", 1, 2], ["c", 0, 2]]);
  });

  test("the page shows a manager drafts and New event, and check-in staff published events that open Attendees", async () => {
    const { draft, lateNight, staff } = await society();
    const month = await page({ date: "2026-10-15" });
    for (const text of ["Calendar", "October 2026", "Brisbane time (AEST)", "Engineering Camp", "Wed 4:00 pm to Fri 2:00 pm", "Ongoing", "CAD workshop", "Draft", "membership ends", "Membership ends", "Halloween Social", "/dashboard/events/new"]) expect(month).toContain(text);
    expect(month).not.toContain("Another society");
    expect(month).toContain(`/dashboard/events/${draft.id}`);
    expect(await page({ view: "week", date: "2026-10-31" })).toContain("8:00 pm to 1:00 am Sun");
    expect(await page({ view: "agenda", date: "2026-10-01" })).toContain("until 1:00 am Sun");
    expect(await page({ date: "2026-13-45" })).toContain("wasn&#x27;t a real day");

    await staff("check_in_staff");
    const html = await page({ date: "2026-10-15" });
    expect(html).toContain(`/dashboard/events/${lateNight.id}/tickets`);
    for (const hidden of ["CAD workshop", "membership ends", "/dashboard/events/new"]) expect(html).not.toContain(hidden);
  });
});
