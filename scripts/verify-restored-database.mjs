import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

try {
  const [users, organisations, staff, orders, tickets, reservations, outbox, lifecycleEvents, auditLogs, migrations] = await Promise.all([
    prisma.user.count(),
    prisma.organisation.count(),
    prisma.organisationStaff.count(),
    prisma.order.count(),
    prisma.ticket.count(),
    prisma.ticketReservation.count(),
    prisma.emailOutbox.count(),
    prisma.orderLifecycleEvent.count({
      where: { sequence: 1, type: "order_created", source: "checkout" }
    }),
    prisma.auditLog.count(),
    prisma.$queryRawUnsafe(`SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE "finished_at" IS NOT NULL`)
  ]);
  const migrationCount = Number(migrations[0]?.count ?? 0);

  if (migrationCount < 1 || users < 1 || organisations < 1 || staff < 1 || orders < 1 ||
      tickets < 1 || reservations < 1 || outbox < 1 || lifecycleEvents < 1 || auditLogs < 1) {
    throw new Error(`Restored database is missing required verification records: ${JSON.stringify({
      migrationCount, users, organisations, staff, orders, tickets, reservations, outbox, lifecycleEvents, auditLogs
    })}`);
  }

  console.log(JSON.stringify({
    status: "verified",
    users,
    organisations,
    staff,
    orders,
    tickets,
    reservations,
    outbox,
    lifecycleEvents,
    auditLogs,
    migrations: migrationCount
  }));
} finally {
  await prisma.$disconnect();
}
