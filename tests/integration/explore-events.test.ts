import { describe, expect, test } from "vitest";
import HomePage from "@/app/page";
import ExploreEventsPage from "@/app/(public)/events/page";
import { prisma } from "@/lib/db";
import { parseExploreFilters } from "@/lib/events/explore-filters";
import { getPublishedEvents } from "@/lib/events/public-events";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createOrganisationAccount, unique } from "@/tests/helpers/test-data";

const HOUR = 60 * 60 * 1000;

async function eventAt(organisationId: string, title: string, startOffsetHours: number, extra: Parameters<typeof createEvent>[0] = { organisationId }) {
  const event = await createEvent({ ...extra, organisationId, title, status: extra.status ?? "published" });
  const startTime = new Date(Date.now() + startOffsetHours * HOUR);
  return prisma.event.update({ where: { id: event.id }, data: { startTime, endTime: new Date(startTime.getTime() + 2 * HOUR), salesCloseAt: startTime } });
}

const explore = (params: Record<string, string>) => ExploreEventsPage({ searchParams: Promise.resolve(params) });

describe("explore events filters", () => {
  // Wednesday 21 Oct 2026, noon in Brisbane (UTC+10, no daylight saving).
  const wednesday = new Date("2026-10-21T02:00:00Z");

  test("presets end at the next Monday and the next month in Brisbane time", () => {
    expect(parseExploreFilters({ when: "week" }, wednesday).range).toEqual({ startBefore: new Date("2026-10-25T14:00:00Z") });
    // On a Sunday the week still ends that night.
    expect(parseExploreFilters({ when: "week" }, new Date("2026-10-25T00:00:00Z")).range).toEqual({ startBefore: new Date("2026-10-25T14:00:00Z") });
    expect(parseExploreFilters({ when: "month" }, wednesday).range).toEqual({ startBefore: new Date("2026-10-31T14:00:00Z") });
    expect(parseExploreFilters({}, wednesday)).toMatchObject({ filters: { when: "upcoming" }, range: {}, errors: {} });
  });

  test("custom dates cover whole days and refuse bad ranges", () => {
    expect(parseExploreFilters({ when: "custom", from: "2026-11-01", to: "2026-11-30" }, wednesday).range).toEqual({
      startFrom: new Date("2026-10-31T14:00:00Z"),
      startBefore: new Date("2026-11-30T14:00:00Z")
    });
    expect(parseExploreFilters({ when: "custom", from: "2026-01-01", to: "2027-01-01" }, wednesday).errors).toEqual({});
    expect(parseExploreFilters({ when: "custom", from: "2026-01-01", to: "2027-01-02" }, wednesday).errors).toEqual({ to: "Choose a range of 366 days or less." });
    expect(parseExploreFilters({ when: "custom", from: "2026-11-02", to: "2026-11-01" }, wednesday).errors).toEqual({ to: "The end date must be on or after the start date." });
    expect(parseExploreFilters({ when: "custom", from: "2026-02-30" }, wednesday).errors).toEqual({ from: "Enter a real date.", to: "Choose an end date." });
    expect(parseExploreFilters({ when: "someday", q: "x".repeat(101) }, wednesday).errors).toEqual({
      when: "Choose when from the list.",
      q: "Search for up to 100 characters."
    });
  });
});

describe("explore events listing", () => {
  test("lists only public, published events that have not ended, with title, society and date filters", async () => {
    const { organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const tag = unique("Gala");
    const ended = await eventAt(organisation.id, `${tag} ended`, -5);
    const running = await eventAt(organisation.id, `${tag} running`, -1);
    const soon = await eventAt(organisation.id, `${tag} soon`, 24);
    const later = await eventAt(organisation.id, `${tag} later`, 24 * 60);
    await eventAt(organisation.id, `${tag} draft`, 24, { organisationId: organisation.id, status: "draft" });
    await eventAt(organisation.id, `${tag} unlisted`, 24, { organisationId: organisation.id, visibility: "unlisted" });
    await eventAt(organisation.id, `${tag} members`, 24, { organisationId: organisation.id, visibility: "members_only" });
    const elsewhere = await eventAt(other.organisation.id, `${tag} elsewhere`, 24);

    const titles = async (input: Parameters<typeof getPublishedEvents>[0]) =>
      (await getPublishedEvents({ limit: 50, title: tag.toLowerCase(), ...input })).events.map((event) => event.title);

    // Soonest first; the running event stays listed until it ends.
    expect(await titles({})).toEqual([running.title, soon.title, elsewhere.title, later.title]);
    expect(await titles({})).not.toContain(ended.title);
    expect(await titles({ societySlug: other.organisation.slug })).toEqual([elsewhere.title]);
    expect(await titles({ societySlug: organisation.slug, startFrom: new Date(Date.now() + 2 * HOUR), startBefore: new Date(Date.now() + 48 * HOUR) })).toEqual([soon.title]);
  });

  test("the page shows field errors instead of a list, falls back from a bad page link, and tells empty from no matches", async () => {
    const { organisation } = await createOrganisationAccount();
    const event = await eventAt(organisation.id, unique("Explore Night"), 24);

    const badRange = await renderPage(await explore({ when: "custom", from: "2026-01-01", to: "2027-06-01" }));
    expect(badRange).toContain("Choose a range of 366 days or less.");
    expect(badRange).toContain("Fix the highlighted filter to see events.");
    expect(badRange).not.toContain(event.title);

    expect(await renderPage(await explore({ society: "no-such-society" }))).toContain("Choose a society from the list.");

    const badCursor = await renderPage(await explore({ q: event.title, cursor: "bad-cursor" }));
    expect(badCursor).toContain("That page link has expired, so this is the first page.");
    expect(badCursor).toContain(event.title);

    const filtered = await renderPage(await explore({ q: `${event.title} nothing like it` }));
    expect(filtered).toContain("No events match these filters");
  });

  test("the home page keeps a short upcoming list and links to Explore", async () => {
    const { organisation } = await createOrganisationAccount();
    const past = await eventAt(organisation.id, unique("Home Past"), -5);

    const html = await renderPage(await HomePage());
    expect(html).toContain('href="/events"');
    expect(html).not.toContain(past.title);
  });
});
