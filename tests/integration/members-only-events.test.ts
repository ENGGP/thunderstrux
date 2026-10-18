import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import sharp from "sharp";
import { GET as publicEventRoute } from "@/app/api/public/events/[eventId]/route";
import { memberEventAsset, publicAsset, uploadAsset } from "@/lib/assets/service";
import type { AssetStorage } from "@/lib/assets/storage";
import { prisma } from "@/lib/db";
import { decryptNotification } from "@/lib/email/notification-crypto";
import { EventLifecycleValidationError, getDashboardEvent, setOrganisationEventPublication } from "@/lib/events/event-lifecycle";
import { getEventForViewer, getPublishedEvents } from "@/lib/events/public-events";
import { readGuestSession, redeemGuestAccess, requestGuestAccess } from "@/lib/guest/guest-access";
import { publicOrganisation } from "@/lib/organisations/public-organisations";
import { createEventCheckout } from "@/lib/payments/checkout-creation";
import { createTestRateLimitBackend, setRateLimitTestBackend, setRateLimitTestEnabled } from "@/lib/security/rate-limit";
import { createEvent, createMember, createMembershipGrant, createOrganisationAccount, joinOrganisation, unique } from "@/tests/helpers/test-data";

const stripe = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/stripe", () => ({
  StripeConfigurationError: class StripeConfigurationError extends Error {},
  getAppUrl: () => "http://localhost:3000",
  getStripe: () => ({ checkout: { sessions: { create: stripe.create } } })
}));
beforeEach(() => {
  stripe.create.mockImplementation(async () => ({ id: unique("cs_members"), url: "https://checkout.stripe.test/pay" }));
  setRateLimitTestEnabled(true);
  setRateLimitTestBackend(createTestRateLimitBackend());
});
afterEach(() => {
  stripe.create.mockReset();
  setRateLimitTestEnabled(null);
  setRateLimitTestBackend(null);
});

const day = 86_400_000;
const open = { entitlements: ["members_only_events" as const] };

// A published members-only event whose every detail carries a sentinel, so a
// leak of any field shows up in the serialised result.
async function membersOnlyEvent() {
  const account = await createOrganisationAccount({ stripeReady: true });
  const sentinel = unique("SENTINEL");
  const created = await createEvent({
    organisationId: account.organisation.id, status: "published", visibility: "members_only", title: `${sentinel}-title`,
    ticketTypes: [{ name: `${sentinel}-ticket`, price: 1500, quantity: 20 }]
  });
  const event = await prisma.event.update({
    where: { id: created.id }, data: { description: `${sentinel}-description`, location: `${sentinel}-place` }, include: { ticketTypes: true }
  });
  return { ...account, event, ticketType: event.ticketTypes[0], sentinel };
}

async function verifiedGuest() {
  const email = `${unique("guest")}@example.com`;
  await requestGuestAccess(email);
  const job = await prisma.notificationOutbox.findFirstOrThrow({ where: { recipient: email }, orderBy: { createdAt: "desc" } });
  const { text } = decryptNotification(job.encryptedPayload, job.id) as { text: string };
  const { sessionId } = await redeemGuestAccess(new URLSearchParams(new URL(text.split("\n\n").at(-1)!).hash.slice(1)).get("token")!);
  const guest = (await readGuestSession(sessionId))!;
  return { grantId: guest.grantId, guestIdentityId: guest.guestIdentityId };
}

describe("members-only events", () => {
  test("the event opens only to a member whose running membership unlocks it; everyone else gets the gate with nothing about the event", async () => {
    const fixture = await membersOnlyEvent();
    const orgId = fixture.organisation.id;
    const now = Date.now();
    const viewers: Array<[string, () => Promise<string | null>, string]> = [
      ["signed out", async () => null, "signed_out"],
      ["unverified", async () => (await prisma.user.update({ where: { id: (await createMember()).id }, data: { emailVerifiedAt: null } })).id, "unverified"],
      ["free join", async () => { const member = await createMember(); await joinOrganisation(member.id, orgId); return member.id; }, "no_membership"],
      ["expired", async () => { const member = await createMember(); await createMembershipGrant(orgId, member.id, member.email, { ...open, startsAt: new Date(now - 100 * day), endsAt: new Date(now - day) }); return member.id; }, "no_membership"],
      ["upcoming", async () => { const member = await createMember(); await createMembershipGrant(orgId, member.id, member.email, { ...open, startsAt: new Date(now + day), endsAt: new Date(now + 100 * day) }); return member.id; }, "upcoming"],
      ["revoked", async () => {
        const member = await createMember();
        const grant = await createMembershipGrant(orgId, member.id, member.email, open);
        await prisma.membershipGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revocationReason: "Synthetic test revocation" } });
        return member.id;
      }, "no_membership"],
      ["without the right", async () => { const member = await createMember(); await createMembershipGrant(orgId, member.id, member.email); return member.id; }, "not_included"],
      ["another society's member", async () => { const member = await createMember(); await createMembershipGrant((await createOrganisationAccount()).organisation.id, member.id, member.email, open); return member.id; }, "no_membership"],
      ["the society's own account", async () => fixture.user.id, "no_membership"]
    ];
    for (const [name, viewer, reason] of viewers) {
      const access = await getEventForViewer(fixture.event.id, await viewer());
      expect(access, name).toMatchObject({ kind: "gated", gate: { reason, society: { name: fixture.organisation.name, slug: fixture.organisation.slug } } });
      expect(JSON.stringify(access), name).not.toContain(fixture.sentinel);
      expect(Object.keys((access as { gate: object }).gate).sort(), name).toEqual(["reason", "society", "startsAt", "timeZone"]);
    }

    const member = await createMember();
    await createMembershipGrant(orgId, member.id, member.email, open);
    expect(await getEventForViewer(fixture.event.id, member.id)).toMatchObject({
      kind: "open", event: { title: `${fixture.sentinel}-title`, location: `${fixture.sentinel}-place`, membersOnly: true, ticketTypes: [{ name: `${fixture.sentinel}-ticket` }] }
    });

    // Drafts and wrong ids are still not found, for members too.
    const draft = await createEvent({ organisationId: orgId, visibility: "members_only" });
    expect(await getEventForViewer(draft.id, member.id)).toBeNull();
    expect(await getEventForViewer("missing-event-id", member.id)).toBeNull();
  });

  test("listings and the public API leave it out; checkout refuses anyone it is closed to, under the buyer lock", async () => {
    const fixture = await membersOnlyEvent();
    const ids = (await getPublishedEvents({ limit: 100 })).events.map((event) => event.id);
    expect(ids).not.toContain(fixture.event.id);
    expect(JSON.stringify(await publicOrganisation(fixture.organisation.slug))).not.toContain(fixture.sentinel);
    expect((await publicEventRoute(new Request("http://localhost"), { params: Promise.resolve({ eventId: fixture.event.id }) })).status).toBe(404);

    const buy = (buyer: { userId: string } | { guest: { grantId: string; guestIdentityId: string } }) =>
      createEventCheckout({ ...buyer, eventId: fixture.event.id, ticketTypeId: fixture.ticketType.id, quantity: 1, expectedUnitPrice: 1500, idempotencyKey: unique("members-only-key") });
    const joiner = await createMember();
    await joinOrganisation(joiner.id, fixture.organisation.id);
    await expect(buy({ userId: joiner.id })).rejects.toMatchObject({ kind: "event_not_found", details: [] });
    await expect(buy({ guest: await verifiedGuest() })).rejects.toMatchObject({ kind: "event_not_found" });

    const member = await createMember();
    const grant = await createMembershipGrant(fixture.organisation.id, member.id, member.email, open);
    await buy({ userId: member.id });
    expect(await prisma.order.count({ where: { userId: member.id, eventId: fixture.event.id } })).toBe(1);

    // Revoked: the next checkout is refused like a missing event.
    await prisma.membershipGrant.update({ where: { id: grant.id }, data: { revokedAt: new Date(), revocationReason: "Synthetic test revocation" } });
    await expect(buy({ userId: member.id })).rejects.toMatchObject({ kind: "event_not_found" });
  });

  test("publishing needs a published plan still to end that unlocks members-only events", async () => {
    const account = await createOrganisationAccount({ stripeReady: true });
    const orgId = account.organisation.id;
    const draft = await createEvent({ organisationId: orgId, visibility: "members_only" });
    const plan = (entitlements: Array<"member_prices" | "members_only_events">, endsAt = new Date(Date.now() + 100 * day)) =>
      prisma.membershipProduct.create({ data: { organisationId: orgId, name: unique("Plan"), priceAmount: 0, startsAt: new Date(Date.now() - day), endsAt, entitlements, status: "published", publishedAt: new Date() } });

    await plan(["member_prices"]);
    await plan(["members_only_events"], new Date(Date.now() - 1000));
    await prisma.membershipProduct.create({ data: { organisationId: orgId, name: unique("Draft plan"), priceAmount: 0, startsAt: new Date(), endsAt: new Date(Date.now() + day), entitlements: ["members_only_events"] } });
    expect((await getDashboardEvent(orgId, draft.id)).blockers).toContainEqual(expect.objectContaining({ code: "members_only_unavailable", field: "visibility" }));
    await expect(setOrganisationEventPublication(orgId, draft.id, { targetStatus: "published", version: draft.version })).rejects.toBeInstanceOf(EventLifecycleValidationError);

    await plan(["members_only_events"]);
    expect((await getDashboardEvent(orgId, draft.id)).blockers).toEqual([]);
    expect(await setOrganisationEventPublication(orgId, draft.id, { targetStatus: "published", version: draft.version })).toMatchObject({ status: "published", visibility: "members_only" });
  });

  test("its image goes only to members it is open to, and never through the public path", async () => {
    const fixture = await membersOnlyEvent();
    const objects = new Map<string, Buffer>();
    const storage: AssetStorage = {
      put: async (key, bytes) => { objects.set(key, bytes); }, get: async (key) => objects.get(key) ?? null,
      head: async (key) => objects.has(key), delete: async (key) => { objects.delete(key); }, list: async () => ({ objects: [] })
    };
    const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toBuffer();
    const asset = await uploadAsset(fixture.user, fixture.organisation.id, "event", { bytes: png, type: "image/png" }, storage);
    await prisma.event.update({ where: { id: fixture.event.id }, data: { heroAssetId: asset.id } });

    const outsider = await createMember();
    await joinOrganisation(outsider.id, fixture.organisation.id);
    const member = await createMember();
    await createMembershipGrant(fixture.organisation.id, member.id, member.email, open);
    expect(await publicAsset(asset.id)).toBeNull();
    expect(await memberEventAsset(asset.id, outsider.id, storage)).toBeNull();
    expect((await memberEventAsset(asset.id, member.id, storage))?.bytes.length).toBeGreaterThan(0);
  });
});
