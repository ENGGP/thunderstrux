import { describe, expect, test } from "vitest";
import sharp from "sharp";
import { POST as createEventRoute } from "@/app/api/events/route";
import { DELETE as deleteEventRoute, PATCH as updateEventRoute } from "@/app/api/events/[eventId]/route";
import { PATCH as publishEventRoute } from "@/app/api/events/[eventId]/publish/route";
import { prisma } from "@/lib/db";
import { assetPublicReferenced } from "@/lib/assets/references";
import { deleteAsset, uploadAsset } from "@/lib/assets/service";
import type { AssetStorage } from "@/lib/assets/storage";
import { getOrganisationEventForEditing } from "@/lib/events/event-lifecycle";
import { getPublishedEventDetail } from "@/lib/events/public-events";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import { createOrganisationAccount, futureDate } from "@/tests/helpers/test-data";

const objects = new Map<string, Buffer>();
const storage: AssetStorage = {
  put: async (key, bytes) => { objects.set(key, bytes); },
  get: async (key) => objects.get(key) ?? null,
  head: async (key) => objects.has(key),
  delete: async (key) => { objects.delete(key); },
  list: async () => ({ objects: [] })
};

async function image(owner: Awaited<ReturnType<typeof createOrganisationAccount>>, kind: "event" | "logo" = "event") {
  const bytes = await sharp({ create: { width: 16, height: 9, channels: 3, background: "blue" } }).png().toBuffer();
  return uploadAsset(owner.user, owner.organisation.id, kind, { bytes, type: "image/png" }, storage);
}

function eventBody(organisationId: string, extra: Record<string, unknown> = {}) {
  const startTime = futureDate(10, 18);
  return {
    organisationId,
    title: "Hero night",
    description: "With a picture",
    location: "Hall",
    startTime: startTime.toISOString(),
    endTime: new Date(startTime.getTime() + 3600000).toISOString(),
    ticketTypes: [{ name: "General", price: 1500, quantity: 20 }],
    ...extra
  };
}

const unreferencedAt = async (id: string) => (await prisma.asset.findUniqueOrThrow({ where: { id } })).unreferencedAt;
const publiclyServed = (id: string) => prisma.$transaction((tx) => assetPublicReferenced(tx, id));

describe("event hero images", () => {
  test("only a ready event image of the same society can be attached", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    const other = await createOrganisationAccount();
    const foreign = await image(other);
    const logo = await image(owner, "logo");
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });

    for (const heroAssetId of [foreign.id, logo.id, "missing"]) {
      const response = await createEventRoute(jsonRequest("http://localhost/api/events", eventBody(owner.organisation.id, { heroAssetId })));
      expect(response.status).toBe(400);
      expect(await parseJsonResponse(response)).toMatchObject({ error: { details: [{ path: ["heroAssetId"] }] } });
    }
    expect(await prisma.event.count({ where: { organisationId: owner.organisation.id } })).toBe(0);
  });

  // UI-018: what the image shows, read out as the event page hero's alt text.
  test("an image description is saved with its image, kept when left out, cleared with the image, and read by the event page", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    const picture = await image(owner);
    const create = (extra: Record<string, unknown>) => createEventRoute(jsonRequest("http://localhost/api/events", eventBody(owner.organisation.id, extra)));
    const saved = async (id: string) => (await prisma.event.findUniqueOrThrow({ where: { id }, select: { heroAlt: true } })).heroAlt;

    // Without an image there's nothing to describe; over 250 characters is refused.
    const bare = await create({ heroAlt: "Nothing to describe" });
    expect(await saved((await parseJsonResponse(bare)).event.id)).toBeNull();
    expect((await create({ heroAssetId: picture.id, heroAlt: "x".repeat(251) })).status).toBe(400);

    const created = await create({ heroAssetId: picture.id, heroAlt: "  Quiz teams at long tables under bunting  " });
    expect(created.status).toBe(201);
    const { event } = await parseJsonResponse(created);
    expect(await saved(event.id)).toBe("Quiz teams at long tables under bunting");
    expect((await getOrganisationEventForEditing(owner.organisation.id, event.id)).heroAlt).toBe("Quiz teams at long tables under bunting");
    expect((await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}/publish`, { targetStatus: "published", version: 1 }, { method: "PATCH" }),
      routeContext({ eventId: event.id })
    )).status).toBe(200);
    expect((await getPublishedEventDetail(event.id))?.heroAlt).toBe("Quiz teams at long tables under bunting");

    const editing = await getOrganisationEventForEditing(owner.organisation.id, event.id);
    const save = (extra: Record<string, unknown>, version: number) =>
      updateEventRoute(
        jsonRequest(
          `http://localhost/api/events/${event.id}`,
          eventBody(owner.organisation.id, {
            version,
            ticketTypes: editing.ticketTypes.map((type) => ({ id: type.id, name: type.name, price: type.price, quantity: type.quantity, expectedQuantity: type.quantity })),
            ...extra
          }),
          { method: "PATCH" }
        ),
        routeContext({ eventId: event.id })
      );
    // Left out, the saved description stays; a changed one is noted in History.
    expect((await save({}, 2)).status).toBe(200);
    expect(await saved(event.id)).toBe("Quiz teams at long tables under bunting");
    expect((await save({ heroAlt: "Two quiz teams celebrating" }, 3)).status).toBe(200);
    expect(await saved(event.id)).toBe("Two quiz teams celebrating");
    const audit = await prisma.auditLog.findMany({ where: { targetId: event.id, action: "event.updated" }, orderBy: { createdAt: "asc" } });
    expect(audit.map((row) => (row.metadata as { changes: Array<{ field: string }> }).changes.some((change) => change.field === "heroAlt"))).toEqual([false, true]);
    // Blank means decoration; removing the image clears its description.
    expect((await save({ heroAlt: "  " }, 4)).status).toBe(200);
    expect(await saved(event.id)).toBeNull();
    expect((await save({ heroAlt: "Two quiz teams celebrating" }, 5)).status).toBe(200);
    expect((await save({ heroAssetId: null, heroAlt: "Two quiz teams celebrating" }, 6)).status).toBe(200);
    expect(await saved(event.id)).toBeNull();
  });

  test("references follow create, replace, remove and delete, and public delivery follows publication", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    const first = await image(owner);
    const second = await image(owner);
    expect(await unreferencedAt(first.id)).not.toBeNull();

    const created = await createEventRoute(jsonRequest("http://localhost/api/events", eventBody(owner.organisation.id, { heroAssetId: first.id })));
    expect(created.status).toBe(201);
    const { event } = await parseJsonResponse(created);
    expect(event.heroAssetId).toBe(first.id);
    expect(await unreferencedAt(first.id)).toBeNull();
    // A draft's image stays private, and a referenced image cannot be deleted.
    expect(await publiclyServed(first.id)).toBe(false);
    await expect(deleteAsset(owner.user, owner.organisation.id, first.id, storage)).rejects.toThrow("before deleting");

    const published = await publishEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}/publish`, { targetStatus: "published", version: 1 }, { method: "PATCH" }),
      routeContext({ eventId: event.id })
    );
    expect(published.status).toBe(200);
    expect(await publiclyServed(first.id)).toBe(true);

    const editing = await getOrganisationEventForEditing(owner.organisation.id, event.id);
    const save = (heroAssetId: string | null, version: number) =>
      updateEventRoute(
        jsonRequest(
          `http://localhost/api/events/${event.id}`,
          eventBody(owner.organisation.id, {
            heroAssetId,
            version,
            ticketTypes: editing.ticketTypes.map((type) => ({ id: type.id, name: type.name, price: type.price, quantity: type.quantity, expectedQuantity: type.quantity }))
          }),
          { method: "PATCH" }
        ),
        routeContext({ eventId: event.id })
      );

    expect((await save(second.id, 2)).status).toBe(200);
    expect(await unreferencedAt(first.id)).not.toBeNull();
    expect(await unreferencedAt(second.id)).toBeNull();
    expect(await publiclyServed(first.id)).toBe(false);

    expect((await save(null, 3)).status).toBe(200);
    expect(await unreferencedAt(second.id)).not.toBeNull();

    expect((await save(second.id, 4)).status).toBe(200);
    await prisma.event.update({ where: { id: event.id }, data: { status: "draft" } });
    const deleted = await deleteEventRoute(
      jsonRequest(`http://localhost/api/events/${event.id}`, undefined, { method: "DELETE" }),
      routeContext({ eventId: event.id })
    );
    expect(deleted.status).toBe(200);
    expect(await unreferencedAt(second.id)).not.toBeNull();
  });
});
