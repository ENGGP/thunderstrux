import { prisma } from "@/lib/db";

export type PublicEventListItem = {
  id: string;
  title: string;
  startTime: Date;
  location: string;
  organisation: {
    name: string;
  };
};

export async function getPublishedEvents(): Promise<PublicEventListItem[]> {
  return prisma.event.findMany({
    where: { status: "published" },
    orderBy: { startTime: "asc" },
    select: {
      id: true,
      title: true,
      startTime: true,
      location: true,
      organisation: {
        select: {
          name: true
        }
      }
    }
  });
}
