import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createReservation,
  futureDate
} from "@/tests/helpers/test-data";
import { POST as createEventRoute } from "@/app/api/events/route";
import {
  DELETE as deleteEventRoute,
  GET as getEventRoute,
  PATCH as updateEventRoute
} from "@/app/api/events/[eventId]/route";
import { PATCH as publishEventRoute } from "@/app/api/events/[eventId]/publish/route";
import { POST as createTicketTypeRoute } from "@/app/api/events/[eventId]/ticket-types/route";
import {
  getOrganisationEventAnalytics,
  getOrganisationEventRevenueSeries
} from "@/lib/events/event-analytics";

function eventPayload(organisationId: string, overrides: Record<string, unknown> = {}) {
  const startTime = futureDate(20, 10).toISOString();
  const endTime = new Date(new Date(startTime).getTime() + 2 * 60 * 60 * 1000).toISOString();

  return {
    organisationId,
    title: "Integration Event",
    description: "Integration event description",
    location: "Integration Hall",
    startTime,
    endTime,
    status: "draft",
    ticketTypes: [
      {
        name: "General",
        price: 1500,
        quantity: 10
      }
    ],
    ...overrides
  };
}

describe("event lifecycle", () => {
  test("creates and edits an event with expected response shape", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({
      userId: user.id,
      email: user.email,
      accountRole: "organisation"
    });

    const createResponse = await createEventRoute(
      jsonRequest("http://localhost/api/events", eventPayload(organisation.id))
    );
    expect(createResponse.status).toBe(201);
    const createBody = await parseJsonResponse(createResponse);
    expect(createBody).toMatchObject({
      event: {
        id: expect.any(String),
        organisationId: organisation.id,
        title: "Integration Event",
        ticketTypes: [expect.objectContaining({ id: expect.any(String) })]
      }
    });

    const event = createBody.event;
    const updatePayload = {
      ...eventPayload(organisation.id, {
        title: "Integration Event Updated",
        ticketTypes: [
          {
            id: event.ticketTypes[0].id,
            name: "General Updated",
            price: 1800,
            quantity: 12
          }
        ]
      })
    };
    const updateResponse = await updateEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, updatePayload, {
        method: "PATCH"
      }),
      routeContext({ eventId: event.id })
    );
    expect(updateResponse.status).toBe(200);
    const updateBody = await parseJsonResponse(updateResponse);
    expect(updateBody.event).toMatchObject({
      id: event.id,
      title: "Integration Event Updated",
      ticketTypes: [expect.objectContaining({ name: "General Updated", price: 1800 })]
    });
  });

  test("missing and cross-tenant event update return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const otherEvent = await createEvent({ organisationId: other.organisation.id });
    const payload = eventPayload(owned.organisation.id, {
      title: "Updated Hidden Event"
    });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });
    const missingResponse = await updateEventRoute(
      jsonRequest("http://localhost/api/events/missing-event", payload, {
        method: "PATCH"
      }),
      routeContext({ eventId: "missing-event" })
    );
    const crossTenantResponse = await updateEventRoute(
      jsonRequest(`http://localhost/api/events/${otherEvent.id}`, payload, {
        method: "PATCH"
      }),
      routeContext({ eventId: otherEvent.id })
    );

    expect(missingResponse.status).toBe(404);
    expect(crossTenantResponse.status).toBe(404);
    expect(await parseJsonResponse(crossTenantResponse)).toEqual(
      await parseJsonResponse(missingResponse)
    );
  });

  test("event update authenticates before validation", async () => {
    const { organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });

    clearMockSession();
    const response = await updateEventRoute(
      jsonRequest(
        `http://localhost/api/events/${event.id}`,
        { title: "" },
        { method: "PATCH" }
      ),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(401);
  });

  test("event update rejects mismatched body organisation without updating event", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const event = await createEvent({ organisationId: owned.organisation.id });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });
    const response = await updateEventRoute(
      jsonRequest(
        `http://localhost/api/events/${event.id}`,
        eventPayload(other.organisation.id, {
          title: "Should Not Persist"
        }),
        { method: "PATCH" }
      ),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(403);
    await expect(
      prisma.event.findUniqueOrThrow({
        where: { id: event.id },
        select: { title: true, organisationId: true }
      })
    ).resolves.toEqual({
      title: event.title,
      organisationId: owned.organisation.id
    });
  });

  test("missing and cross-tenant event delete return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const otherEvent = await createEvent({ organisationId: other.organisation.id });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });
    const missingResponse = await deleteEventRoute(
      jsonRequest("http://localhost/api/events/missing-event", undefined, {
        method: "DELETE"
      }),
      routeContext({ eventId: "missing-event" })
    );
    const crossTenantResponse = await deleteEventRoute(
      jsonRequest(`http://localhost/api/events/${otherEvent.id}`, undefined, {
        method: "DELETE"
      }),
      routeContext({ eventId: otherEvent.id })
    );

    expect(missingResponse.status).toBe(404);
    expect(crossTenantResponse.status).toBe(404);
    expect(await parseJsonResponse(crossTenantResponse)).toEqual(
      await parseJsonResponse(missingResponse)
    );
  });

  test("missing and cross-tenant event publish return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const otherEvent = await createEvent({ organisationId: other.organisation.id });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });
    const missingResponse = await publishEventRoute(
      jsonRequest("http://localhost/api/events/missing-event/publish", undefined, {
        method: "PATCH"
      }),
      routeContext({ eventId: "missing-event" })
    );
    const crossTenantResponse = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${otherEvent.id}/publish`, undefined, {
        method: "PATCH"
      }),
      routeContext({ eventId: otherEvent.id })
    );

    expect(missingResponse.status).toBe(404);
    expect(crossTenantResponse.status).toBe(404);
    expect(await parseJsonResponse(crossTenantResponse)).toEqual(
      await parseJsonResponse(missingResponse)
    );
  });

  test("missing and cross-tenant ticket type creation return the same safe 404", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const otherEvent = await createEvent({ organisationId: other.organisation.id });
    const payload = {
      organisationId: owned.organisation.id,
      name: "Late Release",
      price: 1800,
      quantity: 5
    };

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });
    const missingResponse = await createTicketTypeRoute(
      jsonRequest("http://localhost/api/events/missing-event/ticket-types", payload),
      routeContext({ eventId: "missing-event" })
    );
    const crossTenantResponse = await createTicketTypeRoute(
      jsonRequest(`http://localhost/api/events/${otherEvent.id}/ticket-types`, payload),
      routeContext({ eventId: otherEvent.id })
    );

    expect(missingResponse.status).toBe(404);
    expect(crossTenantResponse.status).toBe(404);
    expect(await parseJsonResponse(crossTenantResponse)).toEqual(
      await parseJsonResponse(missingResponse)
    );
  });

  test("member and unauthenticated event mutation access remains forbidden or unauthorized", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const payload = eventPayload(organisation.id, {
      title: "Member Update Attempt"
    });

    setMockSession({
      userId: member.id,
      email: member.email,
      accountRole: "member"
    });
    const memberResponse = await updateEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, payload, {
        method: "PATCH"
      }),
      routeContext({ eventId: event.id })
    );
    expect(memberResponse.status).toBe(403);

    clearMockSession();
    const unauthenticatedResponse = await updateEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, payload, {
        method: "PATCH"
      }),
      routeContext({ eventId: event.id })
    );
    expect(unauthenticatedResponse.status).toBe(401);
  });

  test("publish requires ticket types and positive remaining quantity", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const noTicketEvent = await createEvent({
      organisationId: organisation.id,
      ticketTypes: []
    });
    const noTicketResponse = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${noTicketEvent.id}/publish`, undefined, {
        method: "PATCH"
      }),
      routeContext({ eventId: noTicketEvent.id })
    );
    expect(noTicketResponse.status).toBe(400);

    const zeroQuantityEvent = await createEvent({
      organisationId: organisation.id,
      ticketTypes: [{ name: "Sold Out", price: 1000, quantity: 0 }]
    });
    const zeroQuantityResponse = await publishEventRoute(
      jsonRequest(
        `http://localhost/api/events/${zeroQuantityEvent.id}/publish`,
        undefined,
        { method: "PATCH" }
      ),
      routeContext({ eventId: zeroQuantityEvent.id })
    );
    expect(zeroQuantityResponse.status).toBe(400);

    const validEvent = await createEvent({ organisationId: organisation.id });
    const published = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${validEvent.id}/publish`, undefined, {
        method: "PATCH"
      }),
      routeContext({ eventId: validEvent.id })
    );
    expect(published.status).toBe(200);
    expect(await parseJsonResponse(published)).toMatchObject({
      event: { id: validEvent.id, status: "published" }
    });
  });

  test("unpublish is blocked after orders exist", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      status: "paid",
      paidAt: new Date()
    });

    const response = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}/publish`, undefined, {
        method: "PATCH"
      }),
      routeContext({ eventId: event.id })
    );
    expect(response.status).toBe(400);
    expect(await parseJsonResponse(response)).toMatchObject({
      error: { code: "BAD_REQUEST", message: expect.any(String) }
    });
  });

  test("deletes an unsold event with expected response shape", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await deleteEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, undefined, {
        method: "DELETE"
      }),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({ deleted: true });
  });

  test("sold ticket types can be renamed and repriced but not deleted", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const event = await createEvent({
      organisationId: organisation.id,
      ticketTypes: [
        { name: "Sold", price: 1000, quantity: 5 },
        { name: "Unsold", price: 500, quantity: 5 }
      ]
    });
    const soldTicketType = event.ticketTypes[0];
    const unsoldTicketType = event.ticketTypes[1];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: soldTicketType.id,
      status: "paid",
      quantity: 2,
      unitPrice: soldTicketType.price,
      paidAt: new Date()
    });

    const payload = {
      organisationId: organisation.id,
      title: event.title,
      description: event.description,
      startTime: event.startTime.toISOString(),
      endTime: event.endTime.toISOString(),
      location: event.location,
      ticketTypes: [
        {
          id: soldTicketType.id,
          name: "Sold Renamed",
          price: 2000,
          quantity: 8
        }
      ]
    };

    const response = await updateEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, payload, { method: "PATCH" }),
      routeContext({ eventId: event.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);
    expect(body.event.ticketTypes).toEqual([
      expect.objectContaining({ id: soldTicketType.id, name: "Sold Renamed", price: 2000 })
    ]);
    expect(body.event.ticketTypes).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: unsoldTicketType.id })])
    );

    const historicalOrder = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: { unitPrice: true, totalAmount: true }
    });
    expect(historicalOrder).toEqual({
      unitPrice: 1000,
      totalAmount: 2000
    });

    const getResponse = await getEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}?orgId=${organisation.id}`),
      routeContext({ eventId: event.id })
    );
    expect(getResponse.status).toBe(200);
  });

  test("event analytics use event ownership when order organisation is inconsistent", async () => {
    const { organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    await createOrder({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      status: "paid",
      quantity: 2,
      unitPrice: ticketType.price,
      paidAt: new Date("2026-05-01T10:00:00.000Z")
    });

    const analytics = await getOrganisationEventAnalytics(organisation.id, event.id);
    expect(analytics.totals).toMatchObject({
      sold: 2,
      revenue: ticketType.price * 2
    });

    const revenueSeries = await getOrganisationEventRevenueSeries(
      organisation.id,
      event.id
    );
    expect(revenueSeries).toEqual([
      {
        date: "2026-05-01",
        revenue: ticketType.price * 2
      }
    ]);
  });

  test("event analytics do not mutate stale pending orders or reservations", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const pending = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
    await createReservation({
      orderId: pending.id,
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      expiresAt: new Date(Date.now() - 60 * 1000)
    });

    await getOrganisationEventAnalytics(organisation.id, event.id);
    await getOrganisationEventRevenueSeries(organisation.id, event.id);

    const persisted = await prisma.order.findUniqueOrThrow({
      where: { id: pending.id },
      include: { reservation: true }
    });
    expect(persisted.status).toBe("pending");
    expect(persisted.reservation?.status).toBe("active");
  });
});
