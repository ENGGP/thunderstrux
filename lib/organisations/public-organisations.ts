import { cache } from "react";
import { prisma } from "@/lib/db";

export const publicProfileSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  supportEmail: true,
  refundPolicy: true,
  pickupPolicy: true,
  timeZone: true,
  logoAssetId: true,
  coverAssetId: true,
} as const;
// A society page lists the next six upcoming events (until each ends, as on
// Explore) and counts the rest for "See all", which opens Explore filtered to
// the society (UI-019).
export const societyEventsShown = 6;
// Once per request: a society page and its metadata both read it before the page decides its 404.
export const publicOrganisation = cache(async (slug: string) => {
  // A restricted society's events leave its page (T55); the page itself stays.
  const upcoming = { status: "published" as const, visibility: "public" as const, cancelledAt: null, endTime: { gt: new Date() }, organisation: { restrictedAt: null } };
  return prisma.organisation.findUnique({
    where: { slug },
    select: {
      ...publicProfileSelect,
      events: {
        where: upcoming,
        take: societyEventsShown,
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        select: { id: true, title: true, startTime: true, location: true, heroAssetId: true },
      },
      _count: { select: { events: { where: upcoming } } },
    },
  });
});
