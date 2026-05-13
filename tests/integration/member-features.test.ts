import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { encodeTimestampCursor } from "@/lib/pagination/cursor";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import { GET as searchOrganisations } from "@/app/api/orgs/search/route";
import { POST as joinOrganisationRoute } from "@/app/api/orgs/[orgSlug]/join/route";
import { POST as leaveOrganisationRoute } from "@/app/api/orgs/[orgSlug]/leave/route";
import MyTicketsPage from "@/app/tickets/page";

async function renderTicketsPage(
  searchParams: {
    limit?: string;
    cursor?: string;
    direction?: string;
  } = {}
) {
  const element = await MyTicketsPage({
    searchParams: Promise.resolve(searchParams)
  });

  return renderToStaticMarkup(element);
}

describe("member features", () => {
  test("member can search, join, leave, and leave idempotently", async () => {
    const { organisation } = await createOrganisationAccount({
      name: "Integration Member Org",
      slug: "integration-member-org"
    });
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });

    const search = await searchOrganisations(
      jsonRequest("http://localhost/api/orgs/search?q=Integration")
    );
    expect(search.status).toBe(200);
    expect(await parseJsonResponse(search)).toEqual({
      organisations: [
        {
          id: organisation.id,
          name: organisation.name,
          slug: organisation.slug,
          joined: false
        }
      ]
    });

    const join = await joinOrganisationRoute(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/join`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(join.status).toBe(200);
    expect(await parseJsonResponse(join)).toMatchObject({
      organisation: {
        id: organisation.id,
        joined: true
      }
    });
    await expect(prisma.organisationMember.count()).resolves.toBe(2);

    const leave = await leaveOrganisationRoute(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(leave.status).toBe(200);
    expect(await parseJsonResponse(leave)).toMatchObject({
      organisation: {
        id: organisation.id,
        joined: false
      }
    });

    const secondLeave = await leaveOrganisationRoute(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(secondLeave.status).toBe(200);
    await expect(
      prisma.organisationMember.findUnique({
        where: {
          userId_organisationId: {
            userId: member.id,
            organisationId: organisation.id
          }
        }
      })
    ).resolves.toBeNull();
  });

  test("organisation account cannot leave owned organisation", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    const response = await leaveOrganisationRoute(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );

    expect(response.status).toBe(403);
    await expect(
      prisma.organisation.findUnique({ where: { id: organisation.id } })
    ).resolves.toMatchObject({ accountUserId: user.id });
  });

  test("ticket history data contains paid orders only", async () => {
    const { organisation } = await createOrganisationAccount();
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
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "pending",
      unitPrice: ticketType.price
    });
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
    await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "failed",
      paidAt: new Date(),
      failedAt: new Date(),
      failureReason: "inventory_unavailable_after_payment",
      requiresCompensationReview: true,
      fulfilmentFailedAt: new Date(),
      fulfilmentFailureReason: "inventory_unavailable_after_payment",
      unitPrice: ticketType.price
    });

    const ticketOrders = await prisma.order.findMany({
      where: {
        userId: member.id,
        status: "paid"
      },
      select: { id: true, status: true }
    });

    expect(ticketOrders).toEqual([{ id: paid.id, status: "paid" }]);
  });

  test("tickets page redirects unauthenticated and organisation accounts", async () => {
    clearMockSession();
    await expect(renderTicketsPage()).rejects.toThrow("NEXT_REDIRECT");

    const { user } = await createOrganisationAccount();
    setMockSession({
      userId: user.id,
      email: user.email,
      accountRole: "organisation"
    });

    await expect(renderTicketsPage()).rejects.toThrow("NEXT_REDIRECT");
  });

  test("tickets page paginates paid orders with stable same-createdAt cursors", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    setMockSession({
      userId: member.id,
      email: member.email,
      accountRole: "member"
    });
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Member Wallet Pagination Event"
    });
    const ticketType = event.ticketTypes[0];
    const sharedCreatedAt = new Date("2026-05-13T10:00:00.000Z");

    for (let index = 1; index <= 3; index += 1) {
      await createOrder({
        organisationId: organisation.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        userId: member.id,
        status: "paid",
        paidAt: sharedCreatedAt,
        createdAt: sharedCreatedAt,
        stripeSessionId: `cs_member_wallet_${index}`,
        unitPrice: ticketType.price
      });
    }

    const orderedOrders = await prisma.order.findMany({
      where: {
        userId: member.id,
        status: "paid"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        createdAt: true
      }
    });
    const firstPage = await renderTicketsPage({ limit: "2" });

    expect(firstPage).toContain(orderedOrders[0].id);
    expect(firstPage).toContain(orderedOrders[1].id);
    expect(firstPage).not.toContain(orderedOrders[2].id);
    expect(firstPage).toContain("Ticket pagination");
    expect(firstPage).toContain("direction=next");
    expect(firstPage).toContain("limit=2");

    const nextCursor = encodeTimestampCursor("createdAt", orderedOrders[1]);
    const secondPage = await renderTicketsPage({
      limit: "2",
      cursor: nextCursor,
      direction: "next"
    });

    expect(secondPage).not.toContain(orderedOrders[0].id);
    expect(secondPage).not.toContain(orderedOrders[1].id);
    expect(secondPage).toContain(orderedOrders[2].id);
    expect(secondPage).toContain("direction=prev");

    const previousCursor = encodeTimestampCursor("createdAt", orderedOrders[2]);
    const previousPage = await renderTicketsPage({
      limit: "2",
      cursor: previousCursor,
      direction: "prev"
    });

    expect(previousPage).toContain(orderedOrders[0].id);
    expect(previousPage).toContain(orderedOrders[1].id);
    expect(previousPage).not.toContain(orderedOrders[2].id);
  });

  test("tickets page ignores invalid pagination params and shows first page warning", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    setMockSession({
      userId: member.id,
      email: member.email,
      accountRole: "member"
    });
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

    const invalidLimitHtml = await renderTicketsPage({ limit: "0" });
    expect(invalidLimitHtml).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(invalidLimitHtml).toContain(paid.id);

    const invalidCursorHtml = await renderTicketsPage({
      cursor: "not-a-valid-cursor"
    });
    expect(invalidCursorHtml).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(invalidCursorHtml).toContain(paid.id);

    const invalidDirectionHtml = await renderTicketsPage({
      direction: "backwards"
    });
    expect(invalidDirectionHtml).toContain(
      "Invalid pagination parameters were ignored. Showing the first page."
    );
    expect(invalidDirectionHtml).toContain(paid.id);
  });
});
