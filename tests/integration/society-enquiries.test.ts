import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/orgs/[orgSlug]/enquiries/route";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { renderNotification } from "@/lib/email/templates";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestBackendFailure, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createEvent, createMember, createOrganisationAccount, createOrganisationStaff } from "@/tests/helpers/test-data";

// "Contact {society}" (DEBT-002), as Humanitix's "Contact host".
beforeEach(() => { setRateLimitTestEnabled(true); setRateLimitTestBackend(createTestRateLimitBackend()); setRateLimitTestBackendFailure(null); });
afterEach(() => { setRateLimitTestEnabled(null); setRateLimitTestBackend(null); setRateLimitTestBackendFailure(null); });

const enquiry = { name: "Sam Buyer", email: "Sam.Buyer@example.com", message: "Is there step-free access to the venue?" };
const send = (slug: string, body: unknown, init: RequestInit = {}) =>
  POST(jsonRequest(`http://localhost/api/orgs/${slug}/enquiries`, body, init), routeContext({ orgSlug: slug }));
async function sent(organisationId: string) {
  const jobs = await prisma.notificationOutbox.findMany({ where: { organisationId, template: "society_enquiry" }, orderBy: { recipient: "asc" } });
  return jobs.map((job) => ({ recipient: job.recipient, privacy: job.privacy, email: decryptNotification(job.encryptedPayload, job.id) as { subject: string; text: string; html: string; replyTo?: string } }));
}

describe("society enquiries", () => {
  test("go to the sign-up account and the published address, answered by replying, and name the event", async () => {
    const { user, organisation } = await createOrganisationAccount({ name: "Film Society" });
    await prisma.organisation.update({ where: { id: organisation.id }, data: { supportEmail: "Hello@Film.example" } });
    // A second owner isn't copied while the sign-up account still owns the society.
    await createOrganisationStaff({ organisationId: organisation.id, userId: (await createMember()).id, role: "owner" });
    const event = await createEvent({ organisationId: organisation.id, status: "published", title: "Noir night" });

    const response = await send(organisation.slug, { ...enquiry, eventId: event.id, orderReference: "7xk2pq" });
    expect(response.status).toBe(202);
    const body = await parseJsonResponse(response);
    // The society's own addresses never reach the sender.
    expect(JSON.stringify(body)).not.toContain(user.email);
    expect(JSON.stringify(body)).not.toContain("film.example");

    const jobs = await sent(organisation.id);
    expect(jobs.map((job) => job.recipient)).toEqual([user.email, "hello@film.example"].sort());
    for (const job of jobs) {
      expect(job.privacy).toBe("business");
      expect(job.email.subject).toBe("Noir night enquiry from Sam Buyer");
      expect(job.email.replyTo).toBe("sam.buyer@example.com");
      expect(job.email.text).toContain("About: Noir night");
      expect(job.email.text).toContain("Order: 7XK2PQ");
      expect(job.email.text).toContain(enquiry.message);
    }
  });

  test("reach the owners when the sign-up account no longer owns the society", async () => {
    const { user, organisation } = await createOrganisationAccount();
    await prisma.organisationStaff.updateMany({ where: { organisationId: organisation.id, userId: user.id }, data: { status: "revoked", revokedAt: new Date() } });
    const owner = await createMember();
    await createOrganisationStaff({ organisationId: organisation.id, userId: owner.id, role: "owner" });
    await createOrganisationStaff({ organisationId: organisation.id, userId: (await createMember()).id, role: "admin" });

    expect((await send(organisation.slug, enquiry)).status).toBe(202);
    const jobs = await sent(organisation.id);
    expect(jobs.map((job) => job.recipient)).toEqual([owner.email]);
    expect(jobs[0].email.subject).toBe(`${organisation.name} enquiry from Sam Buyer`);
  });

  test("refuse an unknown society and a draft event the same way, and check the input", async () => {
    const { organisation } = await createOrganisationAccount();
    const draft = await createEvent({ organisationId: organisation.id, status: "draft" });
    const other = await createEvent({ organisationId: (await createOrganisationAccount()).organisation.id, status: "published" });

    const missing = await send("no-such-society", enquiry);
    const drafted = await send(organisation.slug, { ...enquiry, eventId: draft.id });
    const foreign = await send(organisation.slug, { ...enquiry, eventId: other.id });
    expect([missing.status, drafted.status, foreign.status]).toEqual([404, 404, 404]);
    const [a, b] = [await parseJsonResponse(missing), await parseJsonResponse(drafted)];
    expect(a.error.message).toBe(b.error.message);

    expect((await send(organisation.slug, { ...enquiry, message: "x".repeat(1201) })).status).toBe(400);
    expect((await send(organisation.slug, { ...enquiry, email: "not-an-email" })).status).toBe(400);
    expect((await send(organisation.slug, { ...enquiry, cc: "someone@example.com" })).status).toBe(400);
    expect((await send(organisation.slug, enquiry, { headers: { origin: "https://evil.example" } })).status).toBe(403);
    // Signed-in or not, it carries no session CSRF token: it reads no session.
    expect((await send(organisation.slug, { ...enquiry, eventId: draft.id }, { headers: { cookie: "authjs.session-token=synthetic" } })).status).toBe(404);
    expect(await prisma.notificationOutbox.count({ where: { organisationId: organisation.id } })).toBe(0);
  });

  test("are limited per sender and fail closed", async () => {
    const { organisation } = await createOrganisationAccount();
    for (let attempt = 0; attempt < 5; attempt += 1) expect((await send(organisation.slug, enquiry)).status).toBe(202);
    expect((await send(organisation.slug, enquiry)).status).toBe(429);
    setRateLimitTestBackendFailure(new Error("redis down"));
    expect((await send(organisation.slug, { ...enquiry, email: "other@example.com" })).status).toBe(503);
  });

  test("only an enquiry carries a reply-to address", () => {
    expect(renderNotification("society_enquiry", { message: "Hi", replyTo: "a@example.com" }).replyTo).toBe("a@example.com");
    expect(() => renderNotification("business_notice", { message: "Hi", replyTo: "a@example.com" })).toThrow();
    expect(() => renderNotification("society_enquiry", { message: "Hi", replyTo: "a@example.com\r\nBcc: b@example.com" })).toThrow();
  });
});
