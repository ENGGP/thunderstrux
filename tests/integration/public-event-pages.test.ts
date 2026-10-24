import { describe, expect, test, vi } from "vitest";
import PublicEventPage, { generateMetadata as eventMetadata } from "@/app/(public)/events/[eventId]/page";
import { generateMetadata as societyMetadata } from "@/app/(public)/societies/[orgSlug]/page";
import { prisma } from "@/lib/db";
import { getEventPreviewDetail, getPublishedEventDetail } from "@/lib/events/public-events";
import { setMockSession } from "@/tests/helpers/auth";
import { renderPage } from "@/tests/helpers/render";
import { createEvent, createMember, createOrder, createOrganisationAccount, createReservation } from "@/tests/helpers/test-data";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() })
}));

describe("public event pages", () => {
  test("public and link-only events and society pages are titled by name; members-only and missing pages are not", async () => {
    const owner = await createOrganisationAccount();
    const open = await createEvent({ organisationId: owner.organisation.id, status: "published" });
    const linkOnly = await createEvent({ organisationId: owner.organisation.id, status: "published", visibility: "unlisted" });
    const membersOnly = await createEvent({ organisationId: owner.organisation.id, status: "published", visibility: "members_only" });
    const title = async (eventId: string) => (await eventMetadata({ params: Promise.resolve({ eventId }) })).title;

    expect(await title(open.id)).toBe(open.title);
    expect(await title(linkOnly.id)).toBe(linkOnly.title);
    expect(await title(membersOnly.id)).not.toBe(membersOnly.title);
    expect(await title("missing")).toBeUndefined();
    expect((await societyMetadata({ params: Promise.resolve({ orgSlug: owner.organisation.slug }) })).title).toBe(owner.organisation.name);
  });

  test("the proxy no longer guards event pages, and the dashboard stays protected", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher).not.toContain("/events/:path*");
    expect(config.matcher).toContain("/dashboard/:path*");
  });

  test("availability is honest about holds, capacity, payments and the sales window, and hides Stripe fields", async () => {
    const owner = await createOrganisationAccount({ stripeReady: false });
    const event = await createEvent({
      organisationId: owner.organisation.id,
      status: "published",
      capacity: 5,
      ticketTypes: [{ name: "Free entry", price: 0, quantity: 20 }, { name: "Supporter", price: 2000, quantity: 10 }]
    });
    const [freeType] = event.ticketTypes;
    const member = await createMember();
    const order = await createOrder({ organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: freeType.id, userId: member.id, quantity: 2 });
    await createReservation({
      orderId: order.id, organisationId: owner.organisation.id, eventId: event.id, ticketTypeId: freeType.id, userId: member.id,
      quantity: 2, expiresAt: new Date(Date.now() + 30 * 60000)
    });

    const detail = await getPublishedEventDetail(event.id);
    // Capacity 5 minus 2 held leaves 3 for every type; paid needs payments the society lacks.
    expect(detail?.ticketTypes).toEqual([
      expect.objectContaining({ name: "Free entry", availableQuantity: 3, unavailable: null }),
      expect.objectContaining({ name: "Supporter", availableQuantity: 3, unavailable: "payments_unavailable" })
    ]);
    expect(detail?.salesOpen).toBe(true);
    expect(JSON.stringify(detail)).not.toContain("stripe");

    await prisma.event.update({ where: { id: event.id }, data: { saleState: "closed" } });
    expect((await getPublishedEventDetail(event.id))?.salesOpen).toBe(false);
  });

  test("drafts and members-only events stay concealed; the preview reads a draft only for its own society", async () => {
    const owner = await createOrganisationAccount();
    const other = await createOrganisationAccount();
    const draft = await createEvent({ organisationId: owner.organisation.id });
    const membersOnly = await createEvent({ organisationId: owner.organisation.id, status: "published", visibility: "members_only" });

    expect(await getPublishedEventDetail(draft.id)).toBeNull();
    expect(await getPublishedEventDetail(membersOnly.id)).toBeNull();
    expect(await getEventPreviewDetail(owner.organisation.id, draft.id)).toMatchObject({ id: draft.id, status: "draft" });
    expect(await getEventPreviewDetail(other.organisation.id, draft.id)).toBeNull();
  });

  test("anonymous visitors are asked to sign in, and society accounts are told they can't buy", async () => {
    const owner = await createOrganisationAccount({ stripeReady: true });
    const event = await createEvent({ organisationId: owner.organisation.id, status: "published", title: "Open Night" });

    const anonymous = await renderPage(await PublicEventPage({ params: Promise.resolve({ eventId: event.id }) }));
    expect(anonymous).toContain("Open Night");
    expect(anonymous).toContain("Continue as guest");
    expect(anonymous).toContain("Sign in to buy");

    setMockSession({ userId: owner.user.id, email: owner.user.email, accountRole: "organisation" });
    const society = await renderPage(await PublicEventPage({ params: Promise.resolve({ eventId: event.id }) }));
    expect(society).toMatch(/Society accounts can('|&#x27;)t buy tickets/);
  });
});
