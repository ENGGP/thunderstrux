import { describe, expect, test } from "vitest";
import { GET as getEventTickets } from "@/app/api/events/[eventId]/tickets/route";
import { POST as checkInTicket } from "@/app/api/tickets/[ticketId]/check-in/route";
import { POST as checkOutTicket } from "@/app/api/tickets/[ticketId]/check-out/route";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
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
  checkedInAt
}: {
  organisationId: string;
  eventId: string;
  ticketTypeId: string;
  userId: string;
  checkedInAt?: Date | null;
}) {
  const order = await createOrder({
    organisationId,
    eventId,
    ticketTypeId,
    userId,
    status: "paid",
    paidAt: new Date("2026-05-01T10:00:00.000Z"),
    unitPrice: 1200,
    stripeSessionId: `cs_test_ticket_${ticketTypeId}_${userId}`
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      eventId,
      ticketTypeId,
      organisationId,
      checkedInAt: checkedInAt ?? null
    }
  });

  return { order, ticket };
}

describe("ticket visibility and check-in API", () => {
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

    expect(body).toEqual({
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
    });
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
    expect(response.status).toBe(200);

    const updated = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticket.id },
      select: { checkedInAt: true }
    });
    expect(updated.checkedInAt).toBeInstanceOf(Date);
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
    const { ticket } = await createPaidTicket({
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

    expect(response.status).toBe(404);
  });

  test("check-out uses event ownership when ticket organisation is inconsistent", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const { ticket } = await createPaidTicket({
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
      select: { checkedInAt: true }
    });
    expect(updated.checkedInAt).toBeNull();
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
});
