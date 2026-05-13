import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse, routeContext } from "@/tests/helpers/http";
import {
  createEvent,
  createMember,
  createOrder,
  createOrganisationAccount
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

const stripeMocks = vi.hoisted(() => ({
  createSession: vi.fn()
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
});
