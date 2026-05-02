import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
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

    const ticketOrders = await prisma.order.findMany({
      where: {
        userId: member.id,
        status: "paid"
      },
      select: { id: true, status: true }
    });

    expect(ticketOrders).toEqual([{ id: paid.id, status: "paid" }]);
  });
});
