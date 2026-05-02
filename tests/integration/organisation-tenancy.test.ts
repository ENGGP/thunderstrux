import { describe, expect, test } from "vitest";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import {
  createEvent,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getOrders } from "@/app/api/orders/route";

describe("organisation tenancy", () => {
  test("organisation event API is scoped to owned organisation", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    await createEvent({ organisationId: owned.organisation.id, title: "Owned Event" });
    await createEvent({ organisationId: other.organisation.id, title: "Other Event" });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });

    const ownedResponse = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${owned.organisation.id}`)
    );
    expect(ownedResponse.status).toBe(200);
    const ownedBody = await parseJsonResponse(ownedResponse);
    expect(ownedBody).toMatchObject({
      events: expect.any(Array)
    });
    expect(ownedBody.events).toHaveLength(1);
    expect(ownedBody.events[0]).toMatchObject({
      organisationId: owned.organisation.id,
      title: "Owned Event"
    });

    const otherResponse = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${other.organisation.id}`)
    );
    expect(otherResponse.status).toBe(403);
    expect(JSON.stringify(await parseJsonResponse(otherResponse))).not.toContain(
      other.organisation.id
    );
  });

  test("orders event filter validates ownership before filtering", async () => {
    const owned = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const ownedEvent = await createEvent({ organisationId: owned.organisation.id });
    const otherEvent = await createEvent({ organisationId: other.organisation.id });
    const ownedTicketType = ownedEvent.ticketTypes[0];
    await createOrder({
      organisationId: owned.organisation.id,
      eventId: ownedEvent.id,
      ticketTypeId: ownedTicketType.id,
      status: "paid",
      paidAt: new Date()
    });

    setMockSession({
      userId: owned.user.id,
      email: owned.user.email,
      accountRole: "organisation"
    });

    const filtered = await getOrders(
      jsonRequest(`http://localhost/api/orders?eventId=${ownedEvent.id}`)
    );
    expect(filtered.status).toBe(200);
    const body = await parseJsonResponse(filtered);
    expect(body).toEqual([
      expect.objectContaining({
        eventId: ownedEvent.id,
        eventTitle: ownedEvent.title,
        orders: expect.any(Array)
      })
    ]);

    const wrongEvent = await getOrders(
      jsonRequest(`http://localhost/api/orders?eventId=${otherEvent.id}`)
    );
    expect(wrongEvent.status).toBe(403);
    expect(JSON.stringify(await parseJsonResponse(wrongEvent))).not.toContain(
      otherEvent.title
    );
  });
});
