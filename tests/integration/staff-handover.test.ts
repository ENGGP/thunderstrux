import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { handOverOrganisationOwnership } from "@/lib/staff/handover";
import { handoverAcknowledgement } from "@/lib/validators/staff";
import { createMember, createOrganisationAccount, createOrganisationStaff, createEvent, createOrder, joinOrganisation } from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { POST } from "@/app/api/orgs/[orgSlug]/staff/handover/route";
import { updateOrganisationStaff } from "@/lib/staff/management";
import { requireOrganisationPermission } from "@/lib/auth/access";
import { closeAccount, closureAcknowledgement, readAccountClosureEligibility } from "@/lib/auth/account-closure";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled, setRateLimitTestBackendFailure } from "@/lib/security/rate-limit";

beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });
const actor = (user: { id: string; authVersion: number }) => ({ id: user.id, authVersion: user.authVersion, mfaSessionId: "integration-session" });
async function fixture() {
  const society = await createOrganisationAccount({ stripeReady: true }); const incoming = await createMember();
  const staff = await createOrganisationStaff({ organisationId: society.organisation.id, userId: incoming.id });
  return { ...society, incoming, staff };
}
const input = (staffId: string, outgoingAccess: "admin" | "revoked" = "admin") => ({ incomingStaffId: staffId, outgoingAccess, currentPassword: "password123", acknowledgement: handoverAcknowledgement });
async function enroll(userId: string, grant = false) {
  await prisma.userMfa.create({ data: { userId, enabledAt: new Date(), encryptedSecret: "synthetic-not-transferred" } });
  if (grant) await prisma.mfaGrant.create({ data: { userId, sessionDigest: mfaGrantDigest("integration-session")!, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
}

test("handover atomically promotes incoming owner, retains admin and retires the legacy pointer without moving history or credentials", async () => {
  const data = await fixture(); const event = await createEvent({ organisationId: data.organisation.id });
  const order = await createOrder({ organisationId: data.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: data.user.id });
  await joinOrganisation(data.incoming.id, data.organisation.id); await enroll(data.user.id, true); await enroll(data.incoming.id);
  const users = await prisma.user.findMany({ orderBy: { id: "asc" } }); const mfa = await prisma.userMfa.findMany({ orderBy: { userId: "asc" } });
  await handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id));
  expect(await prisma.organisation.findUniqueOrThrow({ where: { id: data.organisation.id } })).toEqual({ ...data.organisation, accountUserId: null });
  expect(await prisma.organisationStaff.findUniqueOrThrow({ where: { id: data.staff.id } })).toMatchObject({ role: "owner", status: "active", userId: data.incoming.id });
  expect(await prisma.organisationStaff.findUniqueOrThrow({ where: { organisationId_userId: { organisationId: data.organisation.id, userId: data.user.id } } })).toMatchObject({ role: "admin", status: "active" });
  expect(await prisma.user.findMany({ orderBy: { id: "asc" } })).toEqual(users); expect(await prisma.userMfa.findMany({ orderBy: { userId: "asc" } })).toEqual(mfa);
  expect(await prisma.event.findUniqueOrThrow({ where: { id: event.id }, include: { ticketTypes: { orderBy: { createdAt: "asc" } } } })).toEqual(event);
  expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toEqual(order);
  expect(await prisma.organisationMember.count()).toBe(2);
  expect(await prisma.auditLog.findFirstOrThrow()).toMatchObject({ action: "staff.ownership.handed_over", actorUserId: data.user.id, targetId: data.staff.id,
    metadata: { retiredAccountUserId: data.user.id, incomingUserId: data.incoming.id, outgoingRole: "admin", legacyOwnershipRetired: true } });
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toThrow("Only an active owner");
  expect(await prisma.auditLog.count()).toBe(1);
});

test("revocation removes old-session authority in legacy allow mode and releases account closure ownership blockers", async () => {
  const data = await fixture(); vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "allow");
  await handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id, "revoked"));
  setMockSession({ userId: data.user.id, email: data.user.email, accountRole: "organisation" });
  await expect(requireOrganisationPermission(data.organisation.id, "staff:manage")).rejects.toThrow();
  expect((await readAccountClosureEligibility(actor(data.user))).eligible).toBe(true);
  await closeAccount(actor(data.user), "password123", closureAcknowledgement);
  expect(await prisma.organisationStaff.count({ where: { organisationId: data.organisation.id, role: "owner", status: "active" } })).toBe(1);
});

test("admins cannot hand over or change owners; ordinary final-owner demotion remains blocked", async () => {
  const data = await fixture(); await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { role: "admin" } });
  await expect(handOverOrganisationOwnership(actor(data.incoming), data.organisation.id, input(data.staff.id))).rejects.toThrow("Choose another");
  const ownerRow = await prisma.organisationStaff.findFirstOrThrow({ where: { userId: data.user.id } });
  await expect(handOverOrganisationOwnership(actor(data.incoming), data.organisation.id, input(ownerRow.id))).rejects.toThrow("Only an active owner");
  await expect(updateOrganisationStaff(actor(data.incoming), data.organisation.id, data.staff.id, { role: "owner" })).rejects.toThrow("Only owners");
  await expect(updateOrganisationStaff(actor(data.user), data.organisation.id, ownerRow.id, { role: "admin" })).rejects.toThrow("At least one active owner");
  expect(await prisma.auditLog.count()).toBe(0);
});

test("wrong password, acknowledgement, stale actor and ineligible targets cannot mutate ownership", async () => {
  const data = await fixture();
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, { ...input(data.staff.id), currentPassword: "wrong" })).rejects.toThrow("Current password");
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, { ...input(data.staff.id), acknowledgement: "yes" })).rejects.toThrow();
  await expect(handOverOrganisationOwnership({ ...actor(data.user), authVersion: 99 }, data.organisation.id, input(data.staff.id))).rejects.toMatchObject({ kind: "stale_session" });
  const foreign = await fixture();
  for (const staffId of [foreign.staff.id, "missing"]) await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(staffId))).rejects.toThrow("Choose another");
  await prisma.user.update({ where: { id: data.incoming.id }, data: { emailVerifiedAt: null } });
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toThrow("Choose another");
  await prisma.user.update({ where: { id: data.incoming.id }, data: { emailVerifiedAt: new Date(), disabledAt: new Date() } });
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toThrow("Choose another");
  await prisma.user.update({ where: { id: data.incoming.id }, data: { disabledAt: null } });
  await prisma.organisationStaff.update({ where: { id: data.staff.id }, data: { status: "revoked" } });
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toThrow("Choose another");
  expect((await prisma.organisation.findUniqueOrThrow({ where: { id: data.organisation.id } })).accountUserId).toBe(data.user.id);
  expect(await prisma.auditLog.count()).toBe(0);
});

test("enforce requires both enrollments and actor login verification; enrolled actor MFA remains required when mode is off", async () => {
  const data = await fixture(); vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toThrow("Both owners");
  await enroll(data.user.id);
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toMatchObject({ kind: "mfa_required" });
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toMatchObject({ kind: "mfa_required" });
  await prisma.mfaGrant.create({ data: { userId: data.user.id, sessionDigest: mfaGrantDigest("integration-session")!, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
  await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id))).rejects.toThrow("Both owners");
  await enroll(data.incoming.id); await handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id));
});

test("audit failure rolls back promotion, outgoing access and pointer retirement", async () => {
  const data = await fixture();
  await prisma.$executeRawUnsafe(`CREATE FUNCTION t06b_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'staff.ownership.handed_over' THEN RAISE EXCEPTION 'synthetic handover audit failure'; END IF; RETURN NEW; END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER t06b_reject_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION t06b_reject_audit()`);
  try { await expect(handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id, "revoked"))).rejects.toThrow("synthetic handover audit failure"); }
  finally { await prisma.$executeRawUnsafe(`DROP TRIGGER t06b_reject_audit ON "AuditLog"`); await prisma.$executeRawUnsafe(`DROP FUNCTION t06b_reject_audit()`); }
  expect((await prisma.organisationStaff.findUniqueOrThrow({ where: { id: data.staff.id } })).role).toBe("event_manager");
  expect(await prisma.organisationStaff.count({ where: { userId: data.user.id, role: "owner", status: "active" } })).toBe(1);
  expect((await prisma.organisation.findUniqueOrThrow({ where: { id: data.organisation.id } })).accountUserId).toBe(data.user.id);
  expect(await prisma.auditLog.count()).toBe(0);
});

test("parallel handover commits once; racing target closure and staff revocation never strand owners", async () => {
  const data = await fixture(); const results = await Promise.allSettled(Array.from({ length: 3 }, () => handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id, "revoked"))));
  expect(results.filter(item => item.status === "fulfilled")).toHaveLength(1); expect(await prisma.auditLog.count()).toBe(1);
  for (const action of ["close", "revoke"] as const) {
    const next = await fixture();
    await Promise.allSettled([handOverOrganisationOwnership(actor(next.user), next.organisation.id, input(next.staff.id, "revoked")), action === "close" ? closeAccount(actor(next.incoming), "password123", closureAcknowledgement) : updateOrganisationStaff(actor(next.user), next.organisation.id, next.staff.id, { status: "revoked" })]);
    expect(await prisma.organisationStaff.count({ where: { organisationId: next.organisation.id, role: "owner", status: "active" } })).toBe(1);
    const target = await prisma.user.findUniqueOrThrow({ where: { id: next.incoming.id } });
    if (target.closedAt) expect(await prisma.organisationStaff.count({ where: { userId: target.id, status: "active" } })).toBe(0);
  }
});

test("HTTP handover retains strict validation, origin/CSRF, owner checks, required Redis and private output", async () => {
  const data = await fixture(); const context = routeContext({ orgSlug: data.organisation.slug }); const body = input(data.staff.id);
  setMockSession({ userId: data.user.id, email: data.user.email, accountRole: "organisation" });
  expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", body, { headers: { origin: "https://evil.example" } }), context)).status).toBe(403);
  expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", body, { headers: { cookie: "authjs.session-token=synthetic" } }), context)).status).toBe(403);
  expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", { ...body, organisationId: "forged" }), context)).status).toBe(400);
  setRateLimitTestBackendFailure(new Error("synthetic Redis failure")); expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", body), context)).status).toBe(503);
  setRateLimitTestBackendFailure(null);
  for (let i = 0; i < 5; i++) expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", { ...body, currentPassword: "wrong" }), context)).status).toBe(400);
  expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", body), context)).status).toBe(429);
  setRateLimitTestBackend(createTestRateLimitBackend());
  const response = await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", body), context); expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(await response.json()).toMatchObject({ handedOver: true, legacyOwnershipRetired: true });
  expect((await POST(jsonRequest("http://localhost/api/orgs/x/staff/handover", body), context)).status).toBe(403);
});


test("handover retires a separate legacy account pointer and serializes reciprocal owners without deadlock", async () => {
  const data = await fixture(); const legacy = await createMember();
  await prisma.organisation.update({ where: { id: data.organisation.id }, data: { accountUserId: legacy.id } });
  expect((await readAccountClosureEligibility(actor(legacy))).eligible).toBe(false);
  await handOverOrganisationOwnership(actor(data.user), data.organisation.id, input(data.staff.id));
  expect((await readAccountClosureEligibility(actor(legacy))).eligible).toBe(true);
  expect((await prisma.auditLog.findFirstOrThrow()).metadata).toMatchObject({ retiredAccountUserId: legacy.id });
  const other = await fixture(); await prisma.organisationStaff.update({ where: { id: other.staff.id }, data: { role: "owner" } });
  const first = await prisma.organisationStaff.findFirstOrThrow({ where: { organisationId: other.organisation.id, userId: other.user.id } });
  await Promise.allSettled([handOverOrganisationOwnership(actor(other.user), other.organisation.id, input(other.staff.id, "revoked")), handOverOrganisationOwnership(actor(other.incoming), other.organisation.id, input(first.id, "revoked"))]);
  expect(await prisma.organisationStaff.count({ where: { organisationId: other.organisation.id, role: "owner", status: "active" } })).toBe(1);
});
