import { describe, expect, test } from "vitest";
import { GET as getEventTickets } from "@/app/api/events/[eventId]/tickets/route";
import { POST as checkInTicket } from "@/app/api/tickets/[ticketId]/check-in/route";
import { POST as checkOutTicket } from "@/app/api/tickets/[ticketId]/check-out/route";
import { prisma } from "@/lib/db";
import { clearMockSession, selectMockContext, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createOrganisationStaff
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
      issueSequence: 1,
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
          // Fixture orders carry no purchase snapshot, like orders created before T10.
          ticketTypeName: `${ticketType.name} (historical label unavailable)`,
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

  test("a search keeps its filter on later pages (T53)", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const matches: string[] = [];
    for (const [index, name] of ["findme-a", "someone-else", "findme-b", "findme-c"].entries()) {
      const member = await createMember({ email: `${name}-${organisation.id}@example.com` });
      const { ticket } = await createPaidTicket({
        organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id,
        createdAt: new Date(`2026-05-01T10:0${index}:00.000Z`)
      });
      if (name.startsWith("findme")) matches.push(ticket.id);
    }

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const page = async (cursor?: string) => parseJsonResponse(await getEventTickets(
      jsonRequest(`http://localhost/api/events/${event.id}/tickets?limit=2&q=findme${cursor ? `&cursor=${encodeURIComponent(cursor)}&direction=next` : ""}`),
      routeContext({ eventId: event.id })
    ));
    const first = await page();
    expect(first.tickets.map((ticket: { id: string }) => ticket.id)).toEqual(matches.slice(0, 2));
    const second = await page(first.pageInfo.nextCursor);
    expect(second.tickets.map((ticket: { id: string }) => ticket.id)).toEqual(matches.slice(2));
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
        ticketTypeName: `${ticketType.name} (historical label unavailable)`
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
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${ticket.eventId}`, undefined, {
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
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${ticket.eventId}`, undefined, {
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
        jsonRequest("http://localhost/api/tickets/missing-ticket/check-in?eventId=missing-event", undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: "missing-ticket" })
      );
      const crossTenantResponse = await checkInTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${ticket.eventId}`, undefined, {
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
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).checkedInAt).toBeNull();
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
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${ticket.eventId}`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );
      expect(memberResponse.status).toBe(403);

      clearMockSession();
      const unauthenticatedResponse = await checkInTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${ticket.eventId}`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );
      expect(unauthenticatedResponse.status).toBe(401);
    });
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
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${ticket.eventId}`, undefined, {
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
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out?eventId=${ticket.eventId}`, undefined, {
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
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "ticket.checked_out", targetId: ticket.id } }))
      .toMatchObject({ organisationId: organisation.id, actorUserId: user.id, targetType: "Ticket" });
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
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out?eventId=${ticket.eventId}`, undefined, {
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
        jsonRequest("http://localhost/api/tickets/missing-ticket/check-out?eventId=missing-event", undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: "missing-ticket" })
      );
      const crossTenantResponse = await checkOutTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out?eventId=${ticket.eventId}`, undefined, {
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
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).checkedInAt).toEqual(new Date("2026-05-02T12:00:00.000Z"));
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
      jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out?eventId=${ticket.eventId}`, undefined, {
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

  test("member and unauthenticated ticket check-out remain forbidden or unauthorized", async () => {
    await withTrustedAppOrigin(async () => {
      const { organisation } = await createOrganisationAccount();
      const member = await createMember();
      const event = await createEvent({ organisationId: organisation.id });
      const checkedInAt = new Date("2026-05-02T12:00:00.000Z");
      const { ticket } = await createPaidTicket({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: event.ticketTypes[0].id,
        userId: member.id,
        checkedInAt
      });
      const checkOut = () => checkOutTicket(
        jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-out?eventId=${ticket.eventId}`, undefined, {
          method: "POST",
          headers: firstPartyHeaders
        }),
        routeContext({ ticketId: ticket.id })
      );

      setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
      expect((await checkOut()).status).toBe(403);
      clearMockSession();
      expect((await checkOut()).status).toBe(401);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).checkedInAt).toEqual(checkedInAt);
    });
  });

  // T19b: the check-in console.
  async function doorFixture() {
    const owner = await createOrganisationAccount();
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const member = await createMember({ email: `sam.lee.${Date.now()}@example.com` });
    const buyer = await prisma.user.update({ where: { id: member.id }, data: { firstName: "Sam", lastName: "Lee" } });
    const { order, ticket } = await createPaidTicket({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: buyer.id });
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    return { owner, event, buyer, order, ticket };
  }
  const post = (route: typeof checkInTicket, ticket: { id: string; eventId: string }, eventId = ticket.eventId) =>
    route(jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in?eventId=${eventId}`, undefined, { method: "POST" }), routeContext({ ticketId: ticket.id }));
  const search = async (eventId: string, q: string) =>
    parseJsonResponse(await getEventTickets(jsonRequest(`http://localhost/api/events/${eventId}/tickets?q=${encodeURIComponent(q)}`), routeContext({ eventId })));
  const conflictReason = async (response: Response) => (await parseJsonResponse(response)).error.details[0].reason;

  test("two check-ins at once admit the ticket once; the loser is told it is already checked in, and by whom", async () => {
    const { owner, event, ticket } = await doorFixture();
    const responses = await Promise.all([post(checkInTicket, ticket), post(checkInTicket, ticket)]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await conflictReason(responses.find((response) => response.status === 409)!)).toBe("already_checked_in");
    expect(await prisma.auditLog.count({ where: { targetId: ticket.id, action: "ticket.checked_in" } })).toBe(1);
    const found = (await search(event.id, ticket.id.slice(-6).toUpperCase())).tickets[0];
    expect(found).toMatchObject({ id: ticket.id, status: "checked-in", checkedInBy: expect.any(String), validity: "active" });
    expect(found.checkedInBy).toBe([owner.user.firstName, owner.user.lastName].filter(Boolean).join(" ") || owner.user.email);
  });

  test("a refunded or disputed ticket is refused with its reason, and its attendance record is left as it was", async () => {
    const { event, ticket } = await doorFixture();
    const checkedInAt = new Date("2026-05-02T12:00:00.000Z");
    await prisma.ticket.update({ where: { id: ticket.id }, data: { validity: "void", validityReason: "refunded", validityChangedAt: new Date(), checkedInAt } });
    const refused = await post(checkInTicket, ticket);
    expect(refused.status).toBe(409);
    expect(await conflictReason(refused)).toBe("not_valid");
    const undo = await post(checkOutTicket, ticket);
    expect(await conflictReason(undo)).toBe("not_valid");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).checkedInAt).toEqual(checkedInAt);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { validity: "refund_review", validityReason: "disputed", checkedInAt: null } });
    expect(await conflictReason(await post(checkInTicket, ticket))).toBe("under_review");
    // The door list leaves it out; a search finds it so staff can say why.
    expect((await search(event.id, "")).tickets).toEqual([]);
    expect((await search(event.id, "Sam Lee")).tickets).toEqual([expect.objectContaining({ id: ticket.id, validity: "refund_review" })]);
  });

  test("search matches name, email, order and ticket references within this event only", async () => {
    const { owner, event, buyer, order, ticket } = await doorFixture();
    const otherEvent = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    await createPaidTicket({ organisationId: owner.organisation.id, eventId: otherEvent.id, ticketTypeId: otherEvent.ticketTypes[0].id, userId: buyer.id });
    for (const q of ["sam lee", "LEE", buyer.email.slice(0, 8), order.id.slice(-6).toUpperCase(), ticket.id.slice(-6).toUpperCase()]) {
      expect((await search(event.id, q)).tickets.map((found: { id: string }) => found.id), q).toEqual([ticket.id]);
    }
    expect((await search(event.id, "nobody here")).tickets).toEqual([]);
  });

  // DEBT-002: the door checks one event, so a ticket of the society's other events isn't found there.
  test("check-in is scoped to the event the door is checking", async () => {
    const { owner, event, buyer, ticket } = await doorFixture();
    const otherEvent = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const { ticket: other } = await createPaidTicket({ organisationId: owner.organisation.id, eventId: otherEvent.id, ticketTypeId: otherEvent.ticketTypes[0].id, userId: buyer.id });
    expect((await post(checkInTicket, other, event.id)).status).toBe(404);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: other.id } })).checkedInAt).toBeNull();
    const unnamed = await checkInTicket(jsonRequest(`http://localhost/api/tickets/${ticket.id}/check-in`, undefined, { method: "POST" }), routeContext({ ticketId: ticket.id }));
    expect(unnamed.status).toBe(400);
    expect((await post(checkInTicket, ticket, event.id)).status).toBe(200);
  });

  test("check-in-only staff work published events only", async () => {
    const { owner, event, ticket } = await doorFixture();
    const draft = await createEvent({ organisationId: owner.organisation.id, status: "draft" });
    const { ticket: draftTicket } = await createPaidTicket({ organisationId: owner.organisation.id, eventId: draft.id, ticketTypeId: draft.ticketTypes[0].id, userId: (await createMember()).id });
    const staff = await createMember();
    await createOrganisationStaff({ organisationId: owner.organisation.id, userId: staff.id, role: "check_in_staff" });
    setMockSession({ userId: staff.id, email: staff.email, accountRole: "member" });
    selectMockContext({ mode: "staff", organisationId: owner.organisation.id });
    expect((await post(checkInTicket, ticket)).status).toBe(200);
    expect((await post(checkInTicket, draftTicket)).status).toBe(404);
    expect((await getEventTickets(jsonRequest(`http://localhost/api/events/${draft.id}/tickets`), routeContext({ eventId: draft.id }))).status).toBe(404);
  });
});
