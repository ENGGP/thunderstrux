import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
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

describe("public-safe pages and APIs", () => {
  test("public event list read does not create demo data when database is empty", async () => {
    const list = await getPublicEvents();
    expect(list.status).toBe(200);
    await expect(parseJsonResponse(list)).resolves.toEqual({ events: [] });

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

    const list = await getPublicEvents();
    expect(list.status).toBe(200);
    const listBody = await parseJsonResponse(list);
    expect(listBody.events).toEqual([
      expect.objectContaining({
        id: published.id,
        title: published.title,
        organisation: expect.objectContaining({ name: organisation.name })
      })
    ]);
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
      ticketTypes: expect.any(Array)
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

    const detail = await getPublicEvent(
      new Request(`http://localhost/api/public/events/${event.id}`),
      routeContext({ eventId: event.id })
    );
    expect(detail.status).toBe(200);

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
