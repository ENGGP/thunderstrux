import type { Prisma } from "@prisma/client";
import { cache } from "react";
import { prisma } from "@/lib/db";
import { eventReadiness, salesOpen, ticketTypeReason, type TicketTypeUnavailableReason } from "@/lib/events/event-readiness";
import type { ExploreRange } from "@/lib/events/explore-filters";
import { readEventInventory, readEventsInventory, sellableQuantity } from "@/lib/events/inventory";
import { activeEntitlementGrant } from "@/lib/memberships/grants";
import { isOrganisationStripeReady } from "@/lib/stripe/connect";
import {
  ascendingCursorWhere,
  decodeTimestampCursor,
  orderByForDirection,
  pageInfoForPage,
  type PageInfo,
  type PaginationDirection
} from "@/lib/pagination/cursor";

export type PublicEventListItem = {
  id: string;
  title: string;
  startTime: Date;
  location: string;
  heroAssetId: string | null;
  organisation: {
    name: string;
    slug: string;
    timeZone: string;
  };
  availability: ListingAvailability | null;
};

// What a list card says about buying (UI-007). `prices` are the standard prices
// of the types on sale now, distinct and lowest first; member prices show on the
// event page, which knows the viewer. Null when the event has no ticket types.
export type ListingAvailability =
  | { state: "on_sale"; prices: number[] }
  | { state: "sales_closed" | "sold_out" | "paid_unavailable" };

export type PublicEventsPage = {
  events: PublicEventListItem[];
  pageInfo: PageInfo;
};

export type PublicEventTicketType = {
  id: string;
  name: string;
  // The price this viewer pays (see priceForViewer).
  price: number;
  // What members pay, when the type has a member price (T24b).
  memberPrice: number | null;
  // Set when `price` is a member price: the standard price, for display.
  standardPrice?: number | null;
  quantity: number;
  // Advisory sellable stock: remaining minus live holds, within capacity.
  availableQuantity: number;
  // Why it can't be bought now, from the shared readiness rules.
  unavailable?: TicketTypeUnavailableReason | null;
};

export type PublicEventDetail = {
  id: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: string;
  heroAssetId: string | null;
  // The image's description for the hero's alt text; empty means decoration (UI-018).
  heroAlt: string | null;
  organisation: {
    name: string;
    slug: string;
    timeZone: string;
    // Public profile text, shown at checkout; empty when the society has not set it.
    supportEmail: string;
    refundPolicy: string;
  };
  ticketTypes: PublicEventTicketType[];
  // Set only on a page a member's membership opened (T24b).
  membersOnly: boolean;
  status?: "draft" | "published";
  salesOpen?: boolean;
  salesCloseAt?: Date;
  // The society cancelled it (EVT-004); the page stays for ticket holders.
  cancelled?: boolean;
};

export async function getPublishedEvents({
  limit = 25,
  cursor,
  direction = "next",
  title,
  societySlug,
  startFrom,
  startBefore,
  now = new Date()
}: {
  limit?: number;
  cursor?: string;
  direction?: PaginationDirection;
  title?: string;
  societySlug?: string;
} & ExploreRange & { now?: Date } = {}): Promise<PublicEventsPage> {
  const decodedCursor = cursor ? decodeTimestampCursor("startTime", cursor) : null;
  const cursorWhere = decodedCursor
    ? ascendingCursorWhere("startTime", decodedCursor, direction)
    : {};
  const events = await prisma.event.findMany({
    // Unlisted events open by direct link only; members-only events never appear
    // publicly; ended and cancelled events drop out of every list (PUB-001, EVT-004).
    where: {
      status: "published",
      visibility: "public",
      cancelledAt: null,
      endTime: { gt: now },
      ...(title ? { title: { contains: title, mode: "insensitive" as const } } : {}),
      ...(societySlug ? { organisation: { slug: societySlug } } : {}),
      AND: [
        cursorWhere,
        ...(startFrom ? [{ startTime: { gte: startFrom } }] : []),
        ...(startBefore ? [{ startTime: { lt: startBefore } }] : [])
      ]
    },
    orderBy: orderByForDirection("startTime", direction, "asc"),
    take: limit + 1,
    select: {
      id: true,
      title: true,
      startTime: true,
      location: true,
      heroAssetId: true,
      organisation: {
        select: {
          name: true,
          slug: true,
          timeZone: true
        }
      }
    }
  });

  const page = pageInfoForPage({
    items: events,
    limit,
    direction,
    cursor,
    timestampField: "startTime"
  });

  const availability = await listingAvailability(page.items.map((event) => event.id), now);
  return {
    events: page.items.map((event) => ({ ...event, availability: availability.get(event.id) ?? null })),
    pageInfo: page.pageInfo
  };
}

// The event page's advisory stock and per-type reasons, for a whole list at once.
export async function listingAvailability(eventIds: string[], now = new Date()): Promise<Map<string, ListingAvailability | null>> {
  if (eventIds.length === 0) return new Map();
  const [events, inventories] = await Promise.all([
    prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: {
        id: true,
        saleState: true,
        salesCloseAt: true,
        organisation: { select: { stripeAccountId: true, stripeChargesEnabled: true } },
        ticketTypes: { select: { id: true, price: true, quantity: true } }
      }
    }),
    readEventsInventory(prisma, eventIds, now)
  ]);

  return new Map(
    events.map((event): [string, ListingAvailability | null] => {
      if (event.ticketTypes.length === 0) return [event.id, null];
      if (!salesOpen(event, now)) return [event.id, { state: "sales_closed" }];
      const inventory = inventories.get(event.id);
      const chargesReady = isOrganisationStripeReady(event.organisation);
      const types = event.ticketTypes.map((ticketType) => ({
        price: ticketType.price,
        reason: ticketTypeReason({ ...ticketType, sellable: inventory ? sellableQuantity(ticketType, inventory) : 0 }, chargesReady)
      }));
      const prices = [...new Set(types.filter((type) => type.reason === null).map((type) => type.price))].sort((a, b) => a - b);
      if (prices.length) return [event.id, { state: "on_sale", prices }];
      return [event.id, { state: types.every((type) => type.reason === "sold_out") ? "sold_out" : "paid_unavailable" }];
    })
  );
}

// The societies the Explore filter offers: those with a listed event still to come.
export function getExploreSocieties(now = new Date()) {
  return prisma.organisation.findMany({
    where: { events: { some: { status: "published", visibility: "public", cancelledAt: null, endTime: { gt: now } } } },
    orderBy: { name: "asc" },
    select: { name: true, slug: true }
  });
}

const detailSelect = {
  id: true,
  title: true,
  description: true,
  startTime: true,
  endTime: true,
  location: true,
  heroAssetId: true,
  heroAlt: true,
  status: true,
  visibility: true,
  saleState: true,
  salesCloseAt: true,
  cancelledAt: true,
  organisation: {
    select: {
      name: true,
      slug: true,
      timeZone: true,
      supportEmail: true,
      refundPolicy: true,
      stripeAccountId: true,
      stripeChargesEnabled: true
    }
  },
  ticketTypes: {
    select: { id: true, name: true, price: true, memberPrice: true, quantity: true },
    orderBy: { createdAt: "asc" as const }
  }
} satisfies Prisma.EventSelect;

// One event page's data. Stock and per-type reasons are advisory (an unlocked
// read that writes nothing); checkout decides again under its locks.
async function readEventDetail(where: Prisma.EventWhereInput): Promise<PublicEventDetail | null> {
  const event = await prisma.event.findFirst({ where, select: detailSelect });
  if (!event) return null;

  const now = new Date();
  const inventory = await readEventInventory(prisma, event.id, now);
  const ticketTypes = event.ticketTypes.map((ticketType) => ({ ...ticketType, sellable: sellableQuantity(ticketType, inventory) }));
  const reasons = new Map(
    eventReadiness({ ...event, ticketTypes }, { chargesReady: isOrganisationStripeReady(event.organisation), now }).ticketTypes.map((type) => [type.id, type.reason])
  );

  return {
    id: event.id,
    title: event.title,
    description: event.description,
    startTime: event.startTime,
    endTime: event.endTime,
    location: event.location,
    heroAssetId: event.heroAssetId,
    heroAlt: event.heroAlt,
    status: event.status,
    membersOnly: event.visibility === "members_only",
    salesOpen: salesOpen(event, now),
    salesCloseAt: event.salesCloseAt,
    cancelled: event.cancelledAt !== null,
    // The society's Stripe fields decide availability but are not public.
    organisation: {
      name: event.organisation.name,
      slug: event.organisation.slug,
      timeZone: event.organisation.timeZone,
      supportEmail: event.organisation.supportEmail,
      refundPolicy: event.organisation.refundPolicy
    },
    ticketTypes: ticketTypes.map(({ sellable, ...ticketType }) => ({
      ...ticketType,
      availableQuantity: sellable,
      unavailable: reasons.get(ticketType.id) ?? null
    }))
  };
}

// What one viewer pays (T24b): a member whose running membership in the
// society carries member prices gets each member price as the price, with the
// standard price kept for display; a member price of zero needs no payments.
// Everyone else keeps the standard price. Checkout decides again under locks.
export function priceForViewer(ticketTypes: PublicEventTicketType[], member: boolean): PublicEventTicketType[] {
  return ticketTypes.map((ticketType) =>
    member && ticketType.memberPrice !== null
      ? {
          ...ticketType,
          price: ticketType.memberPrice,
          standardPrice: ticketType.price,
          unavailable: ticketType.memberPrice === 0 && ticketType.unavailable === "payments_unavailable" ? null : ticketType.unavailable
        }
      : ticketType
  );
}

// Public and link-only events are readable; drafts and members-only events
// read as missing (the public API, and the first step of getEventForViewer).
export function getPublishedEventDetail(eventId: string) {
  return readEventDetail({ id: eventId, status: "published", visibility: { not: "members_only" } });
}

// Why a published members-only event is closed to this viewer (round B1).
export type MembersOnlyGate = {
  society: { name: string; slug: string; logoAssetId: string | null };
  reason: "signed_out" | "unverified" | "no_membership" | "not_included" | "upcoming";
  // For "upcoming": the day a membership that includes members-only events starts.
  startsAt: Date | null;
  timeZone: string;
};

export type ViewerEvent = { kind: "open"; event: PublicEventDetail } | { kind: "gated"; gate: MembersOnlyGate };

// The event page and ticket checkout read an event through this; null is a 404
// (missing, draft). Safety contract (T24b): a members-only event is decided from
// its id, status, visibility and society alone, and its other fields are read
// only once the viewer's live membership of that society unlocks members-only
// events (verified member account; unrevoked; inside its dates). Free joins,
// staff, guests and other societies' members get the gate, which names only
// the society. Cached per request so page and metadata decide once.
export const getEventForViewer = cache(async (eventId: string, userId: string | null): Promise<ViewerEvent | null> => {
  const head = await prisma.event.findFirst({ where: { id: eventId, status: "published" }, select: { visibility: true, organisationId: true } });
  if (!head) return null;
  if (head.visibility !== "members_only") {
    // Re-filtered, so an event turned members-only meanwhile reads as missing.
    const event = await getPublishedEventDetail(eventId);
    return event && { kind: "open", event };
  }

  const now = new Date();
  const user = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { accountRole: true, emailVerifiedAt: true } }) : null;
  const verifiedMember = Boolean(user && user.accountRole === "member" && user.emailVerifiedAt);
  if (verifiedMember && (await activeEntitlementGrant(prisma, userId as string, head.organisationId, "members_only_events", now))) {
    const event = await readEventDetail({ id: eventId, status: "published", visibility: "members_only", organisationId: head.organisationId });
    return event && { kind: "open", event };
  }

  const [society, grants] = await Promise.all([
    prisma.organisation.findUniqueOrThrow({ where: { id: head.organisationId }, select: { name: true, slug: true, logoAssetId: true, timeZone: true } }),
    verifiedMember
      ? prisma.membershipGrant.findMany({
          where: { userId: userId as string, organisationId: head.organisationId, revokedAt: null, endsAt: { gt: now } },
          orderBy: { startsAt: "asc" },
          select: { startsAt: true, entitlements: true }
        })
      : []
  ]);
  const upcoming = grants.find((grant) => grant.startsAt > now && grant.entitlements.includes("members_only_events"));
  const reason: MembersOnlyGate["reason"] = !user
    ? "signed_out"
    : user.accountRole === "member" && !user.emailVerifiedAt
      ? "unverified"
      : upcoming
        ? "upcoming"
        : grants.some((grant) => grant.startsAt <= now)
          ? "not_included"
          : "no_membership";
  const { timeZone, ...publicSociety } = society;
  return { kind: "gated", gate: { society: publicSociety, reason, startsAt: upcoming?.startsAt ?? null, timeZone } };
});

// The buyer's own confirmation page: callers must already hold the buyer's
// order for this event, so a members-only event shows to its ticket holder.
export function getBookedEventDetail(eventId: string) {
  return readEventDetail({ id: eventId, status: "published" });
}

// The organiser's preview of the same page, draft or published, scoped to the
// caller's society.
export function getEventPreviewDetail(organisationId: string, eventId: string) {
  return readEventDetail({ id: eventId, organisationId });
}
