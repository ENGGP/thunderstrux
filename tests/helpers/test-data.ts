import { hash } from "bcryptjs";
import type { AccountRole, EventStatus, OrderStatus, ReservationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

let counter = 0;

export function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function futureDate(days = 7, hour = 10) {
  const date = new Date("2026-06-01T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() + days + counter);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

export async function createUser({
  email = `${unique("user")}@example.com`,
  accountRole = "member"
}: {
  email?: string;
  accountRole?: AccountRole;
} = {}) {
  return prisma.user.create({
    data: {
      email,
      accountRole,
      password: await hash("password123", 10),
      firstName: accountRole === "member" ? "Test" : null,
      lastName: accountRole === "member" ? "Member" : null,
      onboardingCompletedAt: accountRole === "member" ? new Date() : null
    }
  });
}

export async function createOrganisationAccount({
  email = `${unique("org")}@example.com`,
  name = unique("Test Organisation"),
  slug = unique("test-org"),
  stripeReady = false
}: {
  email?: string;
  name?: string;
  slug?: string;
  stripeReady?: boolean;
} = {}) {
  const user = await createUser({ email, accountRole: "organisation" });
  const organisation = await prisma.organisation.create({
    data: {
      name,
      slug,
      accountUserId: user.id,
      stripeAccountId: stripeReady ? `acct_${unique("test")}` : null,
      stripeAccountStatus: stripeReady ? "READY" : "NOT_CONNECTED",
      stripeChargesEnabled: stripeReady,
      stripePayoutsEnabled: stripeReady,
      stripeDetailsSubmitted: stripeReady
    }
  });

  await prisma.organisationMember.create({
    data: {
      userId: user.id,
      organisationId: organisation.id,
      role: "org_owner"
    }
  });

  return { user, organisation };
}

export async function createMember({
  email = `${unique("member")}@example.com`
}: { email?: string } = {}) {
  return createUser({ email, accountRole: "member" });
}

export async function joinOrganisation(userId: string, organisationId: string) {
  return prisma.organisationMember.create({
    data: {
      userId,
      organisationId,
      role: "member"
    }
  });
}

export async function createEvent({
  organisationId,
  title = unique("Test Event"),
  status = "draft",
  ticketTypes = [
    {
      name: "General",
      price: 1200,
      quantity: 10
    }
  ]
}: {
  organisationId: string;
  title?: string;
  status?: EventStatus;
  ticketTypes?: Array<{ name: string; price: number; quantity: number }>;
}) {
  const startTime = futureDate(14, 9);
  const endTime = new Date(startTime.getTime() + 2 * 60 * 60 * 1000);

  return prisma.event.create({
    data: {
      organisationId,
      title,
      description: `${title} description`,
      location: "Integration Room",
      startTime,
      endTime,
      status,
      ticketTypes: {
        create: ticketTypes
      }
    },
    include: {
      ticketTypes: {
        orderBy: { createdAt: "asc" }
      }
    }
  });
}

export async function createOrder({
  organisationId,
  eventId,
  ticketTypeId,
  userId,
  status = "pending",
  quantity = 1,
  unitPrice = 1200,
  stripeSessionId = unique("cs_test"),
  createdAt,
  paidAt,
  failedAt,
  failureReason
}: {
  organisationId: string;
  eventId: string;
  ticketTypeId: string;
  userId?: string | null;
  status?: OrderStatus;
  quantity?: number;
  unitPrice?: number;
  stripeSessionId?: string | null;
  createdAt?: Date;
  paidAt?: Date | null;
  failedAt?: Date | null;
  failureReason?: string | null;
}) {
  return prisma.order.create({
    data: {
      organisationId,
      eventId,
      ticketTypeId,
      userId: userId ?? null,
      status,
      quantity,
      unitPrice,
      totalAmount: unitPrice * quantity,
      stripeSessionId,
      createdAt,
      paidAt,
      failedAt,
      failureReason
    }
  });
}

export async function createReservation({
  orderId,
  organisationId,
  eventId,
  ticketTypeId,
  userId,
  quantity = 1,
  status = "active",
  expiresAt,
  confirmedAt,
  releasedAt,
  releaseReason
}: {
  orderId: string;
  organisationId: string;
  eventId: string;
  ticketTypeId: string;
  userId?: string | null;
  quantity?: number;
  status?: ReservationStatus;
  expiresAt: Date;
  confirmedAt?: Date | null;
  releasedAt?: Date | null;
  releaseReason?: string | null;
}) {
  return prisma.ticketReservation.create({
    data: {
      orderId,
      organisationId,
      eventId,
      ticketTypeId,
      userId: userId ?? null,
      quantity,
      status,
      expiresAt,
      confirmedAt,
      releasedAt,
      releaseReason
    }
  });
}
