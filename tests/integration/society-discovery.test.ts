import { expect, test } from "vitest";
import { prisma } from "@/lib/db";
import {
  createMember,
  createOrganisationAccount,
  createOrganisationStaff,
  createEvent,
  createOrder,
} from "@/tests/helpers/test-data";
import {
  discoveryInput,
  discoverOrganisations,
} from "@/lib/organisations/discovery";
import { setSocietyJoin } from "@/lib/organisations/join";
import { GET } from "@/app/api/public/organisations/search/route";
import { GET as privateSearch } from "@/app/api/orgs/search/route";
import { POST as joinRoute } from "@/app/api/orgs/[orgSlug]/join/route";
import { POST as leaveRoute } from "@/app/api/orgs/[orgSlug]/leave/route";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { setMockSession } from "@/tests/helpers/auth";
test("anonymous discovery is bounded and public-safe with stable same-name cursors", async () => {
  const orgs = await Promise.all(
    Array.from({ length: 5 }, () =>
      createOrganisationAccount({ name: "Cursor society", stripeReady: true }),
    ),
  );
  const visible = await createEvent({
    organisationId: orgs[0].organisation.id,
    status: "published",
  });
  const hidden = await createEvent({
    organisationId: orgs[0].organisation.id,
    status: "draft",
  });
  let cursor: string | null = null;
  const ids: string[] = [];
  do {
    const params = new URLSearchParams({ q: "Cursor society", limit: "2" });
    if (cursor) params.set("cursor", cursor);
    const page = await discoverOrganisations(discoveryInput(params));
    expect(page.organisations.length).toBeLessThanOrEqual(2);
    ids.push(...page.organisations.map((row) => row.id));
    cursor = page.pageInfo.nextCursor;
  } while (cursor);
  expect(ids).toEqual(orgs.map((row) => row.organisation.id).sort());
  expect(new Set(ids).size).toBe(5);
  const response = await GET(
    jsonRequest(
      "http://localhost/api/public/organisations/search?q=Cursor%20society",
    ),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  const raw = JSON.stringify(body);
  expect(raw).toContain(visible.id);
  expect(raw).not.toContain(hidden.id);
  expect(raw).not.toContain("stripe");
  expect(raw).not.toContain("accountUserId");
  expect(raw).not.toContain("joined");
  expect(raw).not.toContain(orgs[0].user.email);
  for (const query of [
    "limit=0",
    "limit=51",
    `q=${"a".repeat(121)}`,
    "q=%00",
    "cursor=not-json",
    `cursor=${"A".repeat(2501)}`,
  ])
    expect(
      (
        await GET(
          jsonRequest(
            `http://localhost/api/public/organisations/search?${query}`,
          ),
        )
      ).status,
    ).toBe(400);
  const first = await discoverOrganisations(
    discoveryInput(new URLSearchParams({ q: "Cursor society", limit: "1" })),
  );
  expect(
    (
      await GET(
        jsonRequest(
          `http://localhost/api/public/organisations/search?q=Other&cursor=${first.pageInfo.nextCursor}`,
        ),
      )
    ).status,
  ).toBe(400);
});
test("search treats wildcard input literally and private search keeps its compatibility envelope", async () => {
  const own = await createOrganisationAccount({ name: "Literal 50%_ society" });
  const member = await createMember();
  expect(
    (
      await discoverOrganisations(
        discoveryInput(new URLSearchParams({ q: "50%_" })),
      )
    ).organisations.map((row) => row.id),
  ).toEqual([own.organisation.id]);
  expect(
    (
      await discoverOrganisations(
        discoveryInput(new URLSearchParams({ q: "<script>" })),
      )
    ).organisations,
  ).toHaveLength(0);
  await setSocietyJoin(member, own.organisation.slug, true);
  setMockSession({ ...member, userId: member.id });
  const response = await privateSearch(
    jsonRequest("http://localhost/api/orgs/search?q=Literal"),
  );
  expect((await response.json()).organisations).toEqual([
    {
      id: own.organisation.id,
      name: own.organisation.name,
      slug: own.organisation.slug,
      joined: true,
    },
  ]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const paged = await privateSearch(
    jsonRequest("http://localhost/api/orgs/search?q=Literal&limit=1"),
  );
  expect((await paged.json()).pageInfo).toMatchObject({
    limit: 1,
    hasNextPage: false,
    nextCursor: null,
  });
});
test("join/leave serialise caller relationships without changing staff, purchases or other users", async () => {
  const own = await createOrganisationAccount();
  const member = await createMember();
  const other = await createMember();
  const staff = await createOrganisationStaff({
    organisationId: own.organisation.id,
    userId: member.id,
    role: "event_manager",
  });
  const event = await createEvent({
    organisationId: own.organisation.id,
    status: "published",
  });
  const order = await createOrder({
    organisationId: own.organisation.id,
    eventId: event.id,
    ticketTypeId: event.ticketTypes[0].id,
    userId: member.id,
    status: "paid",
    paidAt: new Date(),
  });
  const ticket = await prisma.ticket.create({
    data: {
      orderId: order.id,
      organisationId: own.organisation.id,
      eventId: event.id,
      ticketTypeId: event.ticketTypes[0].id,
    },
  });
  await Promise.all([
    setSocietyJoin(member, own.organisation.slug, true),
    setSocietyJoin(member, own.organisation.slug, true),
    setSocietyJoin(other, own.organisation.slug, true),
  ]);
  expect(
    await prisma.organisationMember.count({
      where: { userId: member.id, organisationId: own.organisation.id },
    }),
  ).toBe(1);
  await Promise.all([
    setSocietyJoin(member, own.organisation.slug, false),
    setSocietyJoin(member, own.organisation.slug, true),
  ]);
  await setSocietyJoin(member, own.organisation.slug, false);
  await setSocietyJoin(member, own.organisation.slug, false);
  expect(
    await prisma.organisationMember.count({
      where: { userId: member.id, organisationId: own.organisation.id },
    }),
  ).toBe(0);
  expect(
    await prisma.organisationMember.count({
      where: { userId: other.id, organisationId: own.organisation.id },
    }),
  ).toBe(1);
  expect(
    await prisma.organisationStaff.findUnique({ where: { id: staff.id } }),
  ).toEqual(staff);
  expect(
    (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status,
  ).toBe("paid");
  expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).toEqual(
    ticket,
  );
  await prisma.user.update({
    where: { id: member.id },
    data: { emailVerifiedAt: null },
  });
  await expect(
    setSocietyJoin(member, own.organisation.slug, true),
  ).rejects.toThrow("Verify");
  await setSocietyJoin(member, own.organisation.slug, false);
  await prisma.user.update({
    where: { id: member.id },
    data: { authVersion: { increment: 1 } },
  });
  await expect(
    setSocietyJoin(member, own.organisation.slug, false),
  ).rejects.toThrow("Authentication");
  await expect(
    setSocietyJoin(own.user, own.organisation.slug, true),
  ).rejects.toThrow("Account role");
});
test("join transport denies anonymous, unverified and foreign-origin requests and never accepts a user override", async () => {
  const own = await createOrganisationAccount();
  const member = await createMember();
  const other = await createMember();
  const context = routeContext({ orgSlug: own.organisation.slug });
  expect(
    (await joinRoute(jsonRequest("http://localhost", {}), context)).status,
  ).toBe(401);
  setMockSession({ ...member, userId: member.id });
  expect(
    (
      await joinRoute(
        jsonRequest(
          "http://localhost",
          {},
          { headers: { origin: "https://foreign.example" } },
        ),
        context,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await joinRoute(
        jsonRequest("http://localhost", { userId: other.id }),
        context,
      )
    ).status,
  ).toBe(200);
  expect(
    await prisma.organisationMember.count({
      where: { userId: other.id, organisationId: own.organisation.id },
    }),
  ).toBe(0);
  await prisma.user.update({
    where: { id: member.id },
    data: { emailVerifiedAt: null },
  });
  expect(
    (await joinRoute(jsonRequest("http://localhost", {}), context)).status,
  ).toBe(403);
  expect(
    (
      await leaveRoute(
        jsonRequest("http://localhost", { userId: other.id }),
        context,
      )
    ).status,
  ).toBe(200);
});
