import { describe, expect, test } from "vitest";
import { POST as createEventRoute } from "@/app/api/events/route";
import { PATCH as updateEventRoute } from "@/app/api/events/[eventId]/route";
import { PATCH as publishEventRoute } from "@/app/api/events/[eventId]/publish/route";
import { PATCH as salesEventRoute } from "@/app/api/events/[eventId]/sales/route";
import { prisma } from "@/lib/db";
import { getDashboardEvent } from "@/lib/events/event-lifecycle";
import { getPublishedEventDetail, getPublishedEvents } from "@/lib/events/public-events";
import { CheckoutCreationError, createEventCheckout } from "@/lib/payments/checkout-creation";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  futureDate,
  unique
} from "@/tests/helpers/test-data";

async function signedInOrganiser(stripeReady = false) {
  const owner = await createOrganisationAccount({ stripeReady });
  setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
  return owner;
}

function publish(eventId: string, body: unknown) {
  return publishEventRoute(
    jsonRequest(`http://localhost/api/events/${eventId}/publish`, body, { method: "PATCH" }),
    routeContext({ eventId })
  );
}

function setSales(eventId: string, body: unknown) {
  return salesEventRoute(
    jsonRequest(`http://localhost/api/events/${eventId}/sales`, body, { method: "PATCH" }),
    routeContext({ eventId })
  );
}

function editPayload(event: { organisationId: string; title: string; description: string; location: string; startTime: Date; endTime: Date }, overrides: Record<string, unknown>) {
  return {
    organisationId: event.organisationId,
    title: event.title,
    description: event.description,
    location: event.location,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    ...overrides
  };
}

function edit(eventId: string, body: unknown) {
  return updateEventRoute(
    jsonRequest(`http://localhost/api/events/${eventId}`, body, { method: "PATCH" }),
    routeContext({ eventId })
  );
}

describe("event policy, readiness and explicit transitions", () => {
  test("a create request asking for a published event still creates a draft that closes sales at the start", async () => {
    const { organisation } = await signedInOrganiser(true);
    const startTime = futureDate(10, 18);
    const response = await createEventRoute(jsonRequest("http://localhost/api/events", {
      organisationId: organisation.id,
      title: "Direct API",
      description: "Created by a direct call",
      location: "Hall",
      startTime: startTime.toISOString(),
      endTime: new Date(startTime.getTime() + 3600000).toISOString(),
      status: "published",
      capacity: 80,
      ticketTypes: [{ name: "General", price: 1000, quantity: 50 }]
    }));
    expect(response.status).toBe(201);
    const { event } = await parseJsonResponse(response);
    expect(event).toMatchObject({ status: "draft", capacity: 80, visibility: "public", saleState: "open", version: 1 });
    expect(event.salesCloseAt).toBe(startTime.toISOString());

    const membersOnly = await createEventRoute(jsonRequest("http://localhost/api/events", {
      organisationId: organisation.id,
      title: "Members only",
      description: "Not yet",
      location: "Hall",
      startTime: startTime.toISOString(),
      endTime: new Date(startTime.getTime() + 3600000).toISOString(),
      visibility: "members_only"
    }));
    // Members-only drafts save; publishing them needs a plan (members-only-events.test.ts).
    expect(membersOnly.status).toBe(201);
    expect((await parseJsonResponse(membersOnly)).event).toMatchObject({ status: "draft", visibility: "members_only" });
  });

  test("readiness blocks paid-only events without payments, lets free tickets publish, and needs a future sales window", async () => {
    const { organisation } = await signedInOrganiser(false);
    const paidOnly = await createEvent({ organisationId: organisation.id });
    const blocked = await publish(paidOnly.id, { targetStatus: "published", version: 1 });
    expect(blocked.status).toBe(400);
    expect(await parseJsonResponse(blocked)).toMatchObject({
      error: { code: "BAD_REQUEST", details: [{ path: ["ticketTypes"], message: expect.stringContaining("Set up payments") }] }
    });
    expect((await getDashboardEvent(organisation.id, paidOnly.id)).publishBlocker).toContain("Set up payments");

    // Free tickets need no payment setup, so a mixed or free-only event publishes
    // and sells its free tickets while the paid ones wait for Stripe.
    for (const ticketTypes of [
      [{ name: "Free entry", price: 0, quantity: 20 }, { name: "Supporter", price: 2000, quantity: 5 }],
      [{ name: "Free entry", price: 0, quantity: 20 }]
    ]) {
      const event = await createEvent({ organisationId: organisation.id, ticketTypes });
      expect((await publish(event.id, { targetStatus: "published", version: 1 })).status).toBe(200);
    }

    const closedWindow = await createEvent({
      organisationId: organisation.id,
      salesCloseAt: new Date(Date.now() - 60000),
      ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }]
    });
    const late = await publish(closedWindow.id, { targetStatus: "published", version: 1 });
    expect(late.status).toBe(400);
    expect(JSON.stringify(await parseJsonResponse(late))).toContain("Move the sales close time");
  });

  test("a repeated publish is a no-op and a stale version is a conflict", async () => {
    const { organisation } = await signedInOrganiser(true);
    const event = await createEvent({ organisationId: organisation.id });

    expect((await publish(event.id, { targetStatus: "published", version: 1 })).status).toBe(200);
    const replay = await publish(event.id, { targetStatus: "published", version: 1 });
    expect(replay.status).toBe(200);
    expect((await parseJsonResponse(replay)).event).toMatchObject({ status: "published", version: 2 });
    expect(await prisma.auditLog.count({ where: { targetId: event.id, action: "event.published" } })).toBe(1);

    const stale = await publish(event.id, { targetStatus: "draft", version: 1 });
    expect(stale.status).toBe(409);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: event.id } })).status).toBe("published");
    expect((await publish(event.id, { targetStatus: "draft" })).status).toBe(400);
  });

  test("two edits from the same loaded version: one saves, the other gets a conflict", async () => {
    const { organisation } = await signedInOrganiser(true);
    const event = await createEvent({ organisationId: organisation.id });
    const [first, second] = await Promise.all([
      edit(event.id, editPayload(event, { title: "First", version: 1 })),
      edit(event.id, editPayload(event, { title: "Second", version: 1 }))
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const saved = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(saved.version).toBe(2);
    expect(["First", "Second"]).toContain(saved.title);
  });

  test("closing sales keeps the event published and stops checkout; reopening needs a future close time", async () => {
    const { organisation } = await signedInOrganiser(true);
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const ticketTypeId = event.ticketTypes[0].id;

    const closed = await setSales(event.id, { saleState: "closed", version: 1 });
    expect(closed.status).toBe(200);
    expect((await parseJsonResponse(closed)).event).toMatchObject({ status: "published", saleState: "closed", version: 2 });
    expect((await getDashboardEvent(organisation.id, event.id)).salesOpen).toBe(false);
    await expect(createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId, quantity: 1, expectedUnitPrice: event.ticketTypes[0].price, idempotencyKey: unique("checkout") }))
      .rejects.toMatchObject({ kind: "sales_closed" });
    expect(await prisma.order.count({ where: { eventId: event.id } })).toBe(0);

    expect((await setSales(event.id, { saleState: "open", version: 2 })).status).toBe(200);

    await prisma.event.update({ where: { id: event.id }, data: { salesCloseAt: new Date(Date.now() - 60000), saleState: "closed", version: 4 } });
    const pastWindow = await setSales(event.id, { saleState: "open", version: 4 });
    expect(pastWindow.status).toBe(400);
    await prisma.event.update({ where: { id: event.id }, data: { saleState: "open" } });
    await expect(createEventCheckout({ userId: member.id, eventId: event.id, ticketTypeId, quantity: 1, expectedUnitPrice: event.ticketTypes[0].price, idempotencyKey: unique("checkout") }))
      .rejects.toBeInstanceOf(CheckoutCreationError);
    expect(await prisma.auditLog.count({ where: { targetId: event.id, action: { in: ["event.sales_closed", "event.sales_reopened"] } } })).toBe(2);
  });

  test("capacity cannot drop below tickets already issued", async () => {
    const { organisation } = await signedInOrganiser(true);
    const event = await createEvent({ organisationId: organisation.id, status: "published" });
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
      status: "paid",
      paidAt: new Date(),
      quantity: 2
    });
    for (const issueSequence of [1, 2]) {
      await prisma.ticket.create({
        data: { issueSequence, orderId: order.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, organisationId: organisation.id }
      });
    }
    const ticketTypes = [{ id: event.ticketTypes[0].id, name: "General", price: 1200, quantity: 8, expectedQuantity: event.ticketTypes[0].quantity }];

    const tooSmall = await edit(event.id, editPayload(event, { capacity: 1, version: 1, ticketTypes }));
    expect(tooSmall.status).toBe(400);
    expect(JSON.stringify(await parseJsonResponse(tooSmall))).toContain("2 tickets already issued or held");
    const enough = await edit(event.id, editPayload(event, { capacity: 2, version: 1, ticketTypes }));
    expect(enough.status).toBe(200);
    expect((await parseJsonResponse(enough)).event).toMatchObject({ capacity: 2, version: 2 });
  });

  test("unlisted events open by link but stay out of listings; members-only events stay hidden", async () => {
    const { organisation } = await signedInOrganiser(true);
    const member = await createMember();
    const listed = await createEvent({ organisationId: organisation.id, status: "published" });
    const unlisted = await createEvent({ organisationId: organisation.id, status: "published", visibility: "unlisted" });
    const membersOnly = await createEvent({ organisationId: organisation.id, status: "published", visibility: "members_only" });

    const ids = (await getPublishedEvents({ limit: 100 })).events.map((event) => event.id);
    expect(ids).toContain(listed.id);
    expect(ids).not.toContain(unlisted.id);
    expect(ids).not.toContain(membersOnly.id);
    expect(await getPublishedEventDetail(unlisted.id)).toMatchObject({ id: unlisted.id });
    expect(await getPublishedEventDetail(membersOnly.id)).toBeNull();
    await expect(createEventCheckout({ userId: member.id, eventId: membersOnly.id, ticketTypeId: membersOnly.ticketTypes[0].id, quantity: 1, expectedUnitPrice: membersOnly.ticketTypes[0].price, idempotencyKey: unique("checkout") }))
      .rejects.toMatchObject({ kind: "event_not_found" });
  });
});
