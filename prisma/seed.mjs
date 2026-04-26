import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();
const defaultPassword = "password123";

async function upsertUser(email, password = defaultPassword) {
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

async function upsertOrganisation(name, slug, stripeData = {}) {
  return prisma.organisation.upsert({
    where: { slug },
    update: {
      name,
      ...stripeData
    },
    create: {
      name,
      slug,
      ...stripeData
    },
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

async function ensureTicketType({ eventId, name, price, quantity }) {
  const existingTicketType = await prisma.ticketType.findFirst({
    where: {
      eventId,
      name
    },
    select: { id: true }
  });

  if (existingTicketType) {
    const ticketType = await prisma.ticketType.update({
      where: { id: existingTicketType.id },
      data: {
        price,
        quantity
      },
      select: { id: true }
    });

    return ticketType;
  }

  return prisma.ticketType.create({
    data: {
      eventId,
      name,
      price,
      quantity
    },
    select: { id: true }
  });
}

async function ensureEvent({
  organisationId,
  title,
  description,
  startTime,
  endTime,
  location,
  status = "draft",
  ticketTypes = []
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
        status
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
        status
      },
      select: { id: true }
    });

    eventId = event.id;
  }

  const ensuredTicketTypes = [];

  for (const ticketType of ticketTypes) {
    const ensuredTicketType = await ensureTicketType({
      eventId,
      ...ticketType
    });

    ensuredTicketTypes.push({
      ...ticketType,
      id: ensuredTicketType.id
    });
  }

  return {
    id: eventId,
    organisationId,
    ticketTypes: ensuredTicketTypes
  };
}

async function ensureOrder({
  organisationId,
  eventId,
  ticketTypeId,
  userId,
  status,
  quantity,
  unitPrice,
  stripeSessionId,
  failureReason = null,
  issueTickets = false,
  createdAt = new Date()
}) {
  const totalAmount = quantity * unitPrice;
  const paidAt = status === "paid" ? createdAt : null;
  const failedAt = status === "failed" ? createdAt : null;

  const order = await prisma.order.upsert({
    where: { stripeSessionId },
    update: {
      organisationId,
      eventId,
      ticketTypeId,
      userId,
      status,
      quantity,
      unitPrice,
      totalAmount,
      paidAt,
      failedAt,
      failureReason
    },
    create: {
      organisationId,
      eventId,
      ticketTypeId,
      userId,
      status,
      quantity,
      unitPrice,
      totalAmount,
      stripeSessionId,
      createdAt,
      paidAt,
      failedAt,
      failureReason
    },
    select: { id: true }
  });

  if (!issueTickets) {
    await prisma.ticket.deleteMany({
      where: { orderId: order.id }
    });
    return order;
  }

  const existingTickets = await prisma.ticket.findMany({
    where: { orderId: order.id },
    select: { id: true },
    orderBy: { createdAt: "asc" }
  });

  if (existingTickets.length > quantity) {
    await prisma.ticket.deleteMany({
      where: {
        id: {
          in: existingTickets.slice(quantity).map((ticket) => ticket.id)
        }
      }
    });
  }

  for (let index = existingTickets.length; index < quantity; index += 1) {
    await prisma.ticket.create({
      data: {
        orderId: order.id,
        eventId,
        ticketTypeId,
        organisationId
      }
    });
  }

  return order;
}

function futureDate(daysFromNow, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function pastDate(daysAgo, hour, minute = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function main() {
  const [
    user1,
    user2,
    adminUser,
    eventManagerUser,
    financeUser,
    contentUser,
    memberUser,
    emptyUser,
    outsiderUser
  ] = await Promise.all([
    upsertUser("user1@example.com"),
    upsertUser("user2@example.com"),
    upsertUser("admin@example.com"),
    upsertUser("event.manager@example.com"),
    upsertUser("finance@example.com"),
    upsertUser("content@example.com"),
    upsertUser("member@example.com"),
    upsertUser("empty@example.com"),
    upsertUser("outsider@example.com")
  ]);

  const engineeringSociety = await upsertOrganisation(
    "Engineering Society",
    "engineering-society"
  );
  const artsSociety = await upsertOrganisation("Arts Society", "arts-society");
  const roboticsClub = await upsertOrganisation("Robotics Club", "robotics-club");
  const paymentsLab = await upsertOrganisation(
    "Payments Lab",
    "payments-lab",
    {
      stripeAccountId: null,
      stripeAccountStatus: "PLATFORM_NOT_READY",
      stripeChargesEnabled: false,
      stripePayoutsEnabled: false,
      stripeDetailsSubmitted: false
    }
  );
  const emptySociety = await upsertOrganisation("Empty Society", "empty-society");

  await Promise.all([
    ensureMembership(user1.id, engineeringSociety.id, "org_owner"),
    ensureMembership(adminUser.id, engineeringSociety.id, "org_admin"),
    ensureMembership(eventManagerUser.id, engineeringSociety.id, "event_manager"),
    ensureMembership(financeUser.id, engineeringSociety.id, "finance_manager"),
    ensureMembership(contentUser.id, engineeringSociety.id, "content_manager"),
    ensureMembership(memberUser.id, engineeringSociety.id, "member"),
    ensureMembership(user2.id, artsSociety.id, "member"),
    ensureMembership(adminUser.id, artsSociety.id, "org_admin"),
    ensureMembership(eventManagerUser.id, roboticsClub.id, "org_owner"),
    ensureMembership(financeUser.id, paymentsLab.id, "org_owner"),
    ensureMembership(emptyUser.id, emptySociety.id, "org_owner")
  ]);

  const launchEvent = await ensureEvent({
    organisationId: engineeringSociety.id,
    title: "Engineering Society Launch Night",
    description: "A public demo event for validating ticket discovery and checkout.",
    startTime: futureDate(7, 18),
    endTime: futureDate(7, 20),
    location: "Main Auditorium",
    status: "published",
    ticketTypes: [
      {
        name: "General Admission",
        price: 1000,
        quantity: 50
      },
      {
        name: "VIP",
        price: 2500,
        quantity: 5
      }
    ]
  });

  await ensureEvent({
    organisationId: engineeringSociety.id,
    title: "Engineering Draft Workshop",
    description: "Draft event for testing dashboard-only visibility and publish flow.",
    startTime: futureDate(10, 15),
    endTime: futureDate(10, 17),
    location: "Engineering Lab 2",
    status: "draft",
    ticketTypes: [
      {
        name: "Workshop Seat",
        price: 500,
        quantity: 12
      }
    ]
  });

  await ensureEvent({
    organisationId: engineeringSociety.id,
    title: "Engineering No Ticket Draft",
    description: "Draft event without ticket types for testing publish validation.",
    startTime: futureDate(21, 11),
    endTime: futureDate(21, 12),
    location: "Seminar Room 1",
    status: "draft",
    ticketTypes: []
  });

  const soldOutEvent = await ensureEvent({
    organisationId: engineeringSociety.id,
    title: "Engineering Sold Out Mixer",
    description: "Published event with zero remaining inventory for checkout edge cases.",
    startTime: futureDate(4, 19),
    endTime: futureDate(4, 21),
    location: "Student Bar",
    status: "published",
    ticketTypes: [
      {
        name: "Sold Out Ticket",
        price: 1200,
        quantity: 0
      }
    ]
  });

  const showcaseEvent = await ensureEvent({
    organisationId: artsSociety.id,
    title: "Arts Society Showcase",
    description: "A second public demo event with available tickets.",
    startTime: futureDate(14, 17, 30),
    endTime: futureDate(14, 20, 30),
    location: "Gallery Hall",
    status: "published",
    ticketTypes: [
      {
        name: "Standard Ticket",
        price: 1500,
        quantity: 40
      },
      {
        name: "Concession",
        price: 800,
        quantity: 10
      }
    ]
  });

  await ensureEvent({
    organisationId: artsSociety.id,
    title: "Arts Members Draft Critique",
    description: "Draft event visible only to members with dashboard access.",
    startTime: futureDate(18, 16),
    endTime: futureDate(18, 18),
    location: "Studio 3",
    status: "draft",
    ticketTypes: [
      {
        name: "Member Seat",
        price: 0,
        quantity: 8
      }
    ]
  });

  await ensureEvent({
    organisationId: roboticsClub.id,
    title: "Robotics Build Night",
    description: "Published event owned by a different organisation.",
    startTime: futureDate(9, 18, 30),
    endTime: futureDate(9, 22),
    location: "Makerspace",
    status: "published",
    ticketTypes: [
      {
        name: "Builder Pass",
        price: 700,
        quantity: 20
      }
    ]
  });

  await ensureEvent({
    organisationId: paymentsLab.id,
    title: "Payments Lab Checkout Test",
    description: "Published event attached to an organisation in PLATFORM_NOT_READY state.",
    startTime: futureDate(6, 13),
    endTime: futureDate(6, 14),
    location: "Business School 101",
    status: "published",
    ticketTypes: [
      {
        name: "Test Seat",
        price: 300,
        quantity: 6
      }
    ]
  });

  const paidTicket = launchEvent.ticketTypes.find(
    (ticketType) => ticketType.name === "General Admission"
  );
  const soldOutTicket = soldOutEvent.ticketTypes[0];
  const artsTicket = showcaseEvent.ticketTypes.find(
    (ticketType) => ticketType.name === "Standard Ticket"
  );

  await ensureOrder({
    organisationId: engineeringSociety.id,
    eventId: launchEvent.id,
    ticketTypeId: paidTicket.id,
    userId: user2.id,
    status: "paid",
    quantity: 2,
    unitPrice: paidTicket.price,
    stripeSessionId: "cs_seed_engineering_paid_order",
    issueTickets: true,
    createdAt: pastDate(1, 10)
  });

  await ensureOrder({
    organisationId: engineeringSociety.id,
    eventId: soldOutEvent.id,
    ticketTypeId: soldOutTicket.id,
    userId: memberUser.id,
    status: "failed",
    quantity: 1,
    unitPrice: soldOutTicket.price,
    stripeSessionId: "cs_seed_sold_out_failed_order",
    failureReason: "Seeded failed order for organiser order review",
    createdAt: pastDate(2, 15)
  });

  await ensureOrder({
    organisationId: artsSociety.id,
    eventId: showcaseEvent.id,
    ticketTypeId: artsTicket.id,
    userId: user1.id,
    status: "pending",
    quantity: 1,
    unitPrice: artsTicket.price,
    stripeSessionId: "cs_seed_arts_pending_order",
    createdAt: pastDate(0, 9)
  });

  console.log(
    "Seeded users, organisations, memberships, events, ticket types, and order edge cases."
  );

  console.log("Test accounts all use password: password123");
  console.table([
    { email: "user1@example.com", note: "Engineering org_owner" },
    { email: "admin@example.com", note: "Engineering org_admin, Arts org_admin" },
    { email: "event.manager@example.com", note: "Engineering event_manager, Robotics owner" },
    { email: "finance@example.com", note: "Engineering finance_manager, Payments Lab owner" },
    { email: "content@example.com", note: "Engineering content_manager" },
    { email: "member@example.com", note: "Engineering member" },
    { email: "user2@example.com", note: "Arts member and seeded buyer" },
    { email: "empty@example.com", note: "Owner of Empty Society with no events" },
    { email: "outsider@example.com", note: "No organisation memberships" }
  ]);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
