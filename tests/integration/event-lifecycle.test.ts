import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  futureDate
} from "@/tests/helpers/test-data";
import { POST as createEventRoute } from "@/app/api/events/route";
import {
  DELETE as deleteEventRoute,
  GET as getEventRoute,
  PATCH as updateEventRoute
} from "@/app/api/events/[eventId]/route";
import { PATCH as publishEventRoute } from "@/app/api/events/[eventId]/publish/route";
import { heldMoney } from "@/lib/payouts/release";
import {
  eventTicketTypeMetrics,
  ticketMetrics
} from "@/lib/analytics/metrics";

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
    // Ignored on create (events always start as drafts); edits compare it.
    status: "published",
    version: 1,
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
        status: "draft",
        visibility: "public",
        salesCloseAt: createBody.event.startTime,
        version: 1,
        ticketTypes: [expect.objectContaining({ id: expect.any(String) })]
      }
    });

    const event = createBody.event;
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "event.created", targetId: event.id } }))
      .toMatchObject({ organisationId: organisation.id, actorUserId: user.id, metadata: { title: "Integration Event" } });
    const updatePayload = {
      ...eventPayload(organisation.id, {
        title: "Integration Event Updated",
        version: event.version,
        ticketTypes: [
          {
            id: event.ticketTypes[0].id,
            name: "General Updated",
            price: 1800,
            quantity: 12,
            expectedQuantity: event.ticketTypes[0].quantity
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

  test("an edit without a ticket type list leaves them alone; a submitted list still replaces them", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const { event } = await parseJsonResponse(await createEventRoute(jsonRequest("http://localhost/api/events", eventPayload(organisation.id))));
    const { ticketTypes: _list, ...fields } = eventPayload(organisation.id);
    const edit = async (extra: Record<string, unknown>) => {
      const response = await updateEventRoute(jsonRequest(`http://localhost/api/events/${event.id}`, { ...fields, ...extra }, { method: "PATCH" }), routeContext({ eventId: event.id }));
      expect(response.status).toBe(200);
      return (await parseJsonResponse(response)).event;
    };

    const kept = await edit({ title: "New title", version: 1 });
    expect(kept.ticketTypes).toMatchObject([{ id: event.ticketTypes[0].id, name: "General", quantity: 10 }]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "event.updated", targetId: event.id } });
    expect(JSON.stringify(audit.metadata)).not.toContain("ticketTypes");

    expect((await edit({ title: "New title", version: 2, ticketTypes: [] })).ticketTypes).toEqual([]);
  });

  // PAY-009: an event chooses its checkout hold, 5 to 59 minutes, as Humanitix hosts do.
  test("an event's checkout hold is 20 minutes by default, 5 to 59, kept when an edit leaves it out, and named in History", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const create = (extra: Record<string, unknown>) => createEventRoute(jsonRequest("http://localhost/api/events", { ...eventPayload(organisation.id), ...extra }));
    expect((await create({ checkoutHoldMinutes: 4 })).status).toBe(400);
    expect((await create({ checkoutHoldMinutes: 60 })).status).toBe(400);
    expect((await create({ checkoutHoldMinutes: 12.5 })).status).toBe(400);
    const { event } = await parseJsonResponse(await create({}));
    expect(event.checkoutHoldMinutes).toBe(20);

    const update = async (version: number, extra: Record<string, unknown>) => {
      const payload = eventPayload(organisation.id, {
        version,
        ticketTypes: [{ id: event.ticketTypes[0].id, name: event.ticketTypes[0].name, price: event.ticketTypes[0].price, quantity: event.ticketTypes[0].quantity, expectedQuantity: event.ticketTypes[0].quantity }]
      });
      const response = await updateEventRoute(jsonRequest(`http://localhost/api/events/${event.id}`, { ...payload, ...extra }, { method: "PATCH" }), routeContext({ eventId: event.id }));
      expect(response.status).toBe(200);
      return (await parseJsonResponse(response)).event;
    };
    const shorter = await update(event.version, { checkoutHoldMinutes: 10 });
    expect(shorter.checkoutHoldMinutes).toBe(10);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "event.updated", targetId: event.id }, orderBy: { createdAt: "desc" } });
    expect((audit.metadata as { changes: unknown[] }).changes).toContainEqual({ field: "checkoutHoldMinutes", before: 20, after: 10 });
    // Left out of an edit, the hold stays.
    expect((await update(shorter.version, { title: "Renamed" })).checkoutHoldMinutes).toBe(10);
  });

  test("missing and cross-tenant event read and update return the same safe 404", async () => {
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

    const read = (eventId: string) => getEventRoute(new Request(`http://localhost/api/events/${eventId}?orgId=${owned.organisation.id}`), routeContext({ eventId }));
    const [missingRead, crossTenantRead] = [await read("missing-event"), await read(otherEvent.id)];
    expect([missingRead.status, crossTenantRead.status]).toEqual([404, 404]);
    expect(await parseJsonResponse(crossTenantRead)).toEqual(await parseJsonResponse(missingRead));
  });

  test("ticket types are capped so one request cannot validate an unbounded list", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const ticketTypes = (count: number) => Array.from({ length: count }, (_item, index) => ({ name: `Type ${index}`, price: 1500, quantity: 10 }));

    const tooMany = await createEventRoute(jsonRequest("http://localhost/api/events", eventPayload(organisation.id, { ticketTypes: ticketTypes(51) })));
    expect(tooMany.status).toBe(400);
    const body = await parseJsonResponse(tooMany);
    expect(body.error.details).toEqual([expect.objectContaining({ path: ["ticketTypes"], message: "Up to 50 ticket types." })]);
    expect(await prisma.event.count({ where: { organisationId: organisation.id } })).toBe(0);

    // Invalid items past the cap still yield one issue, not one per item, even without a session.
    clearMockSession();
    const invalid = await createEventRoute(jsonRequest("http://localhost/api/events", eventPayload(organisation.id, { ticketTypes: Array.from({ length: 5000 }, () => ({})) })));
    expect(invalid.status).toBe(400);
    expect((await parseJsonResponse(invalid)).error.details).toHaveLength(1);

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const atLimit = await createEventRoute(jsonRequest("http://localhost/api/events", eventPayload(organisation.id, { ticketTypes: ticketTypes(50) })));
    expect(atLimit.status).toBe(201);
    expect((await parseJsonResponse(atLimit)).event.ticketTypes).toHaveLength(50);
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
      jsonRequest("http://localhost/api/events/missing-event/publish", { targetStatus: "published", version: 1 }, {
        method: "PATCH"
      }),
      routeContext({ eventId: "missing-event" })
    );
    const crossTenantResponse = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${otherEvent.id}/publish`, { targetStatus: "published", version: 1 }, {
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
    const { user, organisation } = await createOrganisationAccount({ stripeReady: true });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const noTicketEvent = await createEvent({
      organisationId: organisation.id,
      ticketTypes: []
    });
    const noTicketResponse = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${noTicketEvent.id}/publish`, { targetStatus: "published", version: 1 }, {
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
        { targetStatus: "published", version: 1 },
        { method: "PATCH" }
      ),
      routeContext({ eventId: zeroQuantityEvent.id })
    );
    expect(zeroQuantityResponse.status).toBe(400);

    const validEvent = await createEvent({ organisationId: organisation.id });
    const published = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${validEvent.id}/publish`, { targetStatus: "published", version: 1 }, {
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
      jsonRequest(`http://localhost/api/events/${event.id}/publish`, { targetStatus: "draft", version: event.version }, {
        method: "PATCH"
      }),
      routeContext({ eventId: event.id })
    );
    expect(response.status).toBe(400);
    expect(await parseJsonResponse(response)).toMatchObject({
      error: { code: "BAD_REQUEST", message: expect.any(String) }
    });
  });

  test("deletes an unsold event with expected response shape; one with orders is kept for its history", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const event = await createEvent({ organisationId: organisation.id });
    const sold = await createEvent({ organisationId: organisation.id });
    await createOrder({ organisationId: organisation.id, eventId: sold.id, ticketTypeId: sold.ticketTypes[0].id });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await deleteEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, undefined, {
        method: "DELETE"
      }),
      routeContext({ eventId: event.id })
    );

    expect(response.status).toBe(200);
    expect(await parseJsonResponse(response)).toEqual({ deleted: true });
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: "event.deleted", targetId: event.id } }))
      .toMatchObject({ organisationId: organisation.id, actorUserId: user.id, metadata: { title: event.title } });

    const refused = await deleteEventRoute(jsonRequest(`http://localhost/api/events/${sold.id}`, undefined, { method: "DELETE" }), routeContext({ eventId: sold.id }));
    expect(refused.status).toBe(400);
    expect(await prisma.event.count({ where: { id: sold.id } })).toBe(1);
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
      version: event.version,
      ticketTypes: [
        {
          id: soldTicketType.id,
          name: "Sold Renamed",
          price: 2000,
          quantity: 8,
          expectedQuantity: soldTicketType.quantity
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

  test("an edit can't move the end earlier into the past, which would release held ticket money (SEC-004)", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date() });
    const edit = (startTime: Date, endTime: Date, version: number) => updateEventRoute(jsonRequest(`http://localhost/api/events/${event.id}`, {
      organisationId: organisation.id, title: event.title, description: event.description, location: event.location, version,
      startTime: startTime.toISOString(), endTime: endTime.toISOString(), salesCloseAt: new Date(startTime.getTime() - 60_000).toISOString(),
      ticketTypes: event.ticketTypes.map((type) => ({ id: type.id, name: type.name, price: type.price, quantity: type.quantity, expectedQuantity: type.quantity }))
    }, { method: "PATCH" }), routeContext({ eventId: event.id }));

    const hour = 3_600_000;
    const past = await edit(new Date(Date.now() - 3 * hour), new Date(Date.now() - hour), event.version);
    expect(past.status).toBe(400);
    expect((await parseJsonResponse(past)).error.details).toEqual([expect.objectContaining({ path: ["endTime"], message: "Choose an end time after now" })]);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).endTime).toEqual(event.endTime);
    // Moving it later is still fine.
    const later = await edit(event.startTime, new Date(event.endTime.getTime() + hour), event.version);
    expect(later.status).toBe(200);
  });

  test("with no ticket active, moving the end earlier still holds the sale until 2 days after the latest end (SEC-032)", async () => {
    const { user, organisation } = await createOrganisationAccount({ stripeReady: true });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const hour = 3_600_000;
    const day = 24 * hour;
    const created = await createEvent({ organisationId: organisation.id, status: "published" });
    const end = new Date(Date.now() + 5 * day);
    const event = await prisma.event.update({ where: { id: created.id }, data: { startTime: new Date(end.getTime() - 2 * hour), salesCloseAt: new Date(end.getTime() - 3 * hour), endTime: end }, include: { ticketTypes: true } });
    // A paid sale whose tickets were all voided ("refunded outside"), so no ticket is active.
    const order = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date() });
    await prisma.order.update({ where: { id: order.id }, data: { sellerStripeAccountId: organisation.stripeAccountId, feeAmount: 100, isManuallyRefunded: true } });
    const edit = (startTime: Date, endTime: Date, version: number) => updateEventRoute(jsonRequest(`http://localhost/api/events/${event.id}`, {
      organisationId: organisation.id, title: event.title, description: event.description, location: event.location, version,
      startTime: startTime.toISOString(), endTime: endTime.toISOString(), salesCloseAt: new Date(startTime.getTime() - 60_000).toISOString(),
      ticketTypes: event.ticketTypes.map((type) => ({ id: type.id, name: type.name, price: type.price, quantity: type.quantity, expectedQuantity: type.quantity }))
    }, { method: "PATCH" }), routeContext({ eventId: event.id }));

    const soon = new Date(Date.now() + hour);
    expect((await edit(new Date(soon.getTime() - hour / 2), soon, event.version)).status).toBe(200);
    // No ticket holder to tell, so no change is recorded, but the latest end is.
    expect(await prisma.eventChange.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).toMatchObject({ endTime: soon, latestEndTime: end });
    // Moving it later and back again never lowers it.
    expect((await edit(new Date(end.getTime() + hour), new Date(end.getTime() + 2 * hour), event.version + 1)).status).toBe(200);
    expect((await edit(new Date(soon.getTime() - hour / 2), soon, event.version + 2)).status).toBe(200);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).latestEndTime).toEqual(new Date(end.getTime() + 2 * hour));

    const share = order.totalAmount - 100;
    const accountId = organisation.stripeAccountId as string;
    expect((await heldMoney(organisation.id, accountId, new Date(soon.getTime() + 2 * day + hour))).total).toBe(share);
    expect((await heldMoney(organisation.id, accountId, new Date(end.getTime() + 2 * day + 3 * hour))).total).toBe(0);
  });

  test("event analytics use event ownership when order organisation is inconsistent", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
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

    const full = { financial: true };
    expect(await eventTicketTypeMetrics(organisation.id, event.id, full)).toEqual([
      expect.objectContaining({ id: ticketType.id, gross: ticketType.price * 2 })
    ]);
    const range = { from: "2026-05-01", to: "2026-05-01", bucket: "day" as const, timeZone: "Australia/Brisbane" };
    expect((await ticketMetrics(organisation.id, range, full, event.id)).series).toEqual([
      expect.objectContaining({ start: "2026-05-01", gross: ticketType.price * 2 })
    ]);
    // The order's own society field is not authority: the other society sees nothing.
    expect((await ticketMetrics(other.organisation.id, range, full)).totals.gross).toBe(0);
  });
});
