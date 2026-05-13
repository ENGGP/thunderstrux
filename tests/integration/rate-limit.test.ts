import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount,
  createUser,
  joinOrganisation,
  unique
} from "@/tests/helpers/test-data";
import {
  createTestRateLimitBackend,
  enforceRateLimit,
  setRateLimitTestBackend,
  setRateLimitTestBackendFailure,
  setRateLimitTestEnabled
} from "@/lib/security/rate-limit";
import { POST as checkout } from "@/app/api/payments/checkout/event/route";
import { POST as resendTickets } from "@/app/api/orders/[orderId]/resend/route";
import { POST as createOrganisation } from "@/app/api/orgs/route";
import { POST as joinOrg } from "@/app/api/orgs/[orgSlug]/join/route";
import { POST as leaveOrg } from "@/app/api/orgs/[orgSlug]/leave/route";
import { POST as checkInTicket } from "@/app/api/tickets/[ticketId]/check-in/route";
import { POST as checkOutTicket } from "@/app/api/tickets/[ticketId]/check-out/route";
import { POST as connectOnboard } from "@/app/api/stripe/connect/onboard/route";
import { POST as connectContinue } from "@/app/api/stripe/connect/continue/route";
import { POST as connectDisconnect } from "@/app/api/stripe/connect/disconnect/route";

const stripeMocks = vi.hoisted(() => ({
  createSession: vi.fn()
}));

const stripeConnectMocks = vi.hoisted(() => ({
  createExpressAccount: vi.fn(),
  createOnboardingLink: vi.fn(),
  disconnectAccount: vi.fn()
}));

vi.mock("@/lib/stripe", () => {
  class StripeConfigurationError extends Error {}

  return {
    StripeConfigurationError,
    getAppUrl: () => "http://localhost:3000",
    getStripe: () => ({
      checkout: {
        sessions: {
          create: stripeMocks.createSession
        }
      }
    })
  };
});

vi.mock("@/lib/stripe/connect", () => {
  class StripeConnectPlatformNotReadyError extends Error {
    state = "PLATFORM_NOT_READY" as const;
    actionRequired = "Complete Stripe Connect platform profile";
    actionUrl = "https://dashboard.stripe.com/settings/connect/platform-profile";
  }

  return {
    StripeConnectPlatformNotReadyError,
    createExpressAccount: stripeConnectMocks.createExpressAccount,
    createOnboardingLink: stripeConnectMocks.createOnboardingLink,
    disconnectAccount: stripeConnectMocks.disconnectAccount,
    isOrganisationStripeReady: (organisation: {
      stripeAccountId: string | null;
      stripeChargesEnabled: boolean;
    }) => Boolean(organisation.stripeAccountId && organisation.stripeChargesEnabled),
    notConnectedStatus: () => ({
      accountId: null,
      connected: false,
      state: "NOT_CONNECTED",
      ready: false,
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      currently_due: [],
      eventually_due: [],
      disabled_reason: null,
      dashboard_url: null
    })
  };
});

async function exhaustRateLimit(
  policy: Parameters<typeof enforceRateLimit>[0]["policy"],
  keyParts: Parameters<typeof enforceRateLimit>[0]["keyParts"],
  attempts: number
) {
  const request = new Request("http://localhost/api/test", { method: "POST" });

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await expect(enforceRateLimit({ policy, request, keyParts })).resolves.toBeNull();
  }
}

describe("rate limit helper", () => {
  beforeEach(() => {
    const backend = createTestRateLimitBackend();
    setRateLimitTestBackend(backend);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(true);
  });

  afterEach(() => {
    setRateLimitTestBackend(null);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(null);
  });

  test("allows requests below limit, throttles above limit, and isolates buckets", async () => {
    const request = new Request("http://localhost/api/auth/callback/credentials", {
      method: "POST"
    });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await expect(
        enforceRateLimit({
          policy: "login_ip_email",
          request,
          keyParts: ["127.0.0.1", "a@example.com"]
        })
      ).resolves.toBeNull();
    }

    const throttled = await enforceRateLimit({
      policy: "login_ip_email",
      request,
      keyParts: ["127.0.0.1", "a@example.com"]
    });
    expect(throttled?.status).toBe(429);
    expect(throttled?.headers.get("Retry-After")).toBeTruthy();
    await expect(parseJsonResponse(throttled!)).resolves.toMatchObject({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please try again later."
      }
    });

    await expect(
      enforceRateLimit({
        policy: "login_ip_email",
        request,
        keyParts: ["127.0.0.1", "b@example.com"]
      })
    ).resolves.toBeNull();
  });

  test("fail-closed backend failures return 503 and fail-open failures allow", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new Request("http://localhost/api/test", { method: "POST" });
    setRateLimitTestBackendFailure(new Error("redis unavailable"));

    const closed = await enforceRateLimit({
      policy: "signup_ip",
      request,
      keyParts: ["127.0.0.1"]
    });
    expect(closed?.status).toBe(503);

    const open = await enforceRateLimit({
      policy: "checkout_create",
      request,
      keyParts: ["user", "event", "127.0.0.1"]
    });
    expect(open).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      "Rate limit guard",
      expect.objectContaining({
        policy: "checkout_create",
        reason: "backend_unavailable_fail_open"
      })
    );
  });

  test("disabled limiter preserves existing behavior", async () => {
    const request = new Request("http://localhost/api/auth/signup", {
      method: "POST"
    });
    setRateLimitTestEnabled(false);
    setRateLimitTestBackendFailure(new Error("redis unavailable"));

    await expect(
      enforceRateLimit({
        policy: "signup_ip",
        request,
        keyParts: ["127.0.0.1"]
      })
    ).resolves.toBeNull();
  });

  test("rate-limit logs redact dynamic identifiers from paths", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const request = new Request(
      "http://localhost/api/orders/cmp2mqct70013nyaulu4bl980/resend",
      { method: "POST" }
    );

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await enforceRateLimit({
        policy: "order_resend",
        request,
        keyParts: ["org", "order", "user"]
      });
    }

    await enforceRateLimit({
      policy: "order_resend",
      request,
      keyParts: ["org", "order", "user"]
    });

    expect(warn).toHaveBeenCalledWith(
      "Rate limit guard",
      expect.objectContaining({
        path: "/api/orders/:id/resend",
        reason: "rate_limited"
      })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "cmp2mqct70013nyaulu4bl980"
    );
  });
});

describe("rate-limited routes", () => {
  beforeEach(() => {
    const backend = createTestRateLimitBackend();
    setRateLimitTestBackend(backend);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(true);
    stripeMocks.createSession.mockReset();
    stripeConnectMocks.createExpressAccount.mockReset();
    stripeConnectMocks.createOnboardingLink.mockReset();
    stripeConnectMocks.disconnectAccount.mockReset();
    stripeConnectMocks.createExpressAccount.mockResolvedValue({
      accountId: "acct_rate_limit",
      orgSlug: "rate-limit-org"
    });
    stripeConnectMocks.createOnboardingLink.mockResolvedValue(
      "https://connect.stripe.test/onboard"
    );
    stripeConnectMocks.disconnectAccount.mockResolvedValue(undefined);
  });

  afterEach(() => {
    setRateLimitTestBackend(null);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(null);
    vi.doUnmock("@/auth");
    vi.doUnmock("bcryptjs");
  });

  test("login throttling stops before the NextAuth handler", async () => {
    vi.resetModules();
    const nextAuthPost = vi.fn(async () => new Response(null, { status: 401 }));
    vi.doMock("@/auth", () => ({
      handlers: {
        GET: vi.fn(),
        POST: nextAuthPost
      }
    }));
    const rateLimit = await import("@/lib/security/rate-limit");
    const backend = rateLimit.createTestRateLimitBackend();
    rateLimit.setRateLimitTestBackend(backend);
    rateLimit.setRateLimitTestBackendFailure(null);
    rateLimit.setRateLimitTestEnabled(true);
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await POST(
        new NextRequest("http://localhost/api/auth/callback/credentials", {
          method: "POST",
          body: new URLSearchParams({
            email: "login@example.com",
            password: "wrong"
          })
        })
      );
    }

    const throttled = await POST(
      new NextRequest("http://localhost/api/auth/callback/credentials", {
        method: "POST",
        body: new URLSearchParams({
          email: "login@example.com",
          password: "wrong"
        })
      })
    );

    expect(throttled.status).toBe(429);
    expect(nextAuthPost).toHaveBeenCalledTimes(10);
  });

  test("signup email throttling stops before password hashing", async () => {
    vi.resetModules();
    const hashMock = vi.fn(async () => "hashed-password");
    vi.doMock("bcryptjs", () => ({
      hash: hashMock
    }));
    const rateLimit = await import("@/lib/security/rate-limit");
    const backend = rateLimit.createTestRateLimitBackend();
    rateLimit.setRateLimitTestBackend(backend);
    rateLimit.setRateLimitTestBackendFailure(null);
    rateLimit.setRateLimitTestEnabled(true);
    const { POST } = await import("@/app/api/auth/signup/route");

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await POST(
        jsonRequest("http://localhost/api/auth/signup", {
          email: "signup-rate@example.com",
          password: "password123",
          accountRole: "member",
          firstName: "Signup",
          lastName: "Rate"
        })
      );
    }

    const throttled = await POST(
      jsonRequest("http://localhost/api/auth/signup", {
        email: "signup-rate@example.com",
        password: "password123",
        accountRole: "member",
        firstName: "Signup",
        lastName: "Rate"
      })
    );

    expect(throttled.status).toBe(429);
    expect(hashMock).toHaveBeenCalledTimes(3);
  });

  test("checkout throttling prevents extra Stripe sessions, orders, and reservations", async () => {
    stripeMocks.createSession.mockImplementation(async () => ({
      id: `cs_rate_limited_${stripeMocks.createSession.mock.calls.length}`,
      url: "https://checkout.stripe.test/session"
    }));
    const { organisation } = await createOrganisationAccount({ stripeReady: true });
    const member = await createMember();
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const ticketType = event.ticketTypes[0];
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await checkout(
        jsonRequest("http://localhost/api/payments/checkout/event", {
          eventId: event.id,
          ticketTypeId: ticketType.id,
          quantity: 1
        })
      );
      expect(response.status).toBe(200);
    }

    const throttled = await checkout(
      jsonRequest("http://localhost/api/payments/checkout/event", {
        eventId: event.id,
        ticketTypeId: ticketType.id,
        quantity: 1
      })
    );

    expect(throttled.status).toBe(429);
    expect(stripeMocks.createSession).toHaveBeenCalledTimes(5);
    await expect(prisma.order.count()).resolves.toBe(5);
    await expect(prisma.ticketReservation.count()).resolves.toBe(5);
  });

  test("resend throttling prevents repeated resend jobs", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Thunderstrux <tickets@example.com>";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { user, organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    const member = await createMember({ email: "resend-rate@example.com" });
    const event = await createEvent({
      organisationId: organisation.id,
      status: "published"
    });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date()
    });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await resendTickets(
        jsonRequest(`http://localhost/api/orders/${order.id}/resend`, undefined, {
          method: "POST"
        }),
        routeContext({ orderId: order.id })
      );
      expect(response.status).toBe(200);
    }

    const throttled = await resendTickets(
      jsonRequest(`http://localhost/api/orders/${order.id}/resend`, undefined, {
        method: "POST"
      }),
      routeContext({ orderId: order.id })
    );

    expect(throttled.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      prisma.emailOutbox.count({
        where: { orderId: order.id, mode: "manual" }
      })
    ).resolves.toBe(10);
  });

  test("organisation create throttling prevents organisation writes", async () => {
    const user = await createUser({ accountRole: "organisation" });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
    await exhaustRateLimit("organisation_create", [user.id, "unknown"], 5);

    const response = await createOrganisation(
      jsonRequest("http://localhost/api/orgs", {
        name: unique("Rate Limited Org")
      })
    );

    expect(response.status).toBe(429);
    await expect(
      prisma.organisation.count({ where: { accountUserId: user.id } })
    ).resolves.toBe(0);
  });

  test("join and leave throttling prevents membership writes", async () => {
    const { organisation } = await createOrganisationAccount();
    const member = await createMember();
    setMockSession({ userId: member.id, email: member.email, accountRole: "member" });

    await exhaustRateLimit(
      "organisation_join_leave",
      [member.id, organisation.slug, "join"],
      30
    );
    const throttledJoin = await joinOrg(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/join`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(throttledJoin.status).toBe(429);
    await expect(
      prisma.organisationMember.count({
        where: { userId: member.id, organisationId: organisation.id }
      })
    ).resolves.toBe(0);

    await joinOrganisation(member.id, organisation.id);
    await exhaustRateLimit(
      "organisation_join_leave",
      [member.id, organisation.slug, "leave"],
      30
    );
    const throttledLeave = await leaveOrg(
      jsonRequest(`http://localhost/api/orgs/${organisation.slug}/leave`, undefined, {
        method: "POST"
      }),
      routeContext({ orgSlug: organisation.slug })
    );
    expect(throttledLeave.status).toBe(429);
    await expect(
      prisma.organisationMember.count({
        where: { userId: member.id, organisationId: organisation.id }
      })
    ).resolves.toBe(1);
  });

  test("ticket check-in and check-out throttling prevents ticket mutations", async () => {
    const { user, organisation } = await createOrganisationAccount();
    const member = await createMember();
    const event = await createEvent({ organisationId: organisation.id });
    const ticketType = event.ticketTypes[0];
    const order = await createOrder({
      organisationId: organisation.id,
      eventId: event.id,
      ticketTypeId: ticketType.id,
      userId: member.id,
      status: "paid",
      paidAt: new Date(),
      unitPrice: ticketType.price
    });
    const uncheckedTicket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        organisationId: organisation.id
      }
    });
    const checkedInAt = new Date("2026-05-01T12:00:00.000Z");
    const checkedTicket = await prisma.ticket.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        organisationId: organisation.id,
        checkedInAt
      }
    });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    await exhaustRateLimit("ticket_check_in_out", [organisation.id, "check-in"], 300);
    const throttledCheckIn = await checkInTicket(
      jsonRequest(
        `http://localhost/api/tickets/${uncheckedTicket.id}/check-in`,
        undefined,
        { method: "POST" }
      ),
      routeContext({ ticketId: uncheckedTicket.id })
    );
    expect(throttledCheckIn.status).toBe(429);
    await expect(
      prisma.ticket.findUniqueOrThrow({
        where: { id: uncheckedTicket.id },
        select: { checkedInAt: true }
      })
    ).resolves.toEqual({ checkedInAt: null });

    await exhaustRateLimit("ticket_check_in_out", [organisation.id, "check-out"], 300);
    const throttledCheckOut = await checkOutTicket(
      jsonRequest(
        `http://localhost/api/tickets/${checkedTicket.id}/check-out`,
        undefined,
        { method: "POST" }
      ),
      routeContext({ ticketId: checkedTicket.id })
    );
    expect(throttledCheckOut.status).toBe(429);
    await expect(
      prisma.ticket.findUniqueOrThrow({
        where: { id: checkedTicket.id },
        select: { checkedInAt: true }
      })
    ).resolves.toEqual({ checkedInAt });
  });

  test("Stripe Connect throttling prevents Stripe calls and disconnect writes", async () => {
    const { user, organisation } = await createOrganisationAccount({
      stripeReady: true
    });
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

    await exhaustRateLimit("stripe_connect_mutation", [organisation.id, "onboard"], 20);
    const throttledOnboard = await connectOnboard(
      jsonRequest("http://localhost/api/stripe/connect/onboard", {
        organisationId: organisation.id
      })
    );
    expect(throttledOnboard.status).toBe(429);
    expect(stripeConnectMocks.createExpressAccount).not.toHaveBeenCalled();
    expect(stripeConnectMocks.createOnboardingLink).not.toHaveBeenCalled();

    await exhaustRateLimit("stripe_connect_mutation", [organisation.id, "continue"], 20);
    const throttledContinue = await connectContinue(
      jsonRequest("http://localhost/api/stripe/connect/continue", {
        organisationId: organisation.id
      })
    );
    expect(throttledContinue.status).toBe(429);
    expect(stripeConnectMocks.createOnboardingLink).not.toHaveBeenCalled();

    await exhaustRateLimit("stripe_connect_mutation", [organisation.id, "disconnect"], 20);
    const throttledDisconnect = await connectDisconnect(
      jsonRequest("http://localhost/api/stripe/connect/disconnect", {
        organisationId: organisation.id
      })
    );
    expect(throttledDisconnect.status).toBe(429);
    expect(stripeConnectMocks.disconnectAccount).not.toHaveBeenCalled();
    await expect(
      prisma.organisation.findUniqueOrThrow({
        where: { id: organisation.id },
        select: { stripeAccountId: true }
      })
    ).resolves.toEqual({ stripeAccountId: organisation.stripeAccountId });
  });
});
