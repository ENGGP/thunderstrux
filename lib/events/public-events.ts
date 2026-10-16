import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { eventReadiness, salesOpen, type TicketTypeUnavailableReason } from "@/lib/events/event-readiness";
import type { ExploreRange } from "@/lib/events/explore-filters";
import { readEventInventory, sellableQuantity } from "@/lib/events/inventory";
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
};

export type PublicEventsPage = {
  events: PublicEventListItem[];
  pageInfo: PageInfo;
};

export type PublicEventTicketType = {
  id: string;
  name: string;
  price: number;
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
  organisation: {
    name: string;
    slug: string;
    timeZone: string;
    // Public profile text, shown at checkout; empty when the society has not set it.
    supportEmail: string;
    refundPolicy: string;
  };
  ticketTypes: PublicEventTicketType[];
  status?: "draft" | "published";
  salesOpen?: boolean;
  salesCloseAt?: Date;
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
    // publicly; ended events drop out of every list (PUB-001).
    where: {
      status: "published",
      visibility: "public",
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

  return {
    events: page.items,
    pageInfo: page.pageInfo
  };
}

// The societies the Explore filter offers: those with a listed event still to come.
export function getExploreSocieties(now = new Date()) {
  return prisma.organisation.findMany({
    where: { events: { some: { status: "published", visibility: "public", endTime: { gt: now } } } },
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
  status: true,
  visibility: true,
  saleState: true,
  salesCloseAt: true,
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
    select: { id: true, name: true, price: true, quantity: true },
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
    status: event.status,
    salesOpen: salesOpen(event, now),
    salesCloseAt: event.salesCloseAt,
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

// Public and link-only events are readable; drafts and members-only events
// read as missing.
export function getPublishedEventDetail(eventId: string) {
  return readEventDetail({ id: eventId, status: "published", visibility: { not: "members_only" } });
}

// The organiser's preview of the same page, draft or published, scoped to the
// caller's society.
export function getEventPreviewDetail(organisationId: string, eventId: string) {
  return readEventDetail({ id: eventId, organisationId });
}
