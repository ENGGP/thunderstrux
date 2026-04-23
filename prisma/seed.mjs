import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function upsertUser(email, password) {
  const hashedPassword = await hash(password, 12);

  return prisma.user.upsert({
    where: { email },
    update: {
      password: hashedPassword
    },
    create: {
      email,
      password: hashedPassword
    },
    select: { id: true, email: true }
  });
}

async function upsertOrganisation(name, slug) {
  return prisma.organisation.upsert({
    where: { slug },
    update: { name },
    create: { name, slug },
    select: { id: true, name: true, slug: true }
  });
}

async function ensureMembership(userId, organisationId, role) {
  await prisma.organisationMember.upsert({
    where: {
      userId_organisationId: {
        userId,
        organisationId
      }
    },
    update: { role },
    create: {
      userId,
      organisationId,
      role
    }
  });
}

async function ensureTicketType({
  eventId,
  name,
  price,
  quantity
}) {
  const existingTicketType = await prisma.ticketType.findFirst({
    where: {
      eventId,
      name
    },
    select: { id: true }
  });

  if (existingTicketType) {
    await prisma.ticketType.update({
      where: { id: existingTicketType.id },
      data: {
        price,
        quantity
      }
    });

    return;
  }

  await prisma.ticketType.create({
    data: {
      eventId,
      name,
      price,
      quantity
    }
  });
}

async function ensurePublishedEvent({
  organisationId,
  title,
  description,
  startTime,
  endTime,
  location,
  ticketName,
  ticketPrice,
  ticketQuantity
}) {
  const existingEvent = await prisma.event.findFirst({
    where: {
      organisationId,
      title
    },
    select: {
      id: true
    }
  });

  let eventId = existingEvent?.id;

  if (existingEvent) {
    await prisma.event.update({
      where: { id: existingEvent.id },
      data: {
        description,
        startTime,
        endTime,
        location,
        status: "published"
      }
    });
  } else {
    const event = await prisma.event.create({
      data: {
        organisationId,
        title,
        description,
        startTime,
        endTime,
        location,
        status: "published"
      },
      select: { id: true }
    });

    eventId = event.id;
  }

  await ensureTicketType({
    eventId,
    name: ticketName,
    price: ticketPrice,
    quantity: ticketQuantity
  });
}

function futureDate(daysFromNow, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function main() {
  const [user1, user2] = await Promise.all([
    upsertUser("user1@example.com", "password123"),
    upsertUser("user2@example.com", "password123")
  ]);

  const engineeringSociety = await upsertOrganisation(
    "Engineering Society",
    "engineering-society"
  );
  const artsSociety = await upsertOrganisation("Arts Society", "arts-society");

  await ensureMembership(user1.id, engineeringSociety.id, "org_owner");
  await ensureMembership(user2.id, artsSociety.id, "member");

  const launchStart = futureDate(7, 18);
  const launchEnd = futureDate(7, 20);
  const showcaseStart = futureDate(14, 17, 30);
  const showcaseEnd = futureDate(14, 20, 30);

  await ensurePublishedEvent({
    organisationId: engineeringSociety.id,
    title: "Engineering Society Launch Night",
    description: "A public demo event for validating ticket discovery and checkout.",
    startTime: launchStart,
    endTime: launchEnd,
    location: "Main Auditorium",
    ticketName: "General Admission",
    ticketPrice: 1000,
    ticketQuantity: 50
  });

  await ensurePublishedEvent({
    organisationId: artsSociety.id,
    title: "Arts Society Showcase",
    description: "A second public demo event with available tickets.",
    startTime: showcaseStart,
    endTime: showcaseEnd,
    location: "Gallery Hall",
    ticketName: "Standard Ticket",
    ticketPrice: 1500,
    ticketQuantity: 40
  });

  console.log("Seeded MVP users, organisations, memberships, and demo events.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
