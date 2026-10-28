import { describe, expect, test, vi } from "vitest";
import HomePage from "@/app/page";
import ExploreEventsPage from "@/app/(public)/events/page";
import OrganisationDetailsPage from "@/app/(public)/societies/[orgSlug]/page";
import { prisma } from "@/lib/db";
import { getPublishedEvents, listingAvailability } from "@/lib/events/public-events";
import { listingPriceLabel } from "@/lib/format";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount, createReservation, unique } from "@/tests/helpers/test-data";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

const DAY = 86_400_000;

describe("event card availability (UI-007)", () => {
  test("cards show the prices on sale now, or why nothing can be bought", async () => {
    const ready = (await createOrganisationAccount({ stripeReady: true })).organisation;
    const notReady = (await createOrganisationAccount()).organisation;
    const member = await createMember();
    const published = (organisationId: string, ticketTypes: Parameters<typeof createEvent>[0]["ticketTypes"], extra: Partial<Parameters<typeof createEvent>[0]> = {}) =>
      createEvent({ organisationId, status: "published", ticketTypes, ...extra });

    const mixed = await published(ready.id, [
      { name: "Paid", price: 1500, quantity: 10 },
      { name: "Free", price: 0, quantity: 10 },
      { name: "Also paid", price: 1500, quantity: 10 }
    ]);
    const tiers = await published(ready.id, [
      { name: "Early", price: 1200, quantity: 10 },
      { name: "Standard", price: 2000, quantity: 10 }
    ]);
    // A hold on the cheaper type's last places takes its price off the card.
    const heldOut = await published(ready.id, [
      { name: "Held", price: 800, quantity: 2 },
      { name: "Open", price: 1800, quantity: 5 }
    ]);
    const held = heldOut.ticketTypes.find((ticketType) => ticketType.name === "Held")!;
    const order = await createOrder({ organisationId: ready.id, eventId: heldOut.id, ticketTypeId: held.id, userId: member.id, quantity: 2, unitPrice: 800 });
    await createReservation({ orderId: order.id, organisationId: ready.id, eventId: heldOut.id, ticketTypeId: held.id, userId: member.id, quantity: 2, expiresAt: new Date(Date.now() + 30 * 60_000) });
    const soldOut = await published(ready.id, [{ name: "Gone", price: 1200, quantity: 0 }]);
    const closed = await published(ready.id, [{ name: "General", price: 1200, quantity: 10 }], { saleState: "closed" });
    // Without payments, paid types can't be bought but free ones still can.
    const paidOnly = await published(notReady.id, [{ name: "Paid", price: 1200, quantity: 10 }]);
    const freeWithPaid = await published(notReady.id, [
      { name: "Paid", price: 1200, quantity: 10 },
      { name: "Free", price: 0, quantity: 10 }
    ]);
    const noTypes = await published(ready.id, []);

    const availability = await listingAvailability([mixed, tiers, heldOut, soldOut, closed, paidOnly, freeWithPaid, noTypes].map((event) => event.id));
    expect(availability.get(mixed.id)).toEqual({ state: "on_sale", prices: [0, 1500] });
    expect(availability.get(tiers.id)).toEqual({ state: "on_sale", prices: [1200, 2000] });
    expect(availability.get(heldOut.id)).toEqual({ state: "on_sale", prices: [1800] });
    expect(availability.get(soldOut.id)).toEqual({ state: "sold_out" });
    expect(availability.get(closed.id)).toEqual({ state: "sales_closed" });
    expect(availability.get(paidOnly.id)).toEqual({ state: "paid_unavailable" });
    expect(availability.get(freeWithPaid.id)).toEqual({ state: "on_sale", prices: [0] });
    expect(availability.get(noTypes.id)).toBeNull();

    // The list query carries the same answer; it is public, so no Stripe fields.
    const listed = (await getPublishedEvents({ limit: 100, societySlug: ready.slug })).events;
    expect(listed.find((event) => event.id === tiers.id)?.availability).toEqual({ state: "on_sale", prices: [1200, 2000] });
    expect(JSON.stringify(listed)).not.toContain("acct_");

    expect([[0], [1200], [1200, 2000], [0, 1500], [0, 1500, 2000]].map(listingPriceLabel)).toEqual([
      "Free",
      "$12.00",
      "From $12.00",
      "Free or $15.00",
      "Free or from $15.00"
    ]);
  });

  test("Explore cards show the price, and the home page leads with events", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: organisation.id, status: "published", title: unique("Card Price"), ticketTypes: [{ name: "General", price: 1500, quantity: 10 }] });

    const explore = await renderPage(await ExploreEventsPage({ searchParams: Promise.resolve({ q: event.title }) }));
    expect(explore).toContain(event.title);
    expect(explore).toContain("$15.00");

    const home = await renderPage(await HomePage());
    expect(home).toContain("See what&#x27;s on");
    expect(home).toContain("How Thunderstrux works");
  });
});

describe("society overview previews (PUB-05)", () => {
  // UI-019: six events, then a link to Explore filtered to the society.
  test("the overview lists the next six events and links to all of them on Explore", async () => {
    const { organisation } = await createOrganisationAccount();
    const render = async () => renderPage(await OrganisationDetailsPage({ params: Promise.resolve({ orgSlug: organisation.slug }) }));
    const titles = [];
    for (let index = 0; index < 7; index += 1) {
      const event = await createEvent({ organisationId: organisation.id, status: "published", title: unique(`Night ${index}`) });
      await prisma.event.update({ where: { id: event.id }, data: { startTime: new Date(Date.now() + (index + 1) * DAY), endTime: new Date(Date.now() + (index + 1) * DAY + 3600000) } });
      titles.push(event.title);
    }
    const html = await render();
    for (const title of titles.slice(0, 6)) expect(html).toContain(title);
    expect(html).not.toContain(titles[6]);
    expect(html).toContain("See all 7 events");
    expect(html).toContain(`/events?society=${organisation.slug}`);
  });

  test("the overview previews the next membership and up to four products, and leaves each out when there is none", async () => {
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const render = async () => renderPage(await OrganisationDetailsPage({ params: Promise.resolve({ orgSlug: organisation.slug }) }));

    const empty = await render();
    expect(empty).not.toContain('id="membership"');
    expect(empty).not.toContain('id="merchandise"');

    const now = Date.now();
    const plan = await prisma.membershipProduct.create({
      data: { organisationId: organisation.id, name: unique("Semester pass"), priceAmount: 2500, startsAt: new Date(now - DAY), endsAt: new Date(now + 90 * DAY), entitlements: [], status: "published", publishedAt: new Date() }
    });
    await prisma.membershipProduct.create({
      data: { organisationId: organisation.id, name: unique("Draft plan"), priceAmount: 1000, startsAt: new Date(now), endsAt: new Date(now + 90 * DAY), entitlements: [], status: "draft" }
    });
    const names = [];
    for (let index = 0; index < 5; index += 1) {
      const name = unique(`Tee ${index}`);
      names.push(name);
      const product = await prisma.merchandiseProduct.create({
        data: { organisationId: organisation.id, name, status: "published", publishedAt: new Date(now + index * 1000), firstPublishedAt: new Date(now) }
      });
      await prisma.merchandiseVariant.create({
        data: { productId: product.id, organisationId: organisation.id, colour: "", size: "M", sku: unique("SKU").toUpperCase(), priceAmount: 3000, remaining: 5, position: 0 }
      });
    }

    const html = await render();
    expect(html).toContain('id="membership"');
    expect(html).toContain(plan.name);
    expect(html).toContain("$25.00");
    expect(html).toContain("No automatic renewal.");
    expect(html).not.toContain("Draft plan");
    // Newest four of five, with a link to the rest.
    expect(html).toContain('id="merchandise"');
    for (const name of names.slice(1)) expect(html).toContain(name);
    expect(html).not.toContain(names[0]);
    expect(html).toContain("See all merchandise");
  });
});
