import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { prisma } from "@/lib/db";
import { requestEmailChange, confirmEmailChange, cancelEmailChange } from "@/lib/auth/email-change";
import { requestPasswordReset, AccountTokenError } from "@/lib/auth/account-lifecycle";
import { readAccountSettings } from "@/lib/auth/account-settings";
import { decryptNotification } from "@/lib/email/notification-crypto";
import * as notifications from "@/lib/email/notification-outbox";
import { createMember, createOrganisationAccount, createEvent, createOrder } from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest } from "@/tests/helpers/http";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { createOrganisationStaffInvite } from "@/lib/staff/invites";
import { POST as requestRoute } from "@/app/api/me/account/email/request/route";
import { POST as confirmRoute } from "@/app/api/me/account/email/confirm/route";
import { POST as cancelRoute } from "@/app/api/me/account/email/cancel/route";
import { fetchJson } from "@/lib/client/api";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled, setRateLimitTestBackendFailure } from "@/lib/security/rate-limit";
beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });
async function tokenFor(userId: string) {
  const token = await prisma.authToken.findFirstOrThrow({ where: { userId, purpose: "email_change", invalidatedAt: null, consumedAt: null }, orderBy: { createdAt: "desc" } });
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { authTokenId: token.id } });
  const payload = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  const raw = new URLSearchParams(new URL(payload.text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!;
  return { token, job, raw };
}
test("request retains the old identity, binds a 30-minute new-address link, and exposes only private pending state", async () => {
  const user = await createMember(); const actor = { id: user.id, authVersion: 0 };
  await requestEmailChange(actor, "password123", " New@Example.com ");
  const { token, job, raw } = await tokenFor(user.id);
  expect(token.email).toBe(user.email); expect(token.newEmail).toBe("new@example.com"); expect(token.tokenHash).not.toContain(raw);
  expect(token.expiresAt.getTime() - token.createdAt.getTime()).toBeLessThanOrEqual(1800000);
  expect(job.recipient).toBe("new@example.com"); expect(job.organisationId).toBeNull();
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  expect((await readAccountSettings(actor)).pendingEmailChange?.email).toBe("new@example.com");
  expect(await prisma.notificationOutbox.count({ where: { recipient: user.email, template: "email_change_requested" } })).toBe(1);
});
test("taken and available addresses have identical request and pending-state behavior, and uniqueness is denied at confirmation", async () => {
  const user = await createMember(); const taken = await createMember(); const actor = { id: user.id, authVersion: 0 };
  setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  for (const newEmail of [taken.email, "available@example.com"]) {
    const response = await requestRoute(jsonRequest("http://localhost:3000/api/me/account/email/request", { currentPassword: "password123", newEmail }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: true });
    expect((await readAccountSettings(actor)).pendingEmailChange?.email).toBe(newEmail);
    if (newEmail === taken.email) await expect(confirmEmailChange(actor, "password123", (await tokenFor(user.id)).raw)).rejects.toBeInstanceOf(AccountTokenError);
  }
  expect(await prisma.notificationOutbox.count({ where: { template: "email_change_requested" } })).toBe(4);
});
test("parallel confirmation consumes once, revokes all sessions/grants/tokens, sends both notices and retains order ownership", async () => {
  const user = await createMember(); const society = await createOrganisationAccount(); const event = await createEvent({ organisationId: society.organisation.id });
  const order = await createOrder({ organisationId: society.organisation.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, userId: user.id });
  const invite = await createOrganisationStaffInvite({ organisationId: society.organisation.id, invitedById: society.user.id, email: user.email, role: "event_manager" });
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: "old-grant", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  await requestPasswordReset(user.email); await requestEmailChange({ id: user.id, authVersion: 0 }, "password123", "changed@example.com");
  const { raw } = await tokenFor(user.id); const actor = { id: user.id, authVersion: 0 };
  const results = await Promise.allSettled([confirmEmailChange(actor, "password123", raw), confirmEmailChange(actor, "password123", raw)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(updated.email).toBe("changed@example.com"); expect(updated.emailVerifiedAt).not.toBeNull(); expect(updated.authVersion).toBe(1);
  expect(await prisma.mfaGrant.count()).toBe(0); expect(await prisma.authToken.count({ where: { consumedAt: null, invalidatedAt: null } })).toBe(0);
  expect(await prisma.accountSecurityEvent.count({ where: { type: "email_changed" } })).toBe(1);
  expect((await prisma.notificationOutbox.findMany({ where: { template: "email_changed" } })).map(job => job.recipient).sort()).toEqual([user.email, "changed@example.com"].sort());
  expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).userId).toBe(user.id);
  expect((await prisma.organisationStaffInvite.findUniqueOrThrow({ where: { id: invite.invite.id } })).revokedAt).not.toBeNull();
});
test("two accounts racing for the same new address cannot overwrite or merge identity", async () => {
  const users = await Promise.all([createMember(), createMember()]);
  const actors = users.map(user => ({ id: user.id, authVersion: 0 }));
  await Promise.all(actors.map(actor => requestEmailChange(actor, "password123", "shared@example.com")));
  const tokens = await Promise.all(users.map(user => tokenFor(user.id)));
  const results = await Promise.allSettled(actors.map((actor, index) => confirmEmailChange(actor, "password123", tokens[index].raw)));
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(AccountTokenError);
  expect(await prisma.user.count({ where: { email: "shared@example.com" } })).toBe(1); expect(await prisma.user.count()).toBe(2);
});
test("resend and cancellation fence links and claimed jobs without changing the current email", async () => {
  const user = await createMember(); const actor = { id: user.id, authVersion: 0 };
  await requestEmailChange(actor, "password123", "first@example.com"); const old = await tokenFor(user.id);
  const claims = await notifications.claimNotificationJobs(new Date(Date.now() + 1000));
  await requestEmailChange(actor, "password123", "second@example.com");
  await expect(confirmEmailChange(actor, "password123", old.raw)).rejects.toBeInstanceOf(AccountTokenError);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await notifications.processNotificationClaim(claims.find(claim => claim.id === old.job.id)!)).toBe("skipped"); expect(fetch).not.toHaveBeenCalled();
  const current = await tokenFor(user.id); await cancelEmailChange(actor, "password123"); await cancelEmailChange(actor, "password123");
  await expect(confirmEmailChange(actor, "password123", current.raw)).rejects.toBeInstanceOf(AccountTokenError);
  expect((await readAccountSettings(actor)).pendingEmailChange).toBeNull();
  expect(await prisma.accountSecurityEvent.count({ where: { type: "email_change_cancelled" } })).toBe(1);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
});
test("expired, wrong-purpose, foreign-user, changed-email/version and disabled tokens cannot confirm", async () => {
  const user = await createMember(); const other = await createMember(); const actor = { id: user.id, authVersion: 0 };
  await requestEmailChange(actor, "password123", "new@example.com"); const { token, raw } = await tokenFor(user.id);
  await expect(confirmEmailChange(actor, "password123", raw, token.expiresAt)).rejects.toBeInstanceOf(AccountTokenError);
  await expect(confirmEmailChange({ id: other.id, authVersion: 0 }, "password123", raw)).rejects.toBeInstanceOf(AccountTokenError);
  for (const data of [{ purpose: "reset_password" }, { email: "changed-original@example.com" }, { authVersion: 1 }]) {
    await prisma.authToken.update({ where: { id: token.id }, data });
    await expect(confirmEmailChange(actor, "password123", raw)).rejects.toBeInstanceOf(AccountTokenError);
    await prisma.authToken.update({ where: { id: token.id }, data: { purpose: token.purpose, email: token.email, authVersion: token.authVersion } });
  }
  await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
  await expect(confirmEmailChange(actor, "password123", raw)).rejects.toMatchObject({ kind: "stale_session" });
});
test("all three actions require current password and the enrolled login grant even with MFA mode off", async () => {
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); const user = await createMember(); const actor = { id: user.id, authVersion: 0, mfaSessionId: "login-a" };
  await requestEmailChange(actor, "password123", "new@example.com"); const { raw } = await tokenFor(user.id);
  await prisma.userMfa.create({ data: { userId: user.id, enabledAt: new Date(), encryptedSecret: "retained-secret" } });
  for (const action of [() => requestEmailChange(actor, "wrong", "newer@example.com"), () => confirmEmailChange(actor, "wrong", raw), () => cancelEmailChange(actor, "wrong")]) await expect(action()).rejects.toMatchObject({ kind: "invalid_password" });
  for (const action of [() => requestEmailChange(actor, "password123", "newer@example.com"), () => confirmEmailChange(actor, "password123", raw), () => cancelEmailChange(actor, "password123")]) await expect(action()).rejects.toMatchObject({ kind: "mfa_required" });
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: mfaGrantDigest(actor.mfaSessionId)!, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  await confirmEmailChange(actor, "password123", raw); expect(await prisma.mfaGrant.count()).toBe(0);
  expect((await prisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } })).encryptedSecret).toBe("retained-secret");
});
test("enqueue failures roll request and confirmation back completely", async () => {
  const user = await createMember(); const actor = { id: user.id, authVersion: 0 };
  const spy = vi.spyOn(notifications, "enqueueNotification").mockRejectedValue(new Error("synthetic enqueue failure"));
  await expect(requestEmailChange(actor, "password123", "new@example.com")).rejects.toThrow("synthetic enqueue failure");
  expect(await prisma.authToken.count()).toBe(0); expect(await prisma.accountSecurityEvent.count()).toBe(0);
  spy.mockRestore(); await requestEmailChange(actor, "password123", "new@example.com"); const { token, raw } = await tokenFor(user.id);
  vi.spyOn(notifications, "enqueueNotification").mockRejectedValue(new Error("synthetic enqueue failure"));
  await expect(confirmEmailChange(actor, "password123", raw)).rejects.toThrow("synthetic enqueue failure");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).email).toBe(user.email);
  expect((await prisma.authToken.findUniqueOrThrow({ where: { id: token.id } })).consumedAt).toBeNull();
  expect(await prisma.accountSecurityEvent.count({ where: { type: "email_changed" } })).toBe(0);
});
test("worker binds email-change links to the new recipient/template and suppresses tampering", async () => {
  const user = await createMember(); await requestEmailChange({ id: user.id, authVersion: 0 }, "password123", "new@example.com"); const { job } = await tokenFor(user.id);
  await prisma.notificationOutbox.update({ where: { id: job.id }, data: { recipient: user.email } });
  const claims = await notifications.claimNotificationJobs(new Date(Date.now() + 1000)); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  expect(await notifications.processNotificationClaim(claims.find(claim => claim.id === job.id)!)).toBe("cancelled"); expect(fetch).not.toHaveBeenCalled();
});
test("email mutations retain origin/CSRF, live version, strict validation and fail-closed rate limits", async () => {
  const user = await createMember(); setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  const path = "http://localhost:3000/api/me/account/email/request"; const body = { currentPassword: "password123", newEmail: "new@example.com" };
  expect((await requestRoute(jsonRequest(path, body, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
  expect((await requestRoute(jsonRequest(path, body, { headers: { cookie: "authjs.session-token=synthetic" } }))).status).toBe(403);
  expect((await requestRoute(jsonRequest(path, { ...body, userId: user.id }))).status).toBe(400);
  setRateLimitTestBackendFailure(new Error("synthetic Redis failure")); expect((await requestRoute(jsonRequest(path, body))).status).toBe(503);
  setRateLimitTestBackendFailure(null); await prisma.user.update({ where: { id: user.id }, data: { authVersion: 1 } });
  for (const route of [requestRoute, confirmRoute, cancelRoute]) expect((await route(jsonRequest(path, body))).status).toBe(401);
});
test("email client mutations always fetch session CSRF instead of using anonymous exceptions", async () => {
  const fetch = vi.fn(async (input: string) => new Response(JSON.stringify(input === "/api/security/csrf" ? { token: "synthetic-csrf" } : { accepted: true }))); vi.stubGlobal("fetch", fetch);
  for (const action of ["request", "confirm", "cancel"]) await fetchJson(`/api/me/account/email/${action}`, { method: "POST", body: "{}" });
  expect(fetch.mock.calls).toHaveLength(6); expect(fetch.mock.calls.filter(call => call[0] === "/api/security/csrf")).toHaveLength(3);
});
