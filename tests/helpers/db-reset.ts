import { prisma } from "@/lib/db";

export function assertTestDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for integration tests.");
  }

  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");

  if (!databaseName.endsWith("_test")) {
    throw new Error(
      `Refusing to run integration tests against non-test database "${databaseName}".`
    );
  }
}

export async function resetTestDatabase() {
  assertTestDatabaseUrl();

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "Ticket",
      "TicketReservation",
      "Order",
      "TicketType",
      "Event",
      "OrganisationMember",
      "Organisation",
      "User"
    RESTART IDENTITY CASCADE
  `);
}
