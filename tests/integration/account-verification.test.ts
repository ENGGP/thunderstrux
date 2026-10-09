import { readStaffInviteToken } from "@/tests/helpers/staff-invites";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { signupAccount, requestVerification, consumeVerification, AccountTokenError } from "@/lib/auth/account-lifecycle";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { claimNotificationJobs, processNotificationClaim } from "@/lib/email/notification-outbox";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as requestRoute } from "@/app/api/auth/verification/request/route";
import { POST as confirmRoute } from "@/app/api/auth/verification/confirm/route";
import { POST as join } from "@/app/api/orgs/[orgSlug]/join/route";
import { POST as bootstrap } from "@/app/api/orgs/route";
import { requireAuthenticatedUser } from "@/lib/auth/access";
import { jsonRequest } from "@/tests/helpers/http";
import { createUser, createOrganisationAccount, createEvent } from "@/tests/helpers/test-data";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { createOrganisationStaffInvite, acceptOrganisationStaffInvite } from "@/lib/staff/invites";
import { setMockSession } from "@/tests/helpers/auth";
import { fetchJson } from "@/lib/client/api";
import * as notifications from "@/lib/email/notification-outbox";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled, setRateLimitTestBackendFailure } from "@/lib/security/rate-limit";
beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });
const input = { email: "verify@example.com", password: "password123", accountRole: "member" as const, callbackUrl: "/events/example" };
async function rawToken() {
  const token = await prisma.authToken.findFirstOrThrow({ where: { invalidatedAt: null, consumedAt: null }, orderBy: { createdAt: "desc" } });
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { authTokenId: token.id } });
  const payload = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  return new URLSearchParams(new URL(payload.text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!;
}
test("generic normalized signup races create one unverified identity and encrypted intent", async () => {
  const responses = await Promise.all([signup(jsonRequest("http://localhost:3000/api/auth/signup", { ...input, email: " Verify@Example.com " })), signup(jsonRequest("http://localhost:3000/api/auth/signup", input))]);
  for (const response of responses) { expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: true }); }
  expect(await prisma.user.count()).toBe(1); expect(await prisma.authToken.count()).toBe(1); expect(await prisma.notificationOutbox.count()).toBe(1);
  const user = await prisma.user.findFirstOrThrow(); expect(user.emailVerifiedAt).toBeNull();
  const raw = await rawToken(); expect((await prisma.authToken.findFirstOrThrow()).tokenHash).not.toContain(raw);
  await signupAccount(input); expect(await prisma.authToken.count()).toBe(1);
});
test("notification configuration failure rolls signup/token back", async () => {
  vi.stubEnv("EMAIL_FROM", ""); await expect(signupAccount(input)).rejects.toThrow();
  expect(await prisma.user.count()).toBe(0); expect(await prisma.authToken.count()).toBe(0); expect(await prisma.notificationOutbox.count()).toBe(0);
});
test("notification enqueue failure rolls the entire signup transaction back", async () => {
  vi.spyOn(notifications, "enqueueNotification").mockRejectedValue(new Error("synthetic enqueue failure"));
  await expect(signupAccount(input)).rejects.toThrow("synthetic enqueue failure");
  expect(await prisma.user.count()).toBe(0); expect(await prisma.authToken.count()).toBe(0);
});
test("issuance misconfiguration has the same response for known and unknown addresses", async () => {
  await signupAccount(input); vi.stubEnv("EMAIL_FROM", "");
  const statuses = await Promise.all([input.email, "absent@example.com"].map(async email =>
    (await requestRoute(jsonRequest("http://localhost:3000/api/auth/verification/request", { email }))).status));
  expect(statuses).toEqual([500, 500]);
});
test("explicit verification consumes once under concurrent requests and keeps safe callback", async () => {
  await signupAccount(input); const raw = await rawToken();
  const results = await Promise.allSettled([consumeVerification(raw), consumeVerification(raw)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect((results.find(result => result.status === "fulfilled") as PromiseFulfilledResult<unknown>).value).toEqual({ verified: true, callbackUrl: "/events/example" });
  expect((await prisma.user.findFirstOrThrow()).emailVerifiedAt).not.toBeNull();
  await expect(consumeVerification(raw)).rejects.toBeInstanceOf(AccountTokenError);
});
test("resend supersedes old tokens and fences already claimed security jobs", async () => {
  await signupAccount(input); const old = await rawToken(); const [claim] = await claimNotificationJobs(new Date(Date.now() + 1000));
  await requestVerification(input.email, "https://evil.example");
  await expect(consumeVerification(old)).rejects.toBeInstanceOf(AccountTokenError);
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch); expect(await processNotificationClaim(claim)).toBe("skipped"); expect(fetch).not.toHaveBeenCalled();
  expect(await consumeVerification(await rawToken())).toEqual({ verified: true, callbackUrl: "/dashboard" });
});
test("expired, wrong-purpose, changed-email, disabled and stale-version tokens are denied", async () => {
  await signupAccount(input); const raw = await rawToken(); const user = await prisma.user.findFirstOrThrow();
  const token = await prisma.authToken.findFirstOrThrow();
  for (const change of [{ purpose: "reset_password" }, { expiresAt: new Date(0) }]) {
    await prisma.authToken.update({ where: { id: token.id }, data: change }); await expect(consumeVerification(raw)).rejects.toBeInstanceOf(AccountTokenError);
    await prisma.authToken.update({ where: { id: token.id }, data: { purpose: token.purpose, expiresAt: token.expiresAt } });
  }
  for (const change of [{ email: "changed@example.com" }, { disabledAt: new Date() }, { authVersion: 1 }]) {
    await prisma.user.update({ where: { id: user.id }, data: change }); await expect(consumeVerification(raw)).rejects.toBeInstanceOf(AccountTokenError);
    await prisma.user.update({ where: { id: user.id }, data: { email: user.email, disabledAt: null, authVersion: 0 } });
  }
});
test("anonymous requests are generic, trusted-origin protected and fail closed", async () => {
  for (const email of [input.email, "absent@example.com"]) {
    const response = await requestRoute(jsonRequest("http://localhost:3000/api/auth/verification/request", { email }));
    expect(response.status).toBe(202); expect(await response.json()).toEqual({ accepted: true });
  }
  expect((await requestRoute(jsonRequest("http://localhost:3000/api/auth/verification/request", input, { headers: { Origin: "https://evil.example" } }))).status).toBe(403);
  setRateLimitTestEnabled(false); expect((await requestRoute(jsonRequest("http://localhost:3000/api/auth/verification/request", { email: input.email }))).status).toBe(503);
  setRateLimitTestEnabled(true); setRateLimitTestBackendFailure(new Error("synthetic Redis failure"));
  expect((await confirmRoute(jsonRequest("http://localhost:3000/api/auth/verification/confirm", { token: "synthetic" }))).status).toBe(503);
});
test("unverified joins/bootstrap and disabled session access are denied using live state", async () => {
  const user = await createUser({ accountRole: "organisation" }); const society = await createOrganisationAccount();
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
  expect((await bootstrap(jsonRequest("http://localhost:3000/api/orgs", { name: "Unverified" }))).status).toBe(403);
  await prisma.user.update({ where: { id: user.id }, data: { accountRole: "member" } });
  expect((await join(jsonRequest("http://localhost:3000/api/orgs/x/join", {}), { params: Promise.resolve({ orgSlug: society.organisation.slug }) })).status).toBe(403);
  expect(await prisma.organisationMember.count({ where: { userId: user.id } })).toBe(0);
  await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
  await expect(requireAuthenticatedUser()).rejects.toThrow("Authentication required");
});
test("direct checkout and invite transactions reject unverified identities before writes", async () => {
  const user = await createUser(); const society = await createOrganisationAccount({ stripeReady: true });
  const event = await createEvent({ organisationId: society.organisation.id, status: "published" });
  const invite = await createOrganisationStaffInvite({ organisationId: society.organisation.id, actor: { id: society.user.id, authVersion: society.user.authVersion }, email: user.email, role: "event_manager" });
  await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: null } });
  await expect(createEventCheckout({ userId: user.id, eventId: event.id, ticketTypeId: event.ticketTypes[0].id, quantity: 1 })).rejects.toThrow("Verify your email");
  await expect(acceptOrganisationStaffInvite({ token: await readStaffInviteToken(invite.invite.id), actor: { id: user.id, authVersion: user.authVersion } })).rejects.toThrow("Verify your email");
  expect(await prisma.order.count()).toBe(0); expect(await prisma.ticketReservation.count()).toBe(0);
  expect(await prisma.organisationStaff.count({ where: { userId: user.id } })).toBe(0);
});
test("deleted token associations and newly verified/disabled users suppress queued messages", async () => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  for (const action of ["delete", "verified", "disabled"]) {
    const email = `${action}@example.com`; await signupAccount({ ...input, email });
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const [claim] = await claimNotificationJobs(new Date(Date.now() + 1000));
    if (action === "delete") await prisma.authToken.deleteMany({ where: { userId: user.id } });
    else await prisma.user.update({ where: { id: user.id }, data: action === "verified" ? { emailVerifiedAt: new Date() } : { disabledAt: new Date() } });
    expect(await processNotificationClaim(claim)).toBe("cancelled");
  }
  expect(fetch).not.toHaveBeenCalled();
});
test("anonymous verification client sends explicit POST without requiring a login CSRF token", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ accepted: true }), { status: 202 })); vi.stubGlobal("fetch", fetch);
  await fetchJson("/api/auth/verification/request", { method: "POST", body: JSON.stringify({ email: input.email }) });
  await fetchJson("/api/auth/verification/confirm", { method: "POST", body: JSON.stringify({ token: "synthetic" }) });
  expect(fetch.mock.calls).toHaveLength(2);
  const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
  expect(calls.map(call => call[0])).toEqual(["/api/auth/verification/request", "/api/auth/verification/confirm"]);
});
