import { describe, expect, test } from "vitest";
import { GET as getEventTickets } from "@/app/api/events/[eventId]/tickets/route";
import { POST as checkInTicket } from "@/app/api/tickets/[ticketId]/check-in/route";
import { POST as checkOutTicket } from "@/app/api/tickets/[ticketId]/check-out/route";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";

async function createPaidTicket({
  organisationId,
  eventId,
  ticketTypeId,
  userId,
  createdAt,
  checkedInAt
}: {
  organisationId: string;
  eventId: string;
  ticketTypeId: string;
  userId: string;
  createdAt?: Date;
  checkedInAt?: Date | null;
}) {
  const order = await createOrder({
    organisationId,
    eventId,
    ticketTypeId,
    userId,
    status: "paid",
    paidAt: new Date("2026-05-01T10:00:00.000Z"),
    unitPrice: 1200
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      eventId,
      ticketTypeId,
      organisationId,
      createdAt,
      checkedInAt: checkedInAt ?? null
    }
  });

  return { order, ticket };
}

describe("ticket visibility and check-in API", () => {
  const trustedAppOrigin = "http://localhost:3000";
  const firstPartyHeaders = { origin: trustedAppOrigin };

  async function withTrustedAppOrigin(run: () => Promise<void>) {
    const previous = process.env.NEXT_PUBLIC_APP_URL;
    process.env.NEXT_PUBLIC_APP_URL = trustedAppOrigin;

    try {
      await run();
    } finally {
      if (previous === undefined) {
        delete process.env.NEXT_PUBLIC_APP_URL;
      } else {
        process.env.NEXT_PUBLIC_APP_URL = previous;
      }
    }
  }

  test("organiser can list tickets for their own event", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember({ email: "ticket-buyer@example.com" });
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { order, ticket } = await createPaidTicket({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets`),
      routeContext({ eventId: event.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);
    expect(Object.keys(body).sort()).toEqual([
      "counts",
      "event",
      "pageInfo",
      "tickets"
    ]);

    expect(body).toEqual(
      expect.objectContaining({
      event: {
        id: event.id,
        title: event.title
      },
      tickets: [
        expect.objectContaining({
          id: ticket.id,
          status: "unused",
          checkedInAt: null,
          ticketTypeName: ticketType.name,
          orderId: order.id,
          buyerEmail: member.email,
          buyerName: "Test Member"
        })
      ]
      })
    );
    expect(body.pageInfo).toEqual({
      limit: 25,
      hasNextPage: false,
      hasPreviousPage: false,
      nextCursor: null,
      previousCursor: null
    });
    expect(body.counts).toEqual({
      total: 1,
      unused: 1,
      checkedIn: 0
    });
  });

  test("organiser can paginate event tickets with stable cursors and counts", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const ticketIds: string[] = [];

    for (let index = 0; index < 3; index += 1) {
      const member = await createMember({
        email: `ticket-page-${index}@example.com`
      });
      const { ticket } = await createPaidTicket({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        createdAt: new Date(`2026-05-01T10:0${index}:00.000Z`),
        checkedInAt: index === 1 ? new Date("2026-05-02T12:00:00.000Z") : null
      });
      ticketIds.push(ticket.id);
    }

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const firstResponse = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets?limit=2`),
      routeContext({ eventId: event.id })
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = await parseJsonResponse(firstResponse);
    expect(firstBody.tickets.map((ticket: { id: string }) => ticket.id)).toEqual(
      ticketIds.slice(0, 2)
    );
    expect(firstBody.counts).toEqual({
      total: 3,
      unused: 2,
      checkedIn: 1
    });
    expect(firstBody.pageInfo).toEqual(
      expect.objectContaining({
        limit: 2,
        hasNextPage: true,
        hasPreviousPage: false,
        previousCursor: null,
        nextCursor: expect.any(String)
      })
    );

    const secondResponse = await getEventTickets(
      jsonRequest(
        `http://localhost/api/events/${event.id}/tickets?limit=2&cursor=${encodeURIComponent(
          firstBody.pageInfo.nextCursor
        )}&direction=next`
      ),
      routeContext({ eventId: event.id })
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await parseJsonResponse(secondResponse);
    expect(secondBody.tickets.map((ticket: { id: string }) => ticket.id)).toEqual([
      ticketIds[2]
    ]);
    expect(secondBody.pageInfo).toEqual(
      expect.objectContaining({
        limit: 2,
        hasNextPage: false,
        hasPreviousPage: true,
        nextCursor: null,
        previousCursor: expect.any(String)
      })
    );
    expect(secondBody.counts).toEqual(firstBody.counts);

    const previousResponse = await getEventTickets(
      jsonRequest(
        `http://localhost/api/events/${event.id}/tickets?limit=2&cursor=${encodeURIComponent(
          secondBody.pageInfo.previousCursor
        )}&direction=prev`
      ),
      routeContext({ eventId: event.id })
    );
    expect(previousResponse.status).toBe(200);
    const previousBody = await parseJsonResponse(previousResponse);
    expect(previousBody.tickets.map((ticket: { id: string }) => ticket.id)).toEqual(
      ticketIds.slice(0, 2)
    );
  });

  test("invalid ticket pagination params return bad request", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    for (const url of [
      `http://localhost/api/events/${event.id}/tickets?cursor=not-a-cursor`,
      `http://localhost/api/events/${event.id}/tickets?direction=back`,
      `http://localhost/api/events/${event.id}/tickets?limit=abc`,
      `http://localhost/api/events/${event.id}/tickets?limit=0`,
      `http://localhost/api/events/${event.id}/tickets?limit=101`
    ]) {
      const response = await getEventTickets(
        jsonRequest(url),
        routeContext({ eventId: event.id })
      );

      expect(response.status).toBe(400);
      await expect(parseJsonResponse(response)).resolves.toMatchObject({
        error: {
          code: "BAD_REQUEST"
        }
      });
    }
  });

  test("organiser cannot list tickets for another organisation event", async () => {
    const { user } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: other.organisation.id });
    const ticketType = event.ticketTypes[0];
    await createPaidTicket({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets`),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(404);
  });

  test("missing and cross-tenant event ticket lists return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const otherEvent = await createEvent({ organisationId: other.organisation.id });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });
    const missingResponse = await getEventTickets(
      jsonRequest("http://localhost/api/events/missing-event/tickets"),
      routeContext({ eventId: "missing-event" })
    );
    const crossTenantResponse = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${otherEvent.id}/tickets`),
      routeContext({ eventId: otherEvent.id })
    );

    expect(missingResponse.status).toBe(404);
    expect(crossTenantResponse.status).toBe(404);
    expect(await parseJsonResponse(crossTenantResponse)).toEqual(
      await parseJsonResponse(missingResponse)
    );
  });

  test("ticket listing uses event ownership when ticket organisation is inconsistent", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { ticket } = await createPaidTicket({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets`),
      routeContext({ eventId: event.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);

    expect(body.tickets).toEqual([
      expect.objectContaining({
        id: ticket.id,
        ticketTypeName: ticketType.name
      })
    ]);
  });

  test("member cannot list event tickets", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets`),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(403);
  });

  test("unauthenticated event ticket list returns 401", async () => {
    const { organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });

    clearMockSession();
    const response = await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets`),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(401);
  });

  test("organiser can check in their own ticket without changing order state", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { order, ticket } = await createPaidTicket({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkInTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);
    expect(Object.keys(body).sort()).toEqual(["ticket"]);
    expect(body.ticket).toEqual(
      expect.objectContaining({
        id: ticket.id,
        status: "checked-in"
      })
    );
    expect(body.ticket.checkedInAt).toEqual(expect.any(String));

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: {
        checkedInAt: true,
        order: {
          select: {
            status: true,
            paidAt: true,
            stripeSessionId: true
          }
        },
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          }
        }
      }
    });
    expect(updated.checkedInAt).toBeInstanceOf(Date);
    expect(updated.order.status).toBe("paid");
    expect(updated.order.paidAt).toEqual(order.paidAt);
    expect(updated.order.stripeSessionId).toBe(order.stripeSessionId);
    expect(updated.ticketType).toEqual({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price,
      quantity: ticketType.quantity
    });
  });

  test("double check-in returns conflict and preserves original timestamp", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const originalCheckedInAt = new Date("2026-05-02T12:00:00.000Z");
    const { ticket } = await createPaidTicket({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      checkedInAt: originalCheckedInAt
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkInTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );
    expect(response.status).toBe(409);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { checkedInAt: true }
    });
    expect(updated.checkedInAt).toEqual(originalCheckedInAt);
  });

  test("missing and cross-tenant ticket check-in return the same safe 404", async () => {
    await withTrustedAppOrigin(async () => {
      const { user } = await createOrganisationAccount();
      const other = await createOrganisationAccount();
      const member = await createMember();
      const event = await createEvent({ organisationId: other.organisation.id });
      const ticketType = event.ticketTypes[0];
      const { ticket } = await createPaidTicket({
        organisationId: other.organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id
      });

      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
      const missingResponse = await checkInTicket(
        jsonRequest("http://localhost/api/tickets/missing-ticket/check-in", undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: "missing-ticket" })
      );
      const crossTenantResponse = await checkInTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );

      expect(missingResponse.status).toBe(404);
      expect(crossTenantResponse.status).toBe(404);
      expect(await parseJsonResponse(crossTenantResponse)).toEqual(
        await parseJsonResponse(missingResponse)
      );
    });
  });

  test("member and unauthenticated ticket check-in remain forbidden or unauthorized", async () => {
    await withTrustedAppOrigin(async () => {
      const { organisation } = await createOrganisationAccount();
      const member = await createMember();
      const event = await createEvent({ organisationId: organisation.id });
      const ticketType = event.ticketTypes[0];
      const { ticket } = await createPaidTicket({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id
      });

      setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
      const memberResponse = await checkInTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );
      expect(memberResponse.status).toBe(403);

      clearMockSession();
      const unauthenticatedResponse = await checkInTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );
      expect(unauthenticatedResponse.status).toBe(401);
    });
  });

  test("organiser cannot check in another organisation ticket", async () => {
    const { user } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: other.organisation.id });
    const ticketType = event.ticketTypes[0];
    const { ticket } = await createPaidTicket({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkInTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );

    expect(response.status).toBe(404);
  });

  test("check-in uses event ownership when ticket organisation is inconsistent", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { order, ticket } = await createPaidTicket({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkInTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );
    expect(response.status).toBe(200);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: {
        checkedInAt: true,
        organisationId: true,
        eventId: true,
        order: {
          select: {
            status: true,
            paidAt: true,
            stripeSessionId: true
          }
        }
      }
    });
    expect(updated.checkedInAt).toBeInstanceOf(Date);
    expect(updated.organisationId).toBe(other.organisation.id);
    expect(updated.eventId).toBe(event.id);
    expect(updated.order.status).toBe("paid");
    expect(updated.order.paidAt).toEqual(order.paidAt);
    expect(updated.order.stripeSessionId).toBe(order.stripeSessionId);
  });

  test("organiser can check out their own checked-in ticket without changing order state", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const originalCheckedInAt = new Date("2026-05-02T12:00:00.000Z");
    const { order, ticket } = await createPaidTicket({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      checkedInAt: originalCheckedInAt
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkOutTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);
    expect(Object.keys(body).sort()).toEqual(["ticket"]);
    expect(body.ticket).toEqual({
      id: ticket.id,
      status: "unused",
      checkedInAt: null
    });

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: {
        checkedInAt: true,
        organisationId: true,
        eventId: true,
        order: {
          select: {
            status: true,
            paidAt: true,
            stripeSessionId: true
          }
        },
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          }
        }
      }
    });
    expect(updated.checkedInAt).toBeNull();
    expect(updated.organisationId).toBe(organisation.id);
    expect(updated.eventId).toBe(event.id);
    expect(updated.order.status).toBe("paid");
    expect(updated.order.paidAt).toEqual(order.paidAt);
    expect(updated.order.stripeSessionId).toBe(order.stripeSessionId);
    expect(updated.ticketType).toEqual({
      id: ticketType.id,
      name: ticketType.name,
      price: ticketType.price,
      quantity: ticketType.quantity
    });
  });

  test("check-out returns conflict when ticket is already unused", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { ticket } = await createPaidTicket({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkOutTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );
    expect(response.status).toBe(409);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { checkedInAt: true }
    });
    expect(updated.checkedInAt).toBeNull();
  });

  test("organiser cannot check out another organisation ticket", async () => {
    const { user } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: other.organisation.id });
    const ticketType = event.ticketTypes[0];
    const originalCheckedInAt = new Date("2026-05-02T12:00:00.000Z");
    const { ticket } = await createPaidTicket({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      checkedInAt: originalCheckedInAt
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkOutTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );

    expect(response.status).toBe(404);
  });

  test("missing and cross-tenant ticket check-out return the same safe 404", async () => {
    await withTrustedAppOrigin(async () => {
      const { user } = await createOrganisationAccount();
      const other = await createOrganisationAccount();
      const member = await createMember();
      const event = await createEvent({ organisationId: other.organisation.id });
      const ticketType = event.ticketTypes[0];
      const { ticket } = await createPaidTicket({
        organisationId: other.organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        checkedInAt: new Date("2026-05-02T12:00:00.000Z")
      });

      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
      const missingResponse = await checkOutTicket(
        jsonRequest("http://localhost/api/tickets/missing-ticket/check-out", undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: "missing-ticket" })
      );
      const crossTenantResponse = await checkOutTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );

      expect(missingResponse.status).toBe(404);
      expect(crossTenantResponse.status).toBe(404);
      expect(await parseJsonResponse(crossTenantResponse)).toEqual(
        await parseJsonResponse(missingResponse)
      );
    });
  });

  test("check-out uses event ownership when ticket organisation is inconsistent", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { order, ticket } = await createPaidTicket({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      checkedInAt: new Date("2026-05-02T12:00:00.000Z")
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await checkOutTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );
    expect(response.status).toBe(200);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: {
        checkedInAt: true,
        organisationId: true,
        eventId: true,
        order: {
          select: {
            status: true,
            paidAt: true,
            stripeSessionId: true
          }
        }
      }
    });
    expect(updated.checkedInAt).toBeNull();
    expect(updated.organisationId).toBe(other.organisation.id);
    expect(updated.eventId).toBe(event.id);
    expect(updated.order.status).toBe("paid");
    expect(updated.order.paidAt).toEqual(order.paidAt);
    expect(updated.order.stripeSessionId).toBe(order.stripeSessionId);
  });

  test("member cannot check out a ticket", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { ticket } = await createPaidTicket({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      checkedInAt: new Date("2026-05-02T12:00:00.000Z")
    });

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await checkOutTicket(
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
        method: "POST"
      }),
      routeContext({ ticketId: ticket.id })
    );

    expect(response.status).toBe(403);
  });

  test("unauthenticated ticket check-out returns 401", async () => {
    await withTrustedAppOrigin(async () => {
      const { organisation } = await createOrganisationAccount();
      const member = await createMember();
      const event = await createEvent({ organisationId: organisation.id });
      const ticketType = event.ticketTypes[0];
      const { ticket } = await createPaidTicket({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        checkedInAt: new Date("2026-05-02T12:00:00.000Z")
      });

      clearMockSession();
      const response = await checkOutTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );

      expect(response.status).toBe(401);
    });
  });
});
