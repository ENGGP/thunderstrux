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
export async function publicOrganisation(slug: string) {
  const upcoming = { status: "published" as const, visibility: "public" as const, cancelledAt: null, endTime: { gt: new Date() } };
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
}
