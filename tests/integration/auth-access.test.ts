import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { clearMockSession, setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrganisationAccount,
  createOrganisationStaff
} from "@/tests/helpers/test-data";
import { GET as getEvents } from "@/app/api/events/route";
import { GET as getOrders } from "@/app/api/orders/route";
import { POST as leaveOrganisation } from "@/app/api/orgs/[orgSlug]/leave/route";
import { POST as createStaffInvite } from "@/app/api/orgs/[orgSlug]/staff/invites/route";
import { PATCH as updateStaff } from "@/app/api/orgs/[orgSlug]/staff/[staffId]/route";
import { POST as acceptStaffInvite } from "@/app/api/staff/invites/accept/route";
import { hashStaffInviteToken } from "@/lib/staff/invites";

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

  test("proxy redirects organisation public event visits and protects logged-out dashboard visits", async () => {
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
    const memberDashboard = await proxy(
      new NextRequest(`http://localhost/dashboard/events/${event.id}`)
    );
    expect(memberDashboard.status).toBe(200);

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

  test("active organisation staff can manage events without organisation account role", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffUser = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      title: "Staff Managed Event"
    });
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffUser.id,
      role: "event_manager"
    });
    setMockSession({
      userId: staffUser.id,
      email: staffUser.email,
      accountRole: "member"
    });

    const response = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    const body = await parseJsonResponse(response);

    expect(response.status).toBe(200);
    expect(body.events).toEqual([
      expect.objectContaining({
        id: event.id,
        title: "Staff Managed Event"
      })
    ]);
  });

  test("revoked staff loses management access without signing out", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffUser = await createMember();
    const staff = await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffUser.id,
      role: "event_manager"
    });
    setMockSession({
      userId: staffUser.id,
      email: staffUser.email,
      accountRole: "member"
    });

    const allowed = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(allowed.status).toBe(200);

    await prisma.organisationStaff.update({
      where: { id: staff.id },
      data: {
        status: "revoked",
        revokedAt: new Date()
      }
    });

    const denied = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(denied.status).toBe(403);
  });

  test("revoked bootstrap owner does not regain access through accountUserId fallback", async () => {
    const { user: bootstrapOwner, organisation } = await createOrganisationAccount();
    const replacementOwner = await createMember();
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: replacementOwner.id,
      role: "owner"
    });
    await prisma.organisationStaff.update({
      where: {
        organisationId_userId: {
          organisationId: organisation.id,
          userId: bootstrapOwner.id
        }
      },
      data: {
        status: "revoked",
        revokedAt: new Date(),
        revokedById: replacementOwner.id
      }
    });
    setMockSession({
      userId: bootstrapOwner.id,
      email: bootstrapOwner.email,
      accountRole: "organisation"
    });

    const denied = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );

    expect(denied.status).toBe(403);
  });

  test("downgraded staff loses permissions without signing out", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffUser = await createMember();
    const staff = await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffUser.id,
      role: "event_manager"
    });
    setMockSession({
      userId: staffUser.id,
      email: staffUser.email,
      accountRole: "member"
    });

    const allowed = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(allowed.status).toBe(200);

    await prisma.organisationStaff.update({
      where: { id: staff.id },
      data: {
        role: "check_in_staff"
      }
    });

    const denied = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(denied.status).toBe(403);
  });

  test("event staff cannot access finance-only order reads", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffUser = await createMember();
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffUser.id,
      role: "event_manager"
    });
    setMockSession({
      userId: staffUser.id,
      email: staffUser.email,
      accountRole: "member"
    });

    const response = await getOrders(jsonRequest("http://localhost/api/orders"));

    expect(response.status).toBe(403);
  });

  test("finance staff cannot manage events", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffUser = await createMember();
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffUser.id,
      role: "finance_manager"
    });
    setMockSession({
      userId: staffUser.id,
      email: staffUser.email,
      accountRole: "member"
    });

    const response = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );

    expect(response.status).toBe(403);
  });

  test("join and leave do not create or revoke staff access", async () => {
    const { organisation } = await createOrganisationAccount();
    const staffUser = await createMember();
    await createOrganisationStaff({
      organisationId: organisation.id,
      userId: staffUser.id,
      role: "event_manager"
    });
    setMockSession({
      userId: staffUser.id,
      email: staffUser.email,
      accountRole: "member"
    });

    const join = await import("@/app/api/orgs/[orgSlug]/join/route");
    const joinResponse = await join.POST(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/join`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(joinResponse.status).toBe(200);

    const leaveResponse = await leaveOrganisation(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(leaveResponse.status).toBe(200);

    await expect(
      prisma.organisationStaff.findFirst({
        where: {
          organisationId: organisation.id,
          userId: staffUser.id,
          status: "active"
        }
      })
    ).resolves.toMatchObject({
      role: "event_manager"
    });

    const management = await getEvents(
      jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`)
    );
    expect(management.status).toBe(200);
  });

  test("staff invite token is hashed, single-use, and grants staff access on accept", async () => {
    const { user: owner, organisation } = await createOrganisationAccount();
    const invitee = await createMember({ email: "staff-invitee@example.com" });
    setMockSession({
      userId: owner.id,
      email: owner.email,
      accountRole: "organisation"
    });

    const inviteResponse = await createStaffInvite(
      jsonRequest(
        `http://localhost/api/orgs/${organisation.slug}/staff/invites`,
        {
          email: invitee.email,
          role: "check_in_staff"
        },
        { method: "POST" }
      ),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(inviteResponse.status).toBe(201);
    const inviteBody = await parseJsonResponse(inviteResponse);
    expect(inviteBody.token).toEqual(expect.any(String));

    const storedInvite = await prisma.organisationStaffInvite.findUniqueOrThrow({
      where: { id: inviteBody.invite.id },
      select: { tokenHash: true }
    });
    expect(storedInvite.tokenHash).toBe(hashStaffInviteToken(inviteBody.token));
    expect(storedInvite.tokenHash).not.toBe(inviteBody.token);

    setMockSession({
      userId: invitee.id,
      email: invitee.email,
      accountRole: "member"
    });
    const acceptResponse = await acceptStaffInvite(
      jsonRequest(
        "http://localhost/api/staff/invites/accept",
        { token: inviteBody.token },
        { method: "POST" }
      )
    );
    expect(acceptResponse.status).toBe(200);
    expect(await parseJsonResponse(acceptResponse)).toMatchObject({
      staff: {
        organisationId: organisation.id,
        role: "check_in_staff",
        status: "active"
      }
    });

    const secondAccept = await acceptStaffInvite(
      jsonRequest(
        "http://localhost/api/staff/invites/accept",
        { token: inviteBody.token },
        { method: "POST" }
      )
    );
    expect(secondAccept.status).toBe(400);
  });

  test("revoked staff invite cannot be accepted", async () => {
    const { user: owner, organisation } = await createOrganisationAccount();
    const invitee = await createMember({ email: "revoked-invitee@example.com" });
    setMockSession({
      userId: owner.id,
      email: owner.email,
      accountRole: "organisation"
    });
    const inviteResponse = await createStaffInvite(
      jsonRequest(
        `http://localhost/api/orgs/${organisation.slug}/staff/invites`,
        {
          email: invitee.email,
          role: "event_manager"
        },
        { method: "POST" }
      ),
      routeContext({ orgSlug: organisation.slug })
    );
    const inviteBody = await parseJsonResponse(inviteResponse);
    await prisma.organisationStaffInvite.update({
      where: { id: inviteBody.invite.id },
      data: { revokedAt: new Date() }
    });

    setMockSession({
      userId: invitee.id,
      email: invitee.email,
      accountRole: "member"
    });
    const acceptResponse = await acceptStaffInvite(
      jsonRequest(
        "http://localhost/api/staff/invites/accept",
        { token: inviteBody.token },
        { method: "POST" }
      )
    );

    expect(acceptResponse.status).toBe(400);
    await expect(
      prisma.organisationStaff.findFirst({
        where: {
          organisationId: organisation.id,
          userId: invitee.id
        }
      })
    ).resolves.toBeNull();
  });

  test("last active owner cannot be revoked or downgraded", async () => {
    const { user: owner, organisation } = await createOrganisationAccount();
    const ownerStaff = await prisma.organisationStaff.findFirstOrThrow({
      where: {
        organisationId: organisation.id,
        userId: owner.id,
        role: "owner",
        status: "active"
      }
    });
    setMockSession({
      userId: owner.id,
      email: owner.email,
      accountRole: "organisation"
    });

    const revokeResponse = await updateStaff(
      jsonRequest(
        `http://localhost/api/orgs/${organisation.slug}/staff/${ownerStaff.id}`,
        { status: "revoked" },
        { method: "PATCH" }
      ),
      routeContext({ orgSlug: organisation.slug, staffId: ownerStaff.id })
    );
    expect(revokeResponse.status).toBe(409);

    const downgradeResponse = await updateStaff(
      jsonRequest(
        `http://localhost/api/orgs/${organisation.slug}/staff/${ownerStaff.id}`,
        { role: "admin" },
        { method: "PATCH" }
      ),
      routeContext({ orgSlug: organisation.slug, staffId: ownerStaff.id })
    );
    expect(downgradeResponse.status).toBe(409);
  });
});
