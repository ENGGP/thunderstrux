import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST as confirmRoute } from "@/app/api/guest/email/confirm/route";
import { POST as requestRoute } from "@/app/api/guest/email/request/route";
import { GET as sessionRoute } from "@/app/api/guest/session/route";
import GuestAccessPage from "@/app/guest/access/page";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { claimNotificationJobs, processNotificationClaim } from "@/lib/email/notification-outbox";
import { GuestAccessError, guestCookieName, readGuestSession, redeemGuestAccess, requestGuestAccess, verifyGuestCsrf } from "@/lib/guest/guest-access";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestBackendFailure, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { renderPage } from "@/tests/helpers/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }) }));

beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });

const base = "http://localhost:3000";
const request = (body: unknown, init?: RequestInit) => requestRoute(jsonRequest(`${base}/api/guest/email/request`, body, init));
const confirm = (token: string) => confirmRoute(jsonRequest(`${base}/api/guest/email/confirm`, { token }));

// The raw token as it appears in the emailed link, read back from the encrypted outbox.
async function emailedToken() {
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { template: "guest_access", status: "pending" }, orderBy: { createdAt: "desc" } });
  const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  const link = new URL(text.split("\n\n").at(-1)!);
  expect(link.pathname).toBe("/guest/access");
  return new URLSearchParams(link.hash.slice(1)).get("token")!;
}

function sessionCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  return { header, value: header.match(new RegExp(`${guestCookieName}=([^;]+)`))?.[1] ?? "" };
}

describe("guest email links", () => {
  test("a request is generic, stores only digests and sends an encrypted link", async () => {
    const response = await request({ email: " Sam.Lee@UQ.example ", callbackUrl: "/events/abc/checkout?quantity=2" });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(response.headers.get("cache-control")).toBe("no-store");

    const identity = await prisma.guestIdentity.findUniqueOrThrow({ where: { email: "sam.lee@uq.example" } });
    expect(identity.verifiedAt).toBeNull();
    const raw = await emailedToken();
    const grant = await prisma.guestAccessGrant.findFirstOrThrow();
    expect(grant).toMatchObject({ purpose: "checkout", callbackPath: "/events/abc/checkout?quantity=2", consumedAt: null });
    expect(JSON.stringify(grant)).not.toContain(raw);
  });

  test("a link redeems once, even when two redemptions race, and a newer link replaces an unused one", async () => {
    await requestGuestAccess("race@example.com");
    const first = await emailedToken();
    await requestGuestAccess("race@example.com", "https://evil.example/steal");
    const second = await emailedToken();
    await expect(redeemGuestAccess(first)).rejects.toBeInstanceOf(GuestAccessError);
    expect(await prisma.notificationOutbox.count({ where: { status: "cancelled", lastError: "superseded" } })).toBe(1);

    const results = await Promise.allSettled([redeemGuestAccess(second), redeemGuestAccess(second)]);
    const redeemed = results.filter((result) => result.status === "fulfilled");
    expect(redeemed).toHaveLength(1);
    // An unsafe return address falls back to Explore events.
    expect((redeemed[0] as PromiseFulfilledResult<{ callbackUrl: string }>).value.callbackUrl).toBe("/events");
    await expect(redeemGuestAccess(second)).rejects.toBeInstanceOf(GuestAccessError);
    expect((await prisma.guestIdentity.findUniqueOrThrow({ where: { email: "race@example.com" } })).verifiedAt).not.toBeNull();
    expect(await prisma.notificationOutbox.count({ where: { status: "cancelled", lastError: "consumed" } })).toBe(1);
  });

  test("wrong, malformed, expired and revoked links are refused", async () => {
    await requestGuestAccess("misuse@example.com");
    const raw = await emailedToken();
    const grant = await prisma.guestAccessGrant.findFirstOrThrow();
    for (const token of ["not-a-token", "A".repeat(43)]) await expect(redeemGuestAccess(token)).rejects.toBeInstanceOf(GuestAccessError);
    for (const change of [{ expiresAt: new Date(0) }, { revokedAt: new Date() }]) {
      await prisma.guestAccessGrant.update({ where: { id: grant.id }, data: change });
      await expect(redeemGuestAccess(raw)).rejects.toBeInstanceOf(GuestAccessError);
      await prisma.guestAccessGrant.update({ where: { id: grant.id }, data: { expiresAt: grant.expiresAt, revokedAt: null } });
    }
    expect((await prisma.guestAccessGrant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt).toBeNull();
  });

  test("opening the link page never redeems it; only the POST does", async () => {
    await requestGuestAccess("prefetch@example.com");
    const raw = await emailedToken();
    await renderPage(GuestAccessPage());
    expect((await prisma.guestAccessGrant.findFirstOrThrow()).consumedAt).toBeNull();
    expect(await import("@/app/api/guest/email/confirm/route")).not.toHaveProperty("GET");

    const response = await confirm(raw);
    expect(response.status).toBe(200);
    expect((await prisma.guestAccessGrant.findFirstOrThrow()).consumedAt).not.toBeNull();
  });

  test("the claimed email job for a used link is cancelled, not sent", async () => {
    await requestGuestAccess("worker@example.com");
    const raw = await emailedToken();
    const [claim] = await claimNotificationJobs(new Date(Date.now() + 1000));
    await redeemGuestAccess(raw);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await processNotificationClaim(claim)).toBe("skipped");

    // A link revoked behind the outbox's back is still never sent.
    await requestGuestAccess("worker@example.com");
    await prisma.guestAccessGrant.updateMany({ where: { consumedAt: null }, data: { revokedAt: new Date() } });
    const [revoked] = await claimNotificationJobs(new Date(Date.now() + 1000));
    expect(await processNotificationClaim(revoked)).toBe("cancelled");
    expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: revoked.id } })).toMatchObject({ status: "cancelled", lastError: "obsolete_token" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("guest sessions", () => {
  test("redemption sets an HttpOnly, SameSite cookie whose session has its own CSRF token", async () => {
    await requestGuestAccess("cookie@example.com", "/events/abc/checkout");
    const response = await confirm(await emailedToken());
    expect(await parseJsonResponse(response)).toEqual({ callbackUrl: "/events/abc/checkout" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = sessionCookie(response);
    expect(cookie.header).toMatch(/HttpOnly/i);
    expect(cookie.header).toMatch(/SameSite=lax/i);
    expect(cookie.header).toMatch(/Path=\//);
    // The database holds only the session digest.
    expect(JSON.stringify(await prisma.guestAccessGrant.findFirstOrThrow())).not.toContain(cookie.value);

    const session = await sessionRoute(new Request(`${base}/api/guest/session`, { headers: { cookie: `${guestCookieName}=${cookie.value}` } }));
    expect(session.headers.get("cache-control")).toBe("no-store");
    const body = await parseJsonResponse(session);
    expect(body).toMatchObject({ email: "cookie@example.com", csrfToken: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(verifyGuestCsrf(cookie.value, body.csrfToken)).toBe(true);
    expect(verifyGuestCsrf(cookie.value, "0".repeat(64))).toBe(false);
    expect(verifyGuestCsrf("B".repeat(43), body.csrfToken)).toBe(false);
  });

  test("an expired, revoked or unknown session reads as none", async () => {
    await requestGuestAccess("expiry@example.com");
    const { sessionId } = await redeemGuestAccess(await emailedToken());
    expect(await readGuestSession(sessionId)).toMatchObject({ email: "expiry@example.com" });
    expect(await readGuestSession(sessionId, new Date(Date.now() + 3 * 60 * 60 * 1000))).toBeNull();
    expect(await readGuestSession("C".repeat(43))).toBeNull();
    expect(await readGuestSession(undefined)).toBeNull();
    await prisma.guestAccessGrant.updateMany({ data: { revokedAt: new Date() } });
    expect(await readGuestSession(sessionId)).toBeNull();
    const response = await sessionRoute(new Request(`${base}/api/guest/session`, { headers: { cookie: `${guestCookieName}=${sessionId}` } }));
    expect(response.status).toBe(401);
  });
});

describe("guest request protection", () => {
  test("untrusted origins are refused", async () => {
    const response = await request({ email: "origin@example.com" }, { headers: { origin: "https://evil.example" } });
    expect(response.status).toBe(403);
    expect(await prisma.guestAccessGrant.count()).toBe(0);
  });

  test("limits per address and fail closed when request protection is down", async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) expect((await request({ email: "limit@example.com" })).status).toBe(202);
    expect((await request({ email: "limit@example.com" })).status).toBe(429);

    await requestGuestAccess("down@example.com");
    const raw = await emailedToken();
    const grants = await prisma.guestAccessGrant.count();
    setRateLimitTestBackendFailure(new Error("redis down"));
    expect((await request({ email: "new@example.com" })).status).toBe(503);
    expect((await confirm(raw)).status).toBe(503);
    expect(await prisma.guestAccessGrant.count()).toBe(grants);
    expect(await prisma.guestAccessGrant.count({ where: { consumedAt: { not: null } } })).toBe(0);
  });
});
