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

async function ensureDemoEvent({
  organisationSlug,
  organisationName,
  title,
  description,
  startTime,
  endTime,
  location,
  ticketName,
  ticketPrice,
  ticketQuantity
}: {
  organisationSlug: string;
  organisationName: string;
  title: string;
  description: string;
  startTime: Date;
  endTime: Date;
  location: string;
  ticketName: string;
  ticketPrice: number;
  ticketQuantity: number;
}) {
  const organisation = await prisma.organisation.upsert({
    where: { slug: organisationSlug },
    update: {},
    create: {
      name: organisationName,
      slug: organisationSlug
    },
    select: { id: true }
  });

  const existingEvent = await prisma.event.findFirst({
    where: {
      organisationId: organisation.id,
      title
    },
    select: {
      id: true,
      ticketTypes: {
        select: { id: true },
        take: 1
      }
    }
  });

  if (existingEvent) {
    await prisma.event.update({
      where: { id: existingEvent.id },
      data: { status: "published" }
    });

    if (existingEvent.ticketTypes.length === 0) {
      await prisma.ticketType.create({
        data: {
          eventId: existingEvent.id,
          name: ticketName,
          price: ticketPrice,
          quantity: ticketQuantity
        }
      });
    }

    return;
  }

  await prisma.event.create({
    data: {
      organisationId: organisation.id,
      title,
      description,
      startTime,
      endTime,
      location,
      status: "published",
      ticketTypes: {
        create: {
          name: ticketName,
          price: ticketPrice,
          quantity: ticketQuantity
        }
      }
    }
  });
}

export async function ensurePublishedDemoEvents() {
  const publishedEventCount = await prisma.event.count({
    where: { status: "published" }
  });

  if (publishedEventCount > 0) {
    return;
  }

  const now = new Date();
  const firstStart = new Date(now);
  firstStart.setDate(now.getDate() + 7);
  firstStart.setHours(18, 0, 0, 0);

  const firstEnd = new Date(firstStart);
  firstEnd.setHours(firstStart.getHours() + 2);

  const secondStart = new Date(now);
  secondStart.setDate(now.getDate() + 14);
  secondStart.setHours(17, 30, 0, 0);

  const secondEnd = new Date(secondStart);
  secondEnd.setHours(secondStart.getHours() + 3);

  await ensureDemoEvent({
    organisationSlug: "engineering-society",
    organisationName: "Engineering Society",
    title: "Engineering Society Launch Night",
    description: "A public demo event for validating ticket discovery and checkout.",
    startTime: firstStart,
    endTime: firstEnd,
    location: "Main Auditorium",
    ticketName: "General Admission",
    ticketPrice: 1000,
    ticketQuantity: 50
  });

  await ensureDemoEvent({
    organisationSlug: "arts-society",
    organisationName: "Arts Society",
    title: "Arts Society Showcase",
    description: "A second public demo event with available tickets.",
    startTime: secondStart,
    endTime: secondEnd,
    location: "Gallery Hall",
    ticketName: "Standard Ticket",
    ticketPrice: 1500,
    ticketQuantity: 40
  });
}

export async function getPublishedEvents(): Promise<PublicEventListItem[]> {
  await ensurePublishedDemoEvents();

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
