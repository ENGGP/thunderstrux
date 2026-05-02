import { describe, expect, test } from "vitest";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import { GET as getOrders } from "@/app/api/orders/route";

describe("orders API", () => {
  test("default orders exclude pending while includeSystem exposes pending", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const paid = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });
    const pending = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const defaultResponse = await getOrders(jsonRequest("http://localhost/api/orders"));
    expect(defaultResponse.status).toBe(200);
    const defaultBody = await parseJsonResponse(defaultResponse);
    expect(defaultBody).toEqual([
      expect.objectContaining({
        eventId: event.id,
        eventTitle: event.title,
        orders: [expect.objectContaining({ id: paid.id, status: "paid" })]
      })
    ]);
    expect(JSON.stringify(defaultBody)).not.toContain(pending.id);

    const systemResponse = await getOrders(
      jsonRequest("http://localhost/api/orders?includeSystem=true&status=pending")
    );
    expect(systemResponse.status).toBe(200);
    const systemBody = await parseJsonResponse(systemResponse);
    expect(systemBody[0].orders).toEqual([
      expect.objectContaining({
        id: pending.id,
        status: "pending",
        ticketType: ticketType.name,
        quantity: 1,
        totalAmount: ticketType.price,
        buyerEmail: member.email
      })
    ]);
  });

  test("status filters and member denial work", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "expired",
      unitPrice: ticketType.price
    });
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      failedAt: new Date(),
      failureReason: "test",
      unitPrice: ticketType.price
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const expired = await getOrders(jsonRequest("http://localhost/api/orders?status=expired"));
    expect(expired.status).toBe(200);
    expect((await parseJsonResponse(expired))[0].orders).toEqual([
      expect.objectContaining({ status: "expired" })
    ]);

    const failed = await getOrders(jsonRequest("http://localhost/api/orders?status=failed"));
    expect(failed.status).toBe(200);
    expect((await parseJsonResponse(failed))[0].orders).toEqual([
      expect.objectContaining({ status: "failed", failureReason: "test" })
    ]);

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const denied = await getOrders(jsonRequest("http://localhost/api/orders"));
    expect(denied.status).toBe(403);
  });
});
