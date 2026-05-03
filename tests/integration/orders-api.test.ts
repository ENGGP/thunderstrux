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
import { GET as getOrderDetail } from "@/app/api/orders/[orderId]/route";
import { PATCH as markManualRefund } from "@/app/api/orders/[orderId]/refund-manual/route";
import { routeContext } from "@/tests/helpers/http";
import { prisma } from "@/lib/db";

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

  test("organiser can fetch own order detail", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember({
      email: "buyer-detail@example.com"
    });
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      quantity: 2,
      paidAt: new Date("2026-05-01T10:00:00.000Z"),
      unitPrice: ticketType.price,
      stripeSessionId: "cs_test_order_detail"
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await getOrderDetail(
      jsonRequest(`http://localhost/api/orders/${order.id}`),
      routeContext({ orderId: order.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);

    expect(body.order).toEqual(
      expect.objectContaining({
        id: order.id,
        status: "paid",
        quantity: 2,
        unitPrice: ticketType.price,
        totalAmount: ticketType.price * 2,
        stripeSessionId: "cs_test_order_detail",
        isManuallyRefunded: false,
        user: expect.objectContaining({
          email: member.email
        }),
        event: expect.objectContaining({
          id: event.id,
          title: event.title
        }),
        ticketType: expect.objectContaining({
          name: ticketType.name
        })
      })
    );
  });

  test("organiser cannot fetch another organisation order", async () => {
    const { user } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: other.organisation.id });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: other.organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await getOrderDetail(
      jsonRequest(`http://localhost/api/orders/${order.id}`),
      routeContext({ orderId: order.id })
    );

    expect(response.status).toBe(404);
  });

  test("member cannot fetch order detail", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const response = await getOrderDetail(
      jsonRequest(`http://localhost/api/orders/${order.id}`),
      routeContext({ orderId: order.id })
    );

    expect(response.status).toBe(403);
  });

  test("manual refund flag updates own order without changing payment status", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await markManualRefund(
      jsonRequest(`http://localhost/api/orders/${order.id}`, undefined, {
        method: "PATCH"
      }),
      routeContext({ orderId: order.id })
    );
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);
    expect(body.order).toEqual({
      id: order.id,
      isManuallyRefunded: true
    });

    const updated = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      select: {
        status: true,
        isManuallyRefunded: true,
        paidAt: true
      }
    });

    expect(updated.status).toBe("paid");
    expect(updated.isManuallyRefunded).toBe(true);
    expect(updated.paidAt).toEqual(order.paidAt);
  });
});
