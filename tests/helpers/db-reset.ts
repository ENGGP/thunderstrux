import { prisma } from "@/lib/db";
import { validateIntegrationDatabaseUrl } from "../../scripts/integration-test-guards.mjs";

export function assertTestDatabaseUrl() {
  validateIntegrationDatabaseUrl(process.env.DATABASE_URL);
}

export async function resetTestDatabase() {
  assertTestDatabaseUrl();

  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "NotificationOutbox",
      "OrderLifecycleEvent",
      "AuditLog",
      "OrganisationStaffInvite",
      "OrganisationStaff",
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
