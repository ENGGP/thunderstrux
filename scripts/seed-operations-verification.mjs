import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const organisation = await prisma.organisation.findFirst({ orderBy: { id: "asc" } });
  const actor = await prisma.user.findFirst({ orderBy: { id: "asc" } });
  const ticketType = await prisma.ticketType.findFirst({
    include: { event: true },
    orderBy: { id: "asc" }
  });

  if (!organisation || !actor || !ticketType) {
    throw new Error("Seed data is incomplete for operations verification");
  }

  await prisma.$transaction(async (transaction) => {
    const order = await transaction.order.create({
      data: {
        organisationId: ticketType.event.organisationId,
        eventId: ticketType.eventId,
        ticketTypeId: ticketType.id,
        userId: actor.id,
        status: "pending",
        quantity: 1,
        unitPrice: ticketType.price,
        totalAmount: ticketType.price
      }
    });
    await transaction.orderLifecycleEvent.create({
      data: {
        orderId: order.id,
        sequence: 1,
        type: "order_created",
        source: "checkout",
        toOrderStatus: "pending",
        facts: { compensationReview: false }
      }
    });
    await transaction.ticketReservation.create({
      data: {
        orderId: order.id,
        organisationId: ticketType.event.organisationId,
        eventId: ticketType.eventId,
        ticketTypeId: ticketType.id,
        userId: actor.id,
        quantity: 1,
        status: "active",
        expiresAt: new Date("2099-01-01T00:00:00.000Z")
      }
    });
    await transaction.emailOutbox.create({
      data: {
        orderId: order.id,
        mode: "automatic",
        status: "pending",
        nextAttemptAt: new Date("2099-01-01T00:00:00.000Z")
      }
    });
    await transaction.auditLog.create({
      data: {
        organisationId: organisation.id,
        actorUserId: actor.id,
        action: "p217.restore_verification",
        targetType: "deployment",
        targetId: "p217-rehearsal",
        metadata: { containsSecrets: false }
      }
    });
  });
} finally {
  await prisma.$disconnect();
}
