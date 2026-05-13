import { describe, expect, test, vi } from "vitest";
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
import { POST as resendTickets } from "@/app/api/orders/[orderId]/resend/route";
import { routeContext } from "@/tests/helpers/http";
import { prisma } from "@/lib/db";

describe("orders API", () => {
  function orderIds(body: { groups: Array<{ orders: Array<{ id: string }> }> }) {
    return body.groups.flatMap((group) => group.orders.map((order) => order.id));
  }

  function configureEmailEnv() {
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.EMAIL_FROM;

    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Thunderstrux <tickets@example.com>";

    return () => {
      if (previousApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousApiKey;
      }

      if (previousFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousFrom;
      }
    };
  }

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
    expect(defaultBody).toEqual({
      groups: [
        expect.objectContaining({
          eventId: event.id,
          eventTitle: event.title,
          orders: [expect.objectContaining({ id: paid.id, status: "paid" })]
        })
      ],
      pageInfo: expect.objectContaining({
        limit: 25,
        hasNextPage: false,
        hasPreviousPage: false
      })
    });
    expect(JSON.stringify(defaultBody)).not.toContain(pending.id);

    const systemResponse = await getOrders(
      jsonRequest("http://localhost/api/orders?includeSystem=true&status=pending")
    );
    expect(systemResponse.status).toBe(200);
    const systemBody = await parseJsonResponse(systemResponse);
    expect(systemBody.groups[0].orders).toEqual([
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

  test("default orders response is bounded and includes pageInfo", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];

    for (let index = 0; index < 27; index += 1) {
      await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "paid",
        paidAt: new Date(),
        unitPrice: ticketType.price,
        createdAt: new Date(`2026-05-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`)
      });
    }

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const response = await getOrders(jsonRequest("http://localhost/api/orders"));
    expect(response.status).toBe(200);
    const body = await parseJsonResponse(response);

    expect(orderIds(body)).toHaveLength(25);
    expect(body.pageInfo).toEqual(
      expect.objectContaining({
        limit: 25,
        hasNextPage: true,
        hasPreviousPage: false,
        nextCursor: expect.any(String)
      })
    );
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
    expect((await parseJsonResponse(expired)).groups[0].orders).toEqual([
      expect.objectContaining({ status: "expired" })
    ]);

    const failed = await getOrders(jsonRequest("http://localhost/api/orders?status=failed"));
    expect(failed.status).toBe(200);
    expect((await parseJsonResponse(failed)).groups[0].orders).toEqual([
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

  test("order pagination handles same createdAt rows with next and previous cursors", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const sharedCreatedAt = new Date("2026-05-13T10:00:00.000Z");
    const orders = [];

    for (let index = 0; index < 3; index += 1) {
      orders.push(
        await createOrder({
          organisationId: organisation.id,
          eventId: event.id,
          ticketTypeId: ticketType.id,
          userId: member.id,
          status: "paid",
          paidAt: new Date(),
          unitPrice: ticketType.price,
          createdAt: sharedCreatedAt
        })
      );
    }

    const expectedIds = orders
      .map((order) => order.id)
      .sort((left, right) => right.localeCompare(left));

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const firstResponse = await getOrders(
      jsonRequest("http://localhost/api/orders?limit=2")
    );
    expect(firstResponse.status).toBe(200);
    const firstBody = await parseJsonResponse(firstResponse);
    expect(orderIds(firstBody)).toEqual(expectedIds.slice(0, 2));
    expect(firstBody.pageInfo).toEqual(
      expect.objectContaining({
        limit: 2,
        hasNextPage: true,
        hasPreviousPage: false,
        nextCursor: expect.any(String)
      })
    );

    const secondResponse = await getOrders(
      jsonRequest(
        `http://localhost/api/orders?limit=2&cursor=${encodeURIComponent(
          firstBody.pageInfo.nextCursor
        )}&direction=next`
      )
    );
    expect(secondResponse.status).toBe(200);
    const secondBody = await parseJsonResponse(secondResponse);
    expect(orderIds(secondBody)).toEqual(expectedIds.slice(2));
    expect(secondBody.pageInfo.previousCursor).toEqual(expect.any(String));

    const previousResponse = await getOrders(
      jsonRequest(
        `http://localhost/api/orders?limit=2&cursor=${encodeURIComponent(
          secondBody.pageInfo.previousCursor
        )}&direction=prev`
      )
    );
    expect(previousResponse.status).toBe(200);
    expect(orderIds(await parseJsonResponse(previousResponse))).toEqual(
      expectedIds.slice(0, 2)
    );
  });

  test("invalid order pagination params return structured bad requests", async () => {
    const { user } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    for (const url of [
      "http://localhost/api/orders?limit=0",
      "http://localhost/api/orders?limit=101",
      "http://localhost/api/orders?direction=back",
      "http://localhost/api/orders?cursor=not-json"
    ]) {
      const response = await getOrders(jsonRequest(url));
      expect(response.status).toBe(400);
      await expect(parseJsonResponse(response)).resolves.toMatchObject({
        error: {
          code: "BAD_REQUEST"
        }
      });
    }
  });

  test("organiser order access uses event ownership when order organisation is inconsistent", async () => {
    const restoreEmailEnv = configureEmailEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { user, organisation } = await createOrganisationAccount();
      const other = await createOrganisationAccount();
      const member = await createMember({
        email: "event-owned-buyer@example.com"
      });
      const event = await createEvent({ organisationId: organisation.id });
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
      await prisma.ticket.create({
        data: {
          orderId: order.id,
          eventId: event.id,
          ticketTypeId: ticketType.id,
          organisationId: organisation.id
        }
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { ticketEmailSentAt: new Date("2026-05-01T10:00:00.000Z") }
      });

      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const listResponse = await getOrders(jsonRequest("http://localhost/api/orders"));
      expect(listResponse.status).toBe(200);
      expect(JSON.stringify(await parseJsonResponse(listResponse))).toContain(order.id);

      const detailResponse = await getOrderDetail(
        jsonRequest(`http://localhost/api/orders/${order.id}`),
        routeContext({ orderId: order.id })
      );
      expect(detailResponse.status).toBe(200);

      const refundResponse = await markManualRefund(
        jsonRequest(`http://localhost/api/orders/${order.id}`, undefined, {
          method: "PATCH"
        }),
        routeContext({ orderId: order.id })
      );
      expect(refundResponse.status).toBe(200);

      const resendResponse = await resendTickets(
        jsonRequest(`http://localhost/api/orders/${order.id}/resend`, undefined, {
          method: "POST"
        }),
        routeContext({ orderId: order.id })
      );
      expect(resendResponse.status).toBe(200);
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(
        prisma.emailOutbox.count({
          where: { orderId: order.id, mode: "manual", status: "pending" }
        })
      ).resolves.toBe(1);
    } finally {
      restoreEmailEnv();
      vi.unstubAllGlobals();
    }
  });

  test("organiser order access rejects event owned by another organisation", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: other.organisation.id });
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

    const listResponse = await getOrders(jsonRequest("http://localhost/api/orders"));
    expect(listResponse.status).toBe(200);
    expect(JSON.stringify(await parseJsonResponse(listResponse))).not.toContain(order.id);

    const detailResponse = await getOrderDetail(
      jsonRequest(`http://localhost/api/orders/${order.id}`),
      routeContext({ orderId: order.id })
    );
    expect(detailResponse.status).toBe(404);

    const refundResponse = await markManualRefund(
      jsonRequest(`http://localhost/api/orders/${order.id}`, undefined, {
        method: "PATCH"
      }),
      routeContext({ orderId: order.id })
    );
    expect(refundResponse.status).toBe(404);

    const resendResponse = await resendTickets(
      jsonRequest(`http://localhost/api/orders/${order.id}/resend`, undefined, {
        method: "POST"
      }),
      routeContext({ orderId: order.id })
    );
    expect(resendResponse.status).toBe(404);
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

  test("manual resend queues own paid order without provider I/O", async () => {
    const restoreEmailEnv = configureEmailEnv();
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const { user, organisation } = await createOrganisationAccount();
      const member = await createMember({ email: "resend-buyer@example.com" });
      const event = await createEvent({ organisationId: organisation.id });
      const ticketType = event.ticketTypes[0];
      const order = await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "paid",
        quantity: 1,
        paidAt: new Date(),
        unitPrice: ticketType.price
      });
      await prisma.ticket.create({
        data: {
          orderId: order.id,
          eventId: event.id,
          ticketTypeId: ticketType.id,
          organisationId: organisation.id
        }
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { ticketEmailSentAt: new Date("2026-05-01T10:00:00.000Z") }
      });

      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });
      const response = await resendTickets(
        jsonRequest(`http://localhost/api/orders/${order.id}/resend`, undefined, {
          method: "POST"
        }),
        routeContext({ orderId: order.id })
      );

      expect(response.status).toBe(200);
      expect(await parseJsonResponse(response)).toEqual({ queued: true });
      expect(fetchMock).not.toHaveBeenCalled();

      const updated = await prisma.order.findUniqueOrThrow({
        where: { id: order.id },
        select: {
          ticketEmailSentAt: true,
          ticketEmailResentAt: true,
          ticketEmailLastError: true,
          emailOutboxJobs: true
        }
      });
      expect(updated.ticketEmailSentAt).toEqual(
        new Date("2026-05-01T10:00:00.000Z")
      );
      expect(updated.ticketEmailResentAt).toBeNull();
      expect(updated.ticketEmailLastError).toBeNull();
      expect(updated.emailOutboxJobs).toHaveLength(1);
      expect(updated.emailOutboxJobs[0]).toMatchObject({
        mode: "manual",
        status: "pending",
        attempts: 0
      });
    } finally {
      restoreEmailEnv();
    }
  });

  test("manual resend rejects member, other organisation, and unpaid orders", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const paidOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });
    const failedOrder = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      failedAt: new Date(),
      unitPrice: ticketType.price
    });
    const other = await createOrganisationAccount();
    const otherEvent = await createEvent({ organisationId: other.organisation.id });
    const otherTicketType = otherEvent.ticketTypes[0];
    const otherOrder = await createOrder({
      organisationId: other.organisation.id,
      eventId: otherEvent.id,
      ticketTypeId: otherTicketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: otherTicketType.price
    });

    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });
    const memberDenied = await resendTickets(
      jsonRequest(`http://localhost/api/orders/${paidOrder.id}/resend`, undefined, {
        method: "POST"
      }),
      routeContext({ orderId: paidOrder.id })
    );
    expect(memberDenied.status).toBe(403);

    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    const otherDenied = await resendTickets(
      jsonRequest(`http://localhost/api/orders/${otherOrder.id}/resend`, undefined, {
        method: "POST"
      }),
      routeContext({ orderId: otherOrder.id })
    );
    expect(otherDenied.status).toBe(404);

    const unpaidDenied = await resendTickets(
      jsonRequest(`http://localhost/api/orders/${failedOrder.id}/resend`, undefined, {
        method: "POST"
      }),
      routeContext({ orderId: failedOrder.id })
    );
    expect(unpaidDenied.status).toBe(400);
  });

  test("manual resend queues even when provider is not configured", async () => {
    const previousApiKey = process.env.RESEND_API_KEY;
    const previousFrom = process.env.EMAIL_FROM;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;

    try {
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

      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });
      const response = await resendTickets(
        jsonRequest(`http://localhost/api/orders/${order.id}/resend`, undefined, {
          method: "POST"
        }),
        routeContext({ orderId: order.id })
      );
      expect(response.status).toBe(200);
      expect(await parseJsonResponse(response)).toEqual({ queued: true });

      await expect(
        prisma.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { ticketEmailLastError: true, emailOutboxJobs: true }
        })
      ).resolves.toEqual({
        ticketEmailLastError: null,
        emailOutboxJobs: [
          expect.objectContaining({
            mode: "manual",
            status: "pending"
          })
        ]
      });
    } finally {
      if (previousApiKey === undefined) {
        delete process.env.RESEND_API_KEY;
      } else {
        process.env.RESEND_API_KEY = previousApiKey;
      }

      if (previousFrom === undefined) {
        delete process.env.EMAIL_FROM;
      } else {
        process.env.EMAIL_FROM = previousFrom;
      }
    }
  });
});
