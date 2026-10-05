import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { compare } from "bcryptjs";
import { prisma } from "@/lib/db";
import { requestPasswordReset, requestVerification, consumePasswordReset, changePassword, AccountTokenError } from "@/lib/auth/account-lifecycle";
import { readAccountSettings, updateAccountProfile } from "@/lib/auth/account-settings";
import { getSessionIdentity } from "@/lib/auth/session-identity";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { decryptNotification } from "@/lib/email/notification-crypto";
import * as notifications from "@/lib/email/notification-outbox";
import { mfaGrantDigest } from "@/lib/security/csrf";
import { beginStaffMfaEnrollment, confirmStaffMfaEnrollment, verifyStaffMfa, totpCode } from "@/lib/security/staff-mfa";
import { createMember, createOrganisationAccount } from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest } from "@/tests/helpers/http";
import { POST as requestRoute } from "@/app/api/auth/password/request/route";
import { POST as confirmRoute } from "@/app/api/auth/password/confirm/route";
import { POST as changeRoute } from "@/app/api/me/account/password/route";
import { GET as settingsRoute } from "@/app/api/me/account/route";
import { GET as csrfRoute } from "@/app/api/security/csrf/route";
import { fetchJson } from "@/lib/client/api";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled, setRateLimitTestBackendFailure } from "@/lib/security/rate-limit";

beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });
async function rawToken(userId: string, purpose = "reset_password") {
  const token = await prisma.authToken.findFirstOrThrow({ where: { userId, purpose, consumedAt: null, invalidatedAt: null }, orderBy: { createdAt: "desc" } });
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { authTokenId: token.id } });
  const payload = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  return new URLSearchParams(new URL(payload.text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!;
}
test("reset issuance conceals unknown and disabled accounts and enforces origin, Redis and configuration uniformly", async () => {
  const user = await createMember(); const disabled = await createMember();
  await prisma.user.update({ where: { id: disabled.id }, data: { disabledAt: new Date() } });
  for (const email of [user.email, disabled.email, "missing@example.com"]) {
    const response = await requestRoute(jsonRequest("http://localhost:3000/api/auth/password/request", { email }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: true });
  }
  expect(await prisma.authToken.count()).toBe(1);
  expect((await requestRoute(jsonRequest("http://localhost:3000/api/auth/password/request", { email: user.email }, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
  setRateLimitTestBackendFailure(new Error("synthetic Redis failure"));
  expect((await requestRoute(jsonRequest("http://localhost:3000/api/auth/password/request", { email: user.email }))).status).toBe(503);
  setRateLimitTestBackendFailure(null); vi.stubEnv("EMAIL_FROM", "");
  for (const email of [user.email, "other@example.com"]) expect((await requestRoute(jsonRequest("http://localhost:3000/api/auth/password/request", { email }))).status).toBe(500);
});
test("reset is single use under contention, revokes sessions/grants/tokens, preserves verification/MFA, and records one private notice", async () => {
  const user = await createMember();
  await prisma.userMfa.create({ data: { userId: user.id, enabledAt: new Date(), encryptedSecret: "retained-enrollment" } });
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: "old-grant", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  await requestPasswordReset(user.email, "https://evil.example"); const raw = await rawToken(user.id);
  const results = await Promise.allSettled([consumePasswordReset(raw, "replacement123"), consumePasswordReset(raw, "replacement123")]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<unknown>).value).toEqual({ reset: true, callbackUrl: "/dashboard" });
  const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  expect(updated.authVersion).toBe(1); expect(updated.emailVerifiedAt).toEqual(user.emailVerifiedAt);
  expect(await compare("replacement123", updated.password)).toBe(true); expect(await compare("password123", updated.password)).toBe(false);
  expect(await prisma.mfaGrant.count()).toBe(0); expect((await prisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } })).encryptedSecret).toBe("retained-enrollment");
  expect(await prisma.accountSecurityEvent.count()).toBe(1);
  expect(await prisma.notificationOutbox.count({ where: { template: "password_changed", privacy: "security", organisationId: null } })).toBe(1);
  await expect(consumePasswordReset(raw, "replacement123")).rejects.toBeInstanceOf(AccountTokenError);
  setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  await expect(requireAuthenticatedUser()).rejects.toThrow("Authentication required");
  expect((await settingsRoute()).status).toBe(401); expect((await csrfRoute(jsonRequest("http://localhost:3000/api/security/csrf"))).status).toBe(401);
  expect(await getSessionIdentity(user.id, undefined)).toBeNull(); expect(await getSessionIdentity(user.id, 0)).toBeNull();
  expect(await getSessionIdentity(user.id, 1)).toMatchObject({ id: user.id });
});
test("latest reset wins and verification links cannot reset passwords", async () => {
  const user = await createMember(); await requestPasswordReset(user.email); const old = await rawToken(user.id);
  const [claim] = await notifications.claimNotificationJobs(new Date(Date.now() + 1000));
  await requestPasswordReset(user.email); await expect(consumePasswordReset(old, "replacement123")).rejects.toBeInstanceOf(AccountTokenError);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await notifications.processNotificationClaim(claim)).toBe("skipped"); expect(fetch).not.toHaveBeenCalled();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } }); await requestVerification(user.email);
  await expect(consumePasswordReset(await rawToken(user.id, "verify_account"), "replacement123")).rejects.toBeInstanceOf(AccountTokenError);
  await consumePasswordReset(await rawToken(user.id), "replacement123");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).emailVerifiedAt).toBeNull();
  expect(await prisma.authToken.count({ where: { consumedAt: null, invalidatedAt: null } })).toBe(0);
});
test("expired, altered identity/version, and disabled reset links are rejected", async () => {
  const user = await createMember(); await requestPasswordReset(user.email); const raw = await rawToken(user.id);
  const token = await prisma.authToken.findFirstOrThrow();
  await expect(consumePasswordReset(raw, "replacement123", token.expiresAt)).rejects.toBeInstanceOf(AccountTokenError);
  for (const change of [{ email: "altered@example.com" }, { authVersion: 1 }, { disabledAt: new Date() }]) {
    await prisma.user.update({ where: { id: user.id }, data: change });
    await expect(consumePasswordReset(raw, "replacement123")).rejects.toBeInstanceOf(AccountTokenError);
    await prisma.user.update({ where: { id: user.id }, data: { email: user.email, authVersion: 0, disabledAt: null } });
  }
  expect(await prisma.accountSecurityEvent.count()).toBe(0);
});
test("security notice failure rolls password, token, grants, version and ledger back", async () => {
  const user = await createMember(); await requestPasswordReset(user.email); const raw = await rawToken(user.id);
  await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: "retained-grant", verifiedAt: new Date(), expiresAt: new Date(Date.now() + 60000) } });
  vi.spyOn(notifications, "enqueueNotification").mockRejectedValue(new Error("synthetic enqueue failure"));
  await expect(consumePasswordReset(raw, "replacement123")).rejects.toThrow("synthetic enqueue failure");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).password).toBe(user.password);
  expect((await prisma.authToken.findFirstOrThrow()).consumedAt).toBeNull(); expect(await prisma.mfaGrant.count()).toBe(1);
  expect(await prisma.accountSecurityEvent.count()).toBe(0);
  await expect(changePassword({ id: user.id, authVersion: 0 }, "password123", "replacement123")).rejects.toThrow("synthetic enqueue failure");
  expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).authVersion).toBe(0);
});
test("password change requires current password and enrolled MFA even when enforcement is off", async () => {
  vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64")); vi.stubEnv("MFA_ENFORCEMENT_MODE", "enforce");
  const { user, organisation } = await createOrganisationAccount(); const now = new Date(Math.floor(Date.now() / 30000) * 30000);
  const setup = await beginStaffMfaEnrollment(user.id, user.email, now);
  await confirmStaffMfaEnrollment(user.id, totpCode(setup.secret, Math.floor(now.getTime() / 30000)), mfaGrantDigest("old-login")!, now);
  await prisma.organisationStaff.deleteMany({ where: { userId: user.id } });
  await prisma.organisation.update({ where: { id: organisation.id }, data: { accountUserId: null } });
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off"); const actor = { id: user.id, authVersion: 0, mfaSessionId: "new-login" };
  await expect(changePassword(actor, "wrong", "replacement123")).rejects.toMatchObject({ kind: "invalid_password" });
  await expect(changePassword(actor, "password123", "replacement123")).rejects.toMatchObject({ kind: "mfa_required" });
  const next = new Date(now.getTime() + 30000);
  await verifyStaffMfa(user.id, totpCode(setup.secret, Math.floor(next.getTime() / 30000)), mfaGrantDigest(actor.mfaSessionId)!, next);
  await changePassword(actor, "password123", "replacement123", next);
  expect(await prisma.mfaGrant.count()).toBe(0); expect((await prisma.userMfa.findUniqueOrThrow({ where: { userId: user.id } })).enabledAt).not.toBeNull();
  await expect(changePassword(actor, "replacement123", "another123")).rejects.toMatchObject({ kind: "stale_session" });
});
test("settings exposes only private editable fields and profile updates cannot revive stale identity", async () => {
  const user = await createMember(); const actor = { id: user.id, authVersion: 0 };
  const dto = await readAccountSettings(actor); expect(dto.user.id).toBe(user.id); expect(JSON.stringify(dto)).not.toMatch(/password|encryptedSecret|sessionDigest|authVersion/);
  await updateAccountProfile(actor, { firstName: "Updated", lastName: "Member", phone: "0400000000" });
  expect((await readAccountSettings(actor)).user.firstName).toBe("Updated");
  await prisma.user.update({ where: { id: user.id }, data: { authVersion: 1 } });
  await expect(updateAccountProfile(actor, { firstName: "Stale", lastName: "Member" })).rejects.toMatchObject({ kind: "stale_session" });
  await expect(readAccountSettings(actor)).rejects.toMatchObject({ kind: "stale_session" });
});
test("password byte limit, CSRF, rate failure and anonymous client boundaries are enforced", async () => {
  const user = await createMember(); await requestPasswordReset(user.email); const token = await rawToken(user.id);
  expect((await confirmRoute(jsonRequest("http://localhost:3000/api/auth/password/confirm", { token, newPassword: "😀".repeat(19) }))).status).toBe(400);
  await expect(consumePasswordReset(token, "😀".repeat(19))).rejects.toThrow();
  setMockSession({ userId: user.id, email: user.email, accountRole: "member" });
  expect((await changeRoute(jsonRequest("http://localhost:3000/api/me/account/password", { currentPassword: "password123", newPassword: "replacement123" }, { headers: { cookie: "authjs.session-token=synthetic" } }))).status).toBe(403);
  setRateLimitTestEnabled(false);
  expect((await changeRoute(jsonRequest("http://localhost:3000/api/me/account/password", { currentPassword: "password123", newPassword: "replacement123" }))).status).toBe(503);
  const fetch = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })); vi.stubGlobal("fetch", fetch);
  await fetchJson("/api/auth/password/request", { method: "POST", body: JSON.stringify({ email: user.email }) });
  await fetchJson("/api/auth/password/confirm", { method: "POST", body: JSON.stringify({ token, newPassword: "replacement123" }) });
  expect(fetch.mock.calls).toHaveLength(2);
});
