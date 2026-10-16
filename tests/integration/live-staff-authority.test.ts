import { describe, expect, test, vi } from "vitest";
import { GET as listOrganisations } from "@/app/api/orgs/route";
import { GET as readOrganisation } from "@/app/api/orgs/[orgSlug]/route";
import { GET as listEvents } from "@/app/api/events/route";
import { prisma } from "@/lib/db";
import { requireStripeConnectCapability } from "@/lib/auth/access";
import { requeueBusinessNotification } from "@/lib/email/notification-outbox";
import { requeueFailedTicketEmail } from "@/lib/email/ticket-email-outbox";
import { lockOrganisationActor } from "@/lib/organisations/authority";
import { invitationIssuerRole } from "@/lib/staff/invite-authority";
import { assertLegacyOrganisationAccessConfigured, liveStaffRole, liveStaffRoleForUser } from "@/lib/staff/live-authority";
import { updateOrganisationStaff } from "@/lib/staff/management";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createEvent, createMember, createOrder, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

// An organisation account that still holds the legacy Organisation.accountUserId
// pointer but whose own staff row was revoked: every former copy of the rule must
// deny it, because any staff row supersedes legacy ownership.
async function revokedLegacyOwner() {
  const { user, organisation } = await createOrganisationAccount();
  await prisma.organisationStaff.update({
    where: { organisationId_userId: { organisationId: organisation.id, userId: user.id } },
    data: { status: "revoked", revokedAt: new Date() }
  });
  setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
  return { user, organisation, actor: { id: user.id, authVersion: user.authVersion } };
}

// A legacy-only owner: the pointer and no staff row at all.
async function legacyOnlyOwner() {
  const { user, organisation } = await createOrganisationAccount();
  await prisma.organisationStaff.delete({ where: { organisationId_userId: { organisationId: organisation.id, userId: user.id } } });
  return { user, organisation };
}

async function failedTicketEmail(organisationId: string) {
  const event = await createEvent({ organisationId, status: "published" });
  const order = await createOrder({ organisationId, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, status: "paid", paidAt: new Date() });
  return prisma.emailOutbox.create({ data: { orderId: order.id, mode: "automatic", status: "failed", attempts: 5, lastError: "provider unavailable" } });
}

describe("one live staff authority rule", () => {
  test("the rule: active staff grants its role, any staff row supersedes legacy, disabled accounts hold nothing", async () => {
    const legacy = await legacyOnlyOwner();
    const actor = { id: legacy.user.id, accountRole: "organisation" };
    expect(await liveStaffRole(prisma, legacy.organisation.id, actor)).toBe("owner");
    vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "deny");
    expect(await liveStaffRole(prisma, legacy.organisation.id, actor)).toBeNull();
    vi.unstubAllEnvs();

    const { organisation } = await createOrganisationAccount();
    const manager = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: manager.id, role: "event_manager" });
    expect(await liveStaffRoleForUser(prisma, organisation.id, manager.id)).toBe("event_manager");
    await prisma.user.update({ where: { id: manager.id }, data: { disabledAt: new Date() } });
    expect(await liveStaffRoleForUser(prisma, organisation.id, manager.id)).toBeNull();

    const revoked = await revokedLegacyOwner();
    expect(await liveStaffRoleForUser(prisma, revoked.organisation.id, revoked.user.id)).toBeNull();
  });

  test("an unset legacy mode in production denies, and readiness reports it", async () => {
    const legacy = await legacyOnlyOwner();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "");
    expect(await liveStaffRoleForUser(prisma, legacy.organisation.id, legacy.user.id)).toBeNull();
    expect(assertLegacyOrganisationAccessConfigured).toThrow("must be set to allow or deny");
    vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "deny");
    expect(assertLegacyOrganisationAccessConfigured).not.toThrow();
    vi.unstubAllEnvs();
  });

  test("access.ts: tenant permission, read by slug, organisation list and Connect capability deny a revoked legacy owner", async () => {
    const { organisation } = await revokedLegacyOwner();

    expect((await listEvents(jsonRequest(`http://localhost/api/events?orgId=${organisation.id}`))).status).toBe(403);
    expect((await readOrganisation(jsonRequest(`http://localhost/api/orgs/${organisation.slug}`), routeContext({ orgSlug: organisation.slug }))).status).toBe(404);
    expect(await parseJsonResponse(await listOrganisations(jsonRequest("http://localhost/api/orgs")))).toEqual({ organisations: [] });
    await expect(requireStripeConnectCapability()).rejects.toThrow("Insufficient permissions");
  });

  test("organisation and staff services deny a revoked legacy owner under their locks", async () => {
    const { organisation, actor } = await revokedLegacyOwner();
    const other = await createMember();
    const otherStaff = await createOrganisationStaff({ organisationId: organisation.id, userId: other.id, role: "event_manager" });

    await expect(prisma.$transaction((tx) => lockOrganisationActor(tx, actor, organisation.id, "organisation:settings")))
      .rejects.toThrow("Organisation not found or access denied");
    await expect(updateOrganisationStaff(actor, organisation.id, otherStaff.id, { status: "revoked" }))
      .rejects.toMatchObject({ kind: "authority" });
    expect(await invitationIssuerRole(prisma, organisation.id, actor.id)).toBeNull();
  });

  test("worker-side requeue checks deny a revoked legacy owner and, in deny mode, a legacy-only owner", async () => {
    const revoked = await revokedLegacyOwner();
    const job = await failedTicketEmail(revoked.organisation.id);
    await expect(requeueFailedTicketEmail({ jobId: job.id, actorUserId: revoked.user.id, reason: "Provider issue resolved" }))
      .rejects.toThrow("permission");
    await expect(requeueBusinessNotification({ jobId: "missing", organisationId: revoked.organisation.id, actorUserId: revoked.user.id, reason: "Provider issue resolved" }))
      .rejects.toThrow("Notification is unavailable");

    // The ticket-email copy used to ignore the legacy mode entirely.
    const legacy = await legacyOnlyOwner();
    const legacyJob = await failedTicketEmail(legacy.organisation.id);
    vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "deny");
    await expect(requeueFailedTicketEmail({ jobId: legacyJob.id, actorUserId: legacy.user.id, reason: "Provider issue resolved" }))
      .rejects.toThrow("permission");
    vi.unstubAllEnvs();
    await expect(requeueFailedTicketEmail({ jobId: legacyJob.id, actorUserId: legacy.user.id, reason: "Provider issue resolved" }))
      .resolves.toMatchObject({ orderId: expect.any(String) });
  });
});
