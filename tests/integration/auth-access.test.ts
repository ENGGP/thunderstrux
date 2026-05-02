import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrganisationAccount
} from "@/tests/helpers/test-data";
import { GET as getEvents } from "@/app/api/events/route";
import { POST as leaveOrganisation } from "@/app/api/orgs/[orgSlug]/leave/route";

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn()
}));

describe("auth and role access", () => {
  test("unauthenticated and member users cannot access organiser events API", async () => {
    const { organisation } = await createOrganisationAccount();

    clearMockSession();
    const unauthenticated = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(unauthenticated.status).toBe(401);
    expect(await parseJsonResponse(unauthenticated)).toMatchObject({
      error: { code: "UNAUTHORIZED", message: expect.any(String) }
    });

    const member = await createMember();
    setMockSession({
      userId: member.id,
      email: member.email,
      accountRole: "member"
    });

    const memberResponse = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(memberResponse.status).toBe(403);
    expect(await parseJsonResponse(memberResponse)).toMatchObject({
      error: { code: "FORBIDDEN", message: expect.any(String) }
    });
  });

  test("organisation accounts cannot use member-only leave action", async () => {
    const { user, organisation } = await createOrganisationAccount();
    setMockSession({
      userId: user.id,
      email: user.email,
      accountRole: "organisation"
    });

    const response = await leaveOrganisation(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );

    expect(response.status).toBe(403);
    expect(await parseJsonResponse(response)).toMatchObject({
      error: { code: "FORBIDDEN", message: expect.any(String) }
    });
  });

  test("proxy redirects organisation public event visits and member organiser visits", async () => {
    const { getToken } = await import("next-auth/jwt");
    const { proxy } = await import("@/proxy");
    const { organisation } = await createOrganisationAccount();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });

    vi.mocked(getToken).mockResolvedValueOnce({
      accountRole: "organisation"
    });
    const organisationRedirect = await proxy(
      new NextRequest(`http://localhost/events/${event.id}`)
    );
    expect(organisationRedirect.status).toBe(307);
    expect(organisationRedirect.headers.get("location")).toContain(
      `/dashboard/events/${event.id}`
    );

    vi.mocked(getToken).mockResolvedValueOnce({
      accountRole: "member"
    });
    const memberRedirect = await proxy(
      new NextRequest(`http://localhost/dashboard/events/${event.id}`)
    );
    expect(memberRedirect.status).toBe(307);
    expect(memberRedirect.headers.get("location")).toBe("http://localhost/");

    vi.mocked(getToken).mockResolvedValueOnce(null);
    const loginRedirect = await proxy(new NextRequest("http://localhost/dashboard"));
    expect(loginRedirect.status).toBe(307);
    expect(loginRedirect.headers.get("location")).toContain("/login");
  });

  test("member join rows do not grant management access", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    await prisma.organisationMember.create({
      data: {
        userId: member.id,
        organisationId: organisation.id,
        role: "org_owner"
      }
    });
    setMockSession({
      userId: member.id,
      email: member.email,
      accountRole: "member"
    });

    const response = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );

    expect(response.status).toBe(403);
  });
});
