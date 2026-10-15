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
export async function publicOrganisation(slug: string) {
  return prisma.organisation.findUnique({
    where: { slug },
    select: {
      ...publicProfileSelect,
      events: {
        where: { status: "published", visibility: "public", startTime: { gte: new Date() } },
        take: 50,
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
        select: { id: true, title: true, startTime: true, location: true },
      },
    },
  });
}
