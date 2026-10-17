import { hash } from "bcryptjs";
import type {
  AccountRole,
  CompensationRefundMode,
  EventSaleState,
  EventStatus,
  EventVisibility,
  OrderStatus,
  OrganisationStaffRole,
  OrganisationStaffStatus,
  PaymentKind,
  ReservationStatus
} from "@prisma/client";
import { prisma } from "@/lib/db";

let counter = 0;

export function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}`;
}

export function futureDate(days = 7, hour = 10) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days + counter);
  date.setUTCHours(hour, 0, 0, 0);
  return date;
}

// By default every fixture user gets its own bcrypt hash of the test password,
// as before PR #93. With THUNDERSTRUX_FAST_TEST_RESET=1 (switched off by
// default) one real hash is made per run and shared, saving about 60ms a user.
let testPasswordHash: Promise<string> | null = null;
const testPassword = () =>
  process.env.THUNDERSTRUX_FAST_TEST_RESET === "1" ? (testPasswordHash ??= hash("password123", 10)) : hash("password123", 10);

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
      emailVerifiedAt: new Date(),
      accountRole,
      password: await testPassword(),
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

  await prisma.organisationStaff.create({
    data: {
      userId: user.id,
      organisationId: organisation.id,
      role: "owner",
      status: "active",
      acceptedAt: new Date()
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

export async function createOrganisationStaff({
  organisationId,
  userId,
  role = "event_manager",
  status = "active"
}: {
  organisationId: string;
  userId: string;
  role?: OrganisationStaffRole;
  status?: OrganisationStaffStatus;
}) {
  return prisma.organisationStaff.create({
    data: {
      organisationId,
      userId,
      role,
      status,
      acceptedAt: status === "active" ? new Date() : null,
      revokedAt: status === "revoked" ? new Date() : null
    }
  });
}

export async function createEvent({
  organisationId,
  title = unique("Test Event"),
  status = "draft",
  compensationRefundMode = "manual_review",
  visibility = "public",
  saleState = "open",
  salesCloseAt,
  capacity = null,
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
  compensationRefundMode?: CompensationRefundMode;
  visibility?: EventVisibility;
  saleState?: EventSaleState;
  salesCloseAt?: Date;
  capacity?: number | null;
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
      compensationRefundMode,
      visibility,
      saleState,
      salesCloseAt: salesCloseAt ?? startTime,
      capacity,
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
  failureReason,
  requiresCompensationReview,
  fulfilmentFailedAt,
  fulfilmentFailureReason,
  compensationRefundModeSnapshot = "manual_review",
  paymentKind = "stripe",
  fulfilledAt
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
  requiresCompensationReview?: boolean;
  fulfilmentFailedAt?: Date | null;
  fulfilmentFailureReason?: string | null;
  compensationRefundModeSnapshot?: CompensationRefundMode;
  paymentKind?: PaymentKind;
  fulfilledAt?: Date | null;
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
      failureReason,
      requiresCompensationReview,
      fulfilmentFailedAt,
      fulfilmentFailureReason,
      compensationRefundModeSnapshot,
      paymentKind,
      // A paid fixture stands for a fulfilled order unless the test says otherwise.
      fulfilledAt: fulfilledAt === undefined ? (status === "paid" ? paidAt ?? null : null) : fulfilledAt
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
