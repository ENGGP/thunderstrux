import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { enqueueNotification, claimNotificationJobs, processNotificationClaim, processNotificationBatch, requeueBusinessNotification } from "@/lib/email/notification-outbox";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { renderNotification } from "@/lib/email/templates";
import { POST as requeueRoute } from "@/app/api/notifications/[jobId]/requeue/route";
import { jsonRequest } from "@/tests/helpers/http";
import { createMember, createOrganisationAccount } from "@/tests/helpers/test-data";
import { setMockSession } from "@/tests/helpers/auth";
import { GET } from "@/app/api/notifications/route";

describe("general notification outbox", () => {
  const saved = { key: process.env.NOTIFICATION_ENCRYPTION_KEY, from: process.env.EMAIL_FROM, origin: process.env.NEXT_PUBLIC_APP_URL, api: process.env.RESEND_API_KEY };
  beforeEach(() => {
    process.env.NOTIFICATION_ENCRYPTION_KEY = Buffer.alloc(32, 4).toString("base64");
    process.env.EMAIL_FROM = "Thunderstrux <security@example.com>";
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
    process.env.RESEND_API_KEY = "re_synthetic";
  });
  afterEach(() => {
    for (const [name, value] of Object.entries({ NOTIFICATION_ENCRYPTION_KEY: saved.key, EMAIL_FROM: saved.from, NEXT_PUBLIC_APP_URL: saved.origin, RESEND_API_KEY: saved.api })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    vi.unstubAllGlobals();
  });
  const input = () => ({ eventKey: "token/synthetic", recipient: "Buyer@Example.com", template: "verify_account" as const,
    payload: { message: "Verify <script>alert(1)</script>", link: "http://localhost:3000/verify-email#token=synthetic-token" } });
  async function queue() { return prisma.$transaction(tx => enqueueNotification(tx, input())); }
  function provider(status = 200) {
    const fetch = vi.fn(async () => new Response(JSON.stringify(status === 200 ? { id: "synthetic-message" } : { token: "DO_NOT_STORE", email: "private@example.com" }), { status }));
    vi.stubGlobal("fetch", fetch); return fetch;
  }

  test("enqueue is atomic, encrypted, normalized, and deduplicated", async () => {
    const user = await createMember();
    await expect(prisma.$transaction(async tx => { await enqueueNotification(tx, { ...input(), userId: user.id }); throw new Error("rollback"); })).rejects.toThrow("rollback");
    expect(await prisma.notificationOutbox.count()).toBe(0);
    const outcomes = await Promise.all([queue(), queue()]);
    expect(outcomes.filter(item => item.enqueued)).toHaveLength(1);
    const job = await prisma.notificationOutbox.findFirstOrThrow();
    expect(job.recipient).toBe("buyer@example.com");
    expect(job.encryptedPayload).not.toContain("synthetic-token");
    expect(JSON.stringify(decryptNotification(job.encryptedPayload, job.id))).toContain("synthetic-token");
    expect(() => decryptNotification(job.encryptedPayload, "different-job")).toThrow();
  });
  test("templates escape injection and reject foreign/credential links", () => {
    expect(renderNotification("verify_account", input().payload).html).not.toContain("<script>");
    for (const link of ["https://evil.example/reset", "http://user:pass@localhost:3000/reset"]) {
      expect(() => renderNotification("reset_password", { message: "Reset", link })).toThrow();
    }
  });
  test("claims are exclusive and rotating lease fences a stale worker", async () => {
    await queue(); const now = new Date(Date.now() + 1000);
    const claims = await Promise.all([claimNotificationJobs(now), claimNotificationJobs(now)]);
    expect(claims.flat()).toHaveLength(1);
    const old = claims.flat()[0];
    const [newer] = await claimNotificationJobs(new Date(now.getTime() + 601000));
    expect(newer.processingToken).not.toBe(old.processingToken);
    const fetch = provider();
    expect(await processNotificationClaim(old)).toBe("skipped"); expect(fetch).not.toHaveBeenCalled();
    expect(await processNotificationClaim(newer)).toBe("sent");
  });
  test("provider acceptance records immutable payload and stable key", async () => {
    const queued = await queue(); const fetch = provider();
    process.env.EMAIL_FROM = "changed@example.com";
    const result = await processNotificationBatch(); expect(result.sent).toBe(1);
    const options = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(options[1].body)).from).toContain("security@example.com");
    expect(options[1].headers).toMatchObject({ "Idempotency-Key": `notification/${queued.id}` });
    expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: queued.id! } })).toMatchObject({ status: "sent", providerMessageId: "synthetic-message" });
    expect((await processNotificationBatch()).claimed).toBe(0);
  });
  test("accepted provider request with failed database finalization retries the same request", async () => {
    await queue(); const fetch = provider(); const [claim] = await claimNotificationJobs();
    const update = prisma.notificationOutbox.updateMany.bind(prisma.notificationOutbox);
    const spy = vi.spyOn(prisma.notificationOutbox, "updateMany").mockImplementation(args => {
      if (args?.data.status === "sent") throw new Error("finalization unavailable");
      return update(args);
    });
    await expect(processNotificationClaim(claim)).rejects.toThrow("finalization"); spy.mockRestore();
    const [reclaimed] = await claimNotificationJobs(new Date(Date.now() + 601000));
    expect(await processNotificationClaim(reclaimed)).toBe("sent");
    const calls = fetch.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls[0][0]).toBe(calls[1][0]);
    expect(calls[0][1].headers).toEqual(calls[1][1].headers);
    expect(calls[0][1].body).toBe(calls[1][1].body);
  });
  test("bounded failures do not store provider bodies or claim exhausted jobs", async () => {
    await queue(); provider(500);
    for (let attempt = 0; attempt < 5; attempt++) {
      await prisma.notificationOutbox.updateMany({ data: { nextAttemptAt: new Date(0) } });
      await processNotificationBatch();
    }
    const job = await prisma.notificationOutbox.findFirstOrThrow();
    expect(job).toMatchObject({ status: "failed", attempts: 5, lastError: "provider_unavailable" });
    expect(JSON.stringify(job)).not.toContain("DO_NOT_STORE");
    expect(await claimNotificationJobs()).toHaveLength(0);
  });
  test("expired jobs never reach provider and uncertain old sends require review", async () => {
    await prisma.$transaction(tx => enqueueNotification(tx, { ...input(), expiresAt: new Date(0) }));
    const fetch = provider(); expect((await processNotificationBatch()).cancelled).toBe(1); expect(fetch).not.toHaveBeenCalled();
    await prisma.notificationOutbox.updateMany({ data: { status: "pending", expiresAt: null, firstAttemptAt: new Date(Date.now() - 24 * 3600000) } });
    expect((await processNotificationBatch()).failed).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
  test("business view conceals security and foreign jobs; requeue is scoped and audited", async () => {
    const owner = await createOrganisationAccount(); const foreign = await createOrganisationAccount();
    await queue();
    const business = await prisma.$transaction(tx => enqueueNotification(tx, { ...input(), eventKey: "business", template: "business_notice", organisationId: owner.organisation.id }));
    await prisma.notificationOutbox.updateMany({ data: { status: "failed", lastError: "provider_unavailable" } });
    setMockSession({ userId: foreign.user.id, email: foreign.user.email, accountRole: "organisation" });
    expect((await (await GET()).json()).jobs).toHaveLength(0);
    await expect(requeueBusinessNotification({ jobId: business.id!, organisationId: owner.organisation.id, actorUserId: foreign.user.id, reason: "Provider issue fixed" })).rejects.toThrow();
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    expect((await (await GET()).json()).jobs).toHaveLength(1);
    await requeueBusinessNotification({ jobId: business.id!, organisationId: owner.organisation.id, actorUserId: owner.user.id, reason: "Provider issue fixed" });
    expect(await prisma.auditLog.count({ where: { action: "notification.requeued" } })).toBe(1);
    await expect(requeueBusinessNotification({ jobId: business.id!, organisationId: owner.organisation.id, actorUserId: owner.user.id, reason: "Provider issue fixed" })).rejects.toThrow();
  });
  test("route guard denies untrusted origin and conceals a private security job", async () => {
    const owner = await createOrganisationAccount(); const job = await queue();
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    const context = { params: Promise.resolve({ jobId: job.id! }) };
    const untrusted = new Request("http://localhost:3000/api/notifications/job/requeue", { method: "POST", headers: { Origin: "https://evil.example" } });
    expect((await requeueRoute(untrusted, context)).status).toBe(403);
    expect((await requeueRoute(jsonRequest("http://localhost:3000/api/notifications/job/requeue", { method: "POST", body: { reason: "Provider issue fixed" } }), context)).status).toBe(404);
  });
  test("invalid cursor and excessive batches fail safely", async () => {
    await expect(claimNotificationJobs(new Date(), 101)).rejects.toThrow("batch");
    const owner = await createOrganisationAccount();
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    expect((await GET(new Request("http://localhost:3000/api/notifications?cursor=invalid"))).status).toBe(400);
  });
  test("payload tampering fails before provider I/O", async () => {
    await queue(); const fetch = provider();
    await prisma.notificationOutbox.updateMany({ data: { encryptedPayload: "invalid" } });
    expect((await processNotificationBatch()).failed).toBe(1); expect(fetch).not.toHaveBeenCalled();
  });
});
