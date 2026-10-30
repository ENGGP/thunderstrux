import { createElement } from "react";
import { renderPage } from "@/tests/helpers/render";
import { describe, expect, test, vi } from "vitest";
import { PublicTicketPurchase } from "@/components/events/public-ticket-purchase";
import { prisma } from "@/lib/db";
import { encodeTimestampCursor } from "@/lib/pagination/cursor";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation
} from "@/tests/helpers/test-data";
import { parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { GET as getPublicEvents } from "@/app/api/public/events/route";
import { GET as getPublicEvent } from "@/app/api/public/events/[eventId]/route";
import OrganisationDetailsPage from "@/app/(public)/societies/[orgSlug]/page";

vi.mock("next-auth/react", () => ({
  useSession: () => ({ status: "unauthenticated" })
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn()
  })
}));

describe("public-safe pages and APIs", () => {
  test("public events APIs return published events only", async () => {
    const { organisation } = await createOrganisationAccount();
    const published = await createEvent({
      organisationId: organisation.id,
      title: "Published Public Event",
      status: "published"
    });
    const draft = await createEvent({
      organisationId: organisation.id,
      title: "Draft Private Event",
      status: "draft"
    });

    const list = await getPublicEvents(
      new Request("http://localhost/api/public/events")
    );
    expect(list.status).toBe(200);
    const listBody = await parseJsonResponse(list);
    expect(listBody.events).toEqual([
      expect.objectContaining({
        id: published.id,
        title: published.title,
        organisation: expect.objectContaining({ name: organisation.name })
      })
    ]);
    expect(listBody.pageInfo).toMatchObject({
      limit: 25,
      hasPreviousPage: false
    });
    expect(JSON.stringify(listBody)).not.toContain(draft.title);

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${published.id}`),
      routeContext({ eventId: published.id })
    );
    expect(detail.status).toBe(200);
    const detailBody = await parseJsonResponse(detail);
    expect(detailBody.event).toMatchObject({
      id: published.id,
      title: published.title,
      organisation: {
        name: organisation.name,
        slug: organisation.slug
      },
      ticketTypes: [
        expect.objectContaining({
          id: published.ticketTypes[0].id,
          quantity: published.ticketTypes[0].quantity,
          availableQuantity: published.ticketTypes[0].quantity
        })
      ]
    });
    expect(detailBody.event).not.toHaveProperty("organisationId");

    const draftDetail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${draft.id}`),
      routeContext({ eventId: draft.id })
    );
    expect(draftDetail.status).toBe(404);
  });

  test("public availability keeps raw stock, counts only live holds against it and never goes below zero", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const later = new Date(Date.now() + 30 * 60 * 1000);
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published",
      ticketTypes: [
        { name: "Held", price: 1200, quantity: 10 },
        { name: "Lapsed holds", price: 1200, quantity: 10 },
        { name: "Over-held", price: 1200, quantity: 5 },
        { name: "Untouched", price: 2500, quantity: 8 }
      ]
    });
    const [held, lapsed, over] = event.ticketTypes;
    const holds = [
      [held, 3, { status: "active", expiresAt: later }],
      [lapsed, 2, { status: "active", expiresAt: new Date(Date.now() - 60 * 1000) }],
      [lapsed, 2, { status: "released", expiresAt: later, releasedAt: new Date(), releaseReason: "test_release" }],
      [lapsed, 2, { status: "confirmed", expiresAt: later, confirmedAt: new Date() }],
      [lapsed, 2, { status: "expired", expiresAt: later, releasedAt: new Date(), releaseReason: "expired" }],
      [over, 7, { status: "active", expiresAt: later }]
    ] as const;
    for (const [ticketType, quantity, hold] of holds) {
      const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, quantity, unitPrice: ticketType.price });
      await createReservation({ orderId: order.id, organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, quantity, ...hold });
    }

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${event.id}`),
      routeContext({ eventId: event.id })
    );
    expect(detail.status).toBe(200);
    const types: Array<{ name: string; quantity: number; availableQuantity: number }> = (await parseJsonResponse(detail)).event.ticketTypes;
    expect(types.map(({ name, quantity, availableQuantity }) => [name, quantity, availableQuantity])).toEqual([
      ["Held", 10, 7],
      ["Lapsed holds", 10, 10],
      ["Over-held", 5, 0],
      ["Untouched", 8, 8]
    ]);
  });

  test("public ticket purchase renders sold out when reservations consume raw inventory", async () => {
    const html = await renderPage(
      createElement(PublicTicketPurchase, {
        eventId: "event_public_sold_out",
        ticketTypes: [
          {
            id: "ticket_type_public_sold_out",
            name: "General",
            price: 1200,
            quantity: 5,
            availableQuantity: 0
          }
        ]
      })
    );

    // Availability comes from reservations, not raw stock: sold out, never "5 remaining".
    expect(html).toContain("Sold out");
    expect(html).not.toContain("5 remaining");
  });

  test("the ticket box offers one ticket at the member price and says where the rest go; a used member price says why it's gone", async () => {
    const ticketType = { id: "ticket_type_member", name: "General", price: 1000, memberPrice: 1000, standardPrice: 1500, memberPriced: true, quantity: 20, availableQuantity: 20 };
    // Back from checkout with four chosen before signing in: the box keeps the ticket at 1.
    const html = await renderPage(createElement(PublicTicketPurchase, { eventId: "event_member", memberPlan: "Full year", initial: { ticketTypeId: ticketType.id, quantity: 4 }, ticketTypes: [ticketType] }));
    expect(html).toContain("1 at the member price");
    expect(html).toContain("extra tickets are the standard price in a second checkout");
    expect(html).toMatch(/max="1"[^>]*value="1"|value="1"[^>]*max="1"/);

    const used = await renderPage(createElement(PublicTicketPurchase, { eventId: "event_member", memberPlan: "Full year", ticketTypes: [{ ...ticketType, price: 1500, standardPrice: undefined, memberPriced: undefined }] }));
    expect(used).toContain("Yours is used or in an open checkout");
    expect(used).toContain('href="/purchases"');
    expect(used).toContain("Up to 10 per order");
  });

  test("public events API paginates same-startTime rows with stable cursors", async () => {
    const { organisation } = await createOrganisationAccount();
    const first = await createEvent({
      organisationId: organisation.id,
      title: "Public Cursor Event 1",
      status: "published"
    });
    const second = await createEvent({
      organisationId: organisation.id,
      title: "Public Cursor Event 2",
      status: "published"
    });
    const third = await createEvent({
      organisationId: organisation.id,
      title: "Public Cursor Event 3",
      status: "published"
    });
    const sharedStartTime = new Date("2026-07-01T09:00:00.000Z");
    await prisma.event.updateMany({
      where: {
        id: { in: [first.id, second.id, third.id] }
      },
      data: {
        startTime: sharedStartTime
      }
    });

    const ordered = await prisma.event.findMany({
      where: {
        id: { in: [first.id, second.id, third.id] }
      },
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      select: {
        id: true,
        startTime: true
      }
    });

    const firstPageResponse = await getPublicEvents(
      new Request("http://localhost/api/public/events?limit=2")
    );
    expect(firstPageResponse.status).toBe(200);
    const firstPageBody = await parseJsonResponse(firstPageResponse);
    expect(firstPageBody.events.map((event: { id: string }) => event.id)).toEqual([
      ordered[0].id,
      ordered[1].id
    ]);
    expect(firstPageBody.pageInfo.hasNextPage).toBe(true);

    const secondPageResponse = await getPublicEvents(
      new Request(
        `http://localhost/api/public/events?limit=2&cursor=${encodeTimestampCursor(
          "startTime",
          ordered[1]
        )}&direction=next`
      )
    );
    expect(secondPageResponse.status).toBe(200);
    const secondPageBody = await parseJsonResponse(secondPageResponse);
    expect(secondPageBody.events.map((event: { id: string }) => event.id)).toEqual([
      ordered[2].id
    ]);
    expect(secondPageBody.pageInfo.hasPreviousPage).toBe(true);

    const previousPageResponse = await getPublicEvents(
      new Request(
        `http://localhost/api/public/events?limit=2&cursor=${encodeTimestampCursor(
          "startTime",
          ordered[2]
        )}&direction=prev`
      )
    );
    expect(previousPageResponse.status).toBe(200);
    const previousPageBody = await parseJsonResponse(previousPageResponse);
    expect(previousPageBody.events.map((event: { id: string }) => event.id)).toEqual([
      ordered[0].id,
      ordered[1].id
    ]);
  });

  test("public events API returns structured 400 for invalid pagination params", async () => {
    const invalidCursor = await getPublicEvents(
      new Request("http://localhost/api/public/events?cursor=bad-cursor")
    );
    expect(invalidCursor.status).toBe(400);
    expect(await parseJsonResponse(invalidCursor)).toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: expect.any(String)
      }
    });

    const invalidLimit = await getPublicEvents(
      new Request("http://localhost/api/public/events?limit=0")
    );
    expect(invalidLimit.status).toBe(400);
    expect(await parseJsonResponse(invalidLimit)).toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: expect.any(String)
      }
    });

    const invalidDirection = await getPublicEvents(
      new Request("http://localhost/api/public/events?direction=backwards")
    );
    expect(invalidDirection.status).toBe(400);
    expect(await parseJsonResponse(invalidDirection)).toMatchObject({
      error: {
        code: "BAD_REQUEST",
        message: expect.any(String)
      }
    });
  });

  test("organisation details page renders only public-safe data", async () => {
    const { organisation } = await createOrganisationAccount({
      stripeReady: true,
      name: "Public Safe Org",
      slug: "public-safe-org"
    });
    await createEvent({
      organisationId: organisation.id,
      title: "Upcoming Public Event",
      status: "published"
    });

    const element = await OrganisationDetailsPage({
      params: Promise.resolve({ orgSlug: organisation.slug })
    });
    const html = await renderPage(element);

    expect(html).toContain("Public Safe Org");
    expect(html).toContain("Upcoming Public Event");
    expect(html).not.toContain("stripeAccountId");
    expect(html).not.toContain("acct_");
    expect(html).not.toContain("members");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Orders");
  });
});
