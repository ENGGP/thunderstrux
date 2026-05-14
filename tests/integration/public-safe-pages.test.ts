import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import OrganisationDetailsPage from "@/app/(public)/organisations/[orgSlug]/page";
import HomePage from "@/app/page";

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
  test("public event list read does not create demo data when database is empty", async () => {
    const list = await getPublicEvents(
      new Request("http://localhost/api/public/events")
    );
    expect(list.status).toBe(200);
    await expect(parseJsonResponse(list)).resolves.toEqual({
      events: [],
      pageInfo: {
        limit: 25,
        hasNextPage: false,
        hasPreviousPage: false,
        nextCursor: null,
        previousCursor: null
      }
    });

    await expect(
      Promise.all([
        prisma.organisation.count(),
        prisma.event.count(),
        prisma.ticketType.count(),
        prisma.user.count(),
        prisma.order.count(),
        prisma.ticketReservation.count(),
        prisma.ticket.count()
      ])
    ).resolves.toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

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

  test("public event detail read does not mutate stale pending orders or reservations", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Published Event With Stale Reservation",
      status: "published"
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      quantity: 1,
      unitPrice: ticketType.price
    });
    const reservation = await createReservation({
      orderId: order.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 1,
      status: "active",
      expiresAt: new Date(Date.now() - 60 * 1000)
    });
    const countsBefore = await Promise.all([
      prisma.organisation.count(),
      prisma.event.count(),
      prisma.ticketType.count(),
      prisma.user.count(),
      prisma.order.count(),
      prisma.ticketReservation.count(),
      prisma.ticket.count()
    ]);

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${event.id}`),
      routeContext({ eventId: event.id })
    );
    expect(detail.status).toBe(200);
    await expect(
      Promise.all([
        prisma.organisation.count(),
        prisma.event.count(),
        prisma.ticketType.count(),
        prisma.user.count(),
        prisma.order.count(),
        prisma.ticketReservation.count(),
        prisma.ticket.count()
      ])
    ).resolves.toEqual(countsBefore);

    await expect(
      prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: { status: true, failureReason: true }
      })
    ).resolves.toEqual({
      status: "pending",
      failureReason: null
    });
    await expect(
      prisma.ticketReservation.findUniqueOrThrow({
        where: { id: reservation.id },
        select: { status: true, releasedAt: true, confirmedAt: true }
      })
    ).resolves.toEqual({
      status: "active",
      releasedAt: null,
      confirmedAt: null
    });
  });

  test("public event detail returns reservation-aware availability while preserving raw quantity", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Published Event With Active Reservations",
      status: "published",
      ticketTypes: [
        { name: "General", price: 1200, quantity: 10 },
        { name: "VIP", price: 2500, quantity: 8 }
      ]
    });
    const [general, vip] = event.ticketTypes;
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: general.id,
      userId: member.id,
      quantity: 3,
      unitPrice: general.price
    });
    await createReservation({
      orderId: order.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: general.id,
      userId: member.id,
      quantity: 3,
      status: "active",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${event.id}`),
      routeContext({ eventId: event.id })
    );

    expect(detail.status).toBe(200);
    const body = await parseJsonResponse(detail);
    expect(body.event.ticketTypes).toEqual([
      expect.objectContaining({
        id: general.id,
        quantity: 10,
        availableQuantity: 7
      }),
      expect.objectContaining({
        id: vip.id,
        quantity: 8,
        availableQuantity: 8
      })
    ]);
  });

  test("public event detail ignores expired and non-active reservations for availability", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Published Event With Inactive Reservations",
      status: "published"
    });
    const ticketType = event.ticketTypes[0];

    const reservationInputs = [
      {
        status: "active" as const,
        expiresAt: new Date(Date.now() - 60 * 1000)
      },
      {
        status: "released" as const,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        releasedAt: new Date(),
        releaseReason: "test_release"
      },
      {
        status: "confirmed" as const,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        confirmedAt: new Date()
      },
      {
        status: "expired" as const,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
        releasedAt: new Date(),
        releaseReason: "expired"
      }
    ];

    for (const reservationInput of reservationInputs) {
      const order = await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        quantity: 2,
        unitPrice: ticketType.price
      });
      await createReservation({
        orderId: order.id,
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        quantity: 2,
        ...reservationInput
      });
    }

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${event.id}`),
      routeContext({ eventId: event.id })
    );

    expect(detail.status).toBe(200);
    const body = await parseJsonResponse(detail);
    expect(body.event.ticketTypes[0]).toMatchObject({
      id: ticketType.id,
      quantity: ticketType.quantity,
      availableQuantity: ticketType.quantity
    });
  });

  test("public event detail clamps over-reserved availability to zero", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Published Over Reserved Event",
      status: "published",
      ticketTypes: [{ name: "General", price: 1200, quantity: 5 }]
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 7,
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: order.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      quantity: 7,
      status: "active",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000)
    });

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${event.id}`),
      routeContext({ eventId: event.id })
    );

    expect(detail.status).toBe(200);
    const body = await parseJsonResponse(detail);
    expect(body.event.ticketTypes[0]).toMatchObject({
      id: ticketType.id,
      quantity: 5,
      availableQuantity: 0
    });
  });

  test("public ticket purchase renders sold out when reservations consume raw inventory", () => {
    const html = renderToStaticMarkup(
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

    expect(html).toContain("0 remaining");
    expect(html).toContain("Sold out");
    expect(html).not.toContain("5 remaining");
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

  test("homepage falls back to first page with warning for invalid pagination params", async () => {
    const { organisation } = await createOrganisationAccount({
      name: "Homepage Public Org",
      slug: "homepage-public-org"
    });
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Homepage Event",
      status: "published"
    });

    const invalidLimitHtml = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ limit: "0" }) })
    );
    expect(invalidLimitHtml).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(invalidLimitHtml).toContain(event.title);

    const invalidCursorHtml = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ cursor: "bad-cursor" }) })
    );
    expect(invalidCursorHtml).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(invalidCursorHtml).toContain(event.title);

    const invalidDirectionHtml = renderToStaticMarkup(
      await HomePage({ searchParams: Promise.resolve({ direction: "invalid" }) })
    );
    expect(invalidDirectionHtml).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(invalidDirectionHtml).toContain(event.title);
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
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Public Safe Org");
    expect(html).toContain("Upcoming Public Event");
    expect(html).not.toContain("stripeAccountId");
    expect(html).not.toContain("acct_");
    expect(html).not.toContain("members");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Orders");
  });
});
