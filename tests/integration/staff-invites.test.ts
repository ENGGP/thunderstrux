import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createOrganisationStaffInvite, acceptOrganisationStaffInvite, manageOrganisationStaffInvite } from "@/lib/staff/invites";
import { readStaffInviteToken } from "@/tests/helpers/staff-invites";
import { createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, routeContext } from "@/tests/helpers/http";
import { POST as issueRoute } from "@/app/api/orgs/[orgSlug]/staff/invites/route";
import { POST as acceptRoute } from "@/app/api/staff/invites/accept/route";
import { POST as resendRoute } from "@/app/api/orgs/[orgSlug]/staff/invites/[inviteId]/resend/route";
import { POST as revokeRoute } from "@/app/api/orgs/[orgSlug]/staff/invites/[inviteId]/revoke/route";
import { claimNotificationJobs, processNotificationClaim } from "@/lib/email/notification-outbox";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestBackendFailure, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { closeAccount, closureAcknowledgement } from "@/lib/auth/account-closure";
import { GET as listNotifications } from "@/app/api/notifications/route";

beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });
const actor = (user: { id: string; authVersion: number }) => ({ id: user.id, authVersion: user.authVersion, mfaSessionId: "integration-session" });
async function fixture() { return { ...await createOrganisationAccount(), recipient: await createMember() }; }
async function issue(data: Awaited<ReturnType<typeof fixture>>, role: "owner" | "admin" | "event_manager" = "event_manager") {
  const result = await createOrganisationStaffInvite({ organisationId: data.organisation.id, actor: actor(data.user), email: data.recipient.email, role });
  return { ...result, token: await readStaffInviteToken(result.invite.id) };
}
test("HTTP issuance exposes metadata only and commits private encrypted mail and audit", async () => {
  const data = await fixture(); setMockSession({ userId: data.user.id, email: data.user.email, accountRole: "organisation" });
  const response = await issueRoute(jsonRequest("http://localhost/api/orgs/x/staff/invites", { email: data.recipient.email, role: "event_manager" }), routeContext({ orgSlug: data.organisation.slug }));
  expect(response.status).toBe(201); expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const body = await response.json(); expect(Object.keys(body)).toEqual(["invite"]);
  const token = await readStaffInviteToken(body.invite.id); const job = await prisma.notificationOutbox.findFirstOrThrow();
  expect(job).toMatchObject({ privacy: "security", organisationId: null, userId: null, template: "staff_invite", staffInviteVersion: 1 });
  expect(JSON.stringify(body)).not.toContain(token); expect(job.encryptedPayload).not.toContain(token);
  expect(await prisma.auditLog.count({ where: { action: "staff.invite.created" } })).toBe(1);
  await prisma.notificationOutbox.update({ where: { id: job.id }, data: { status: "failed" } });
  expect((await (await listNotifications(jsonRequest("http://localhost/api/notifications"))).json()).jobs).toEqual([]);
});
test("parallel acceptance commits once; accepted replay never reactivates revoked access", async () => {
  const data = await fixture(); const invite = await issue(data);
  const outcomes = await Promise.all(Array.from({ length: 4 }, () => acceptOrganisationStaffInvite({ token: invite.token, actor: actor(data.recipient) })));
  expect(outcomes.filter(result => !result.alreadyAccepted)).toHaveLength(1);
  expect(await prisma.auditLog.count({ where: { action: "staff.invite.accepted" } })).toBe(1);
  await prisma.organisationStaff.update({ where: { id: outcomes[0].staff.id }, data: { status: "revoked" } });
  expect(await acceptOrganisationStaffInvite({ token: invite.token, actor: actor(data.recipient) })).toMatchObject({ alreadyAccepted: true, staff: { status: "revoked" } });
});
test("lower-role invites preserve existing owners and every active role", async () => {
  const data = await fixture();
  for (const role of ["owner", "admin", "event_manager", "finance_manager", "check_in_staff"] as const) {
    const recipient = await createMember(); await createOrganisationStaff({ organisationId: data.organisation.id, userId: recipient.id, role });
    const invite = await issue({ ...data, recipient }, "event_manager");
    expect((await acceptOrganisationStaffInvite({ token: invite.token, actor: actor(recipient) })).staff.role).toBe(role);
  }
  const self = await createOrganisationStaffInvite({ organisationId: data.organisation.id, actor: actor(data.user), email: data.user.email, role: "event_manager" });
  expect((await acceptOrganisationStaffInvite({ token: await readStaffInviteToken(self.invite.id), actor: actor(data.user) })).staff.role).toBe("owner");
});
test("accept rejects wrong/unverified/closed identities, stale sessions, expiry and revoked issuer authority", async () => {
  const data = await fixture(); const invite = await issue(data, "owner"); const wrong = await createMember();
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(wrong) })).rejects.toThrow("unavailable");
  await prisma.user.update({ where: { id: data.recipient.id }, data: { emailVerifiedAt: null } });
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(data.recipient) })).rejects.toThrow("Verify your email");
  await prisma.user.update({ where: { id: data.recipient.id }, data: { emailVerifiedAt: new Date(), authVersion: 1 } });
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(data.recipient) })).rejects.toThrow("Sign in again");
  const recipient = { ...data.recipient, authVersion: 1 };
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(recipient), now: new Date(Date.now() + 8 * 86400000) })).rejects.toThrow("unavailable");
  await prisma.organisationStaff.updateMany({ where: { userId: data.user.id }, data: { role: "admin" } });
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(recipient) })).rejects.toThrow("unavailable");
  await closeAccount(actor(recipient), "password123", closureAcknowledgement);
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(recipient) })).rejects.toThrow("Sign in again");
});
test("resend rotates token/version and fences claimed mail; revoke cancels the replacement", async () => {
  const data = await fixture(); const invite = await issue(data); const [claim] = await claimNotificationJobs(new Date(Date.now() + 1000));
  const resend = await manageOrganisationStaffInvite(actor(data.user), data.organisation.id, invite.invite.id, "resend");
  expect(resend.invite.version).toBe(2); const replacement = await readStaffInviteToken(invite.invite.id); expect(replacement).not.toBe(invite.token);
  await expect(acceptOrganisationStaffInvite({ token: invite.token, actor: actor(data.recipient) })).rejects.toThrow("unavailable");
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await processNotificationClaim(claim)).toBe("skipped"); expect(fetch).not.toHaveBeenCalled();
  await manageOrganisationStaffInvite(actor(data.user), data.organisation.id, invite.invite.id, "revoke");
  await expect(acceptOrganisationStaffInvite({ token: replacement, actor: actor(data.recipient) })).rejects.toThrow("unavailable");
  expect(await prisma.notificationOutbox.count({ where: { status: "cancelled" } })).toBe(2);
});
test("accept/resend and accept/revoke races serialize with one winning mutation", async () => {
  for (const action of ["resend", "revoke"] as const) {
    const data = await fixture(); const invite = await issue(data);
    const outcomes = await Promise.allSettled([acceptOrganisationStaffInvite({ token: invite.token, actor: actor(data.recipient) }), manageOrganisationStaffInvite(actor(data.user), data.organisation.id, invite.invite.id, action)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.organisationStaff.count({ where: { organisationId: data.organisation.id, role: "owner", status: "active" } })).toBe(1);
  }
});
test("worker suppresses obsolete versions, expiry and issuer revocation", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  for (const reason of ["version", "expiry", "issuer"] as const) {
    const data = await fixture(); const invite = await issue(data); const [claim] = await claimNotificationJobs(new Date(Date.now() + 1000));
    if (reason === "version") await prisma.organisationStaffInvite.update({ where: { id: invite.invite.id }, data: { version: 2 } });
    if (reason === "expiry") await prisma.organisationStaffInvite.update({ where: { id: invite.invite.id }, data: { expiresAt: new Date(0) } });
    if (reason === "issuer") await prisma.organisationStaff.updateMany({ where: { userId: data.user.id }, data: { status: "revoked" } });
    expect(await processNotificationClaim(claim)).toBe("cancelled");
  }
  expect(fetch).not.toHaveBeenCalled();
});
test("missing encryption configuration rolls back invitation, job and audit", async () => {
  const data = await fixture(); vi.stubEnv("NOTIFICATION_ENCRYPTION_KEY", "");
  await expect(issue(data)).rejects.toThrow(); expect(await prisma.organisationStaffInvite.count()).toBe(0);
  expect(await prisma.notificationOutbox.count()).toBe(0); expect(await prisma.auditLog.count()).toBe(0);
});
test("issuance and acceptance fail closed on Redis failure; per-address throttling writes nothing extra", async () => {
  const data = await fixture(); setMockSession({ userId: data.user.id, email: data.user.email, accountRole: "organisation" });
  const request = () => jsonRequest("http://localhost/api/orgs/x/staff/invites", { email: data.recipient.email, role: "event_manager" });
  const context = routeContext({ orgSlug: data.organisation.slug });
  setRateLimitTestBackendFailure(new Error("synthetic failure")); expect((await issueRoute(request(), context)).status).toBe(503);
  expect(await prisma.organisationStaffInvite.count()).toBe(0); setRateLimitTestBackendFailure(null);
  for (let i = 0; i < 3; i++) expect((await issueRoute(request(), context)).status).toBe(201);
  expect((await issueRoute(request(), context)).status).toBe(429); expect(await prisma.organisationStaffInvite.count()).toBe(3);
  const invite = await prisma.organisationStaffInvite.findFirstOrThrow(); const token = await readStaffInviteToken(invite.id);
  setRateLimitTestBackendFailure(new Error("synthetic failure")); setMockSession({ userId: data.recipient.id, email: data.recipient.email, accountRole: "member" });
  expect((await acceptRoute(jsonRequest("http://localhost/api/staff/invites/accept", { token }))).status).toBe(503);
  expect(await prisma.organisationStaff.count({ where: { userId: data.recipient.id } })).toBe(0);
});
test("admins cannot issue/resend owner invitations or change revoked owner rows; foreign invite IDs are concealed", async () => {
  const data = await fixture(); const admin = await createMember(); await createOrganisationStaff({ organisationId: data.organisation.id, userId: admin.id, role: "admin" });
  await expect(createOrganisationStaffInvite({ organisationId: data.organisation.id, actor: actor(admin), email: data.recipient.email, role: "owner" })).rejects.toThrow("authorised owners");
  const invite = await issue(data, "owner");
  await expect(manageOrganisationStaffInvite(actor(admin), data.organisation.id, invite.invite.id, "resend")).rejects.toThrow("authorised owners");
  const foreign = await createOrganisationAccount(); setMockSession({ userId: foreign.user.id, email: foreign.user.email, accountRole: "organisation" });
  for (const handler of [resendRoute, revokeRoute]) {
    const response = await handler(jsonRequest("http://localhost/api/orgs/x/staff/invites/x/action", {}), routeContext({ orgSlug: foreign.organisation.slug, inviteId: invite.invite.id }));
    expect(response.status).toBe(400); expect((await response.json()).error.message).toBe("Invitation is unavailable");
  }
  await createOrganisationStaff({ organisationId: data.organisation.id, userId: data.recipient.id, role: "owner", status: "revoked" });
  await expect(createOrganisationStaffInvite({ organisationId: data.organisation.id, actor: actor(admin), email: data.recipient.email, role: "event_manager" })).rejects.toThrow("Only owners");
});


test("all invitation mutations retain trusted-origin and session-cookie CSRF guards", async () => {
  const data = await fixture(); const invite = await issue(data);
  setMockSession({ userId: data.user.id, email: data.user.email, accountRole: "organisation" });
  const operations = [
    () => issueRoute(jsonRequest("http://localhost/api/orgs/x/staff/invites", { email: data.recipient.email, role: "admin" }, { headers: { origin: "https://evil.example" } }), routeContext({ orgSlug: data.organisation.slug })),
    () => acceptRoute(jsonRequest("http://localhost/api/staff/invites/accept", { token: invite.token }, { headers: { cookie: "authjs.session-token=synthetic" } })),
    ...[resendRoute, revokeRoute].map(handler => () => handler(jsonRequest("http://localhost/api/orgs/x/staff/invites/x/action", {}, { headers: { cookie: "authjs.session-token=synthetic" } }), routeContext({ orgSlug: data.organisation.slug, inviteId: invite.invite.id })))
  ];
  for (const operation of operations) expect((await operation()).status).toBe(403);
  expect(await prisma.organisationStaffInvite.count()).toBe(1);
  expect(await prisma.auditLog.count()).toBe(1);
});

test("issuer MFA is rechecked inside the transaction before writes", async () => {
  const data = await fixture(); vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
  await expect(issue(data)).rejects.toThrow("Staff authenticator verification required");
  expect(await prisma.organisationStaffInvite.count()).toBe(0);
});

test("actor and token quotas reject writes and replay without adding audit rows", async () => {
  const data = await fixture(); setMockSession({ userId: data.user.id, email: data.user.email, accountRole: "organisation" });
  for (let i = 0; i < 21; i++) {
    const response = await issueRoute(jsonRequest("http://localhost/api/orgs/x/staff/invites", { email: `unknown-${i}@example.com`, role: "event_manager" }), routeContext({ orgSlug: data.organisation.slug }));
    expect(response.status).toBe(i < 20 ? 201 : 429);
  }
  expect(await prisma.organisationStaffInvite.count()).toBe(20);
  setRateLimitTestBackend(createTestRateLimitBackend()); const invite = await issue(data);
  setMockSession({ userId: data.recipient.id, email: data.recipient.email, accountRole: "member" });
  for (let i = 0; i < 11; i++) expect((await acceptRoute(jsonRequest("http://localhost/api/staff/invites/accept", { token: invite.token }))).status).toBe(i < 10 ? 200 : 429);
  expect(await prisma.auditLog.count({ where: { action: "staff.invite.accepted" } })).toBe(1);
});
