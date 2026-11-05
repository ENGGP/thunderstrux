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
  checkRateLimitReadiness,
  enforceRateLimit,
  getRateLimitClientIp,
  policies,
  setRateLimitRedisClientFactoryForTests,
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
import { POST as beginMfaSetup } from "@/app/api/me/mfa/setup/route";

const stripeMocks = vi.hoisted(() => ({
  createSession: vi.fn()
}));

const stripeConnectMocks = vi.hoisted(() => ({
  startOrganisationStripeOnboarding: vi.fn(),
  continueOrganisationStripeOnboarding: vi.fn(),
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

  class OrganisationStripeConnectNotFoundError extends Error {}
  class OrganisationStripeConnectValidationError extends Error {}
  class StripeDisconnectBlockedError extends Error {}
  class StripeDisconnectUnavailableError extends Error {}

  return {
    StripeConnectPlatformNotReadyError,
    OrganisationStripeConnectNotFoundError,
    OrganisationStripeConnectValidationError,
    StripeDisconnectBlockedError,
    StripeDisconnectUnavailableError,
    startOrganisationStripeOnboarding:
      stripeConnectMocks.startOrganisationStripeOnboarding,
    continueOrganisationStripeOnboarding:
      stripeConnectMocks.continueOrganisationStripeOnboarding,
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
      dashboard_available: false
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

function parseConsoleJson(spy: ReturnType<typeof vi.spyOn>, index = 0) {
  const message = spy.mock.calls[index]?.[0];

  if (typeof message !== "string") {
    throw new Error("Expected structured log string");
  }

  return JSON.parse(message) as Record<string, unknown>;
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
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
    expect(parseConsoleJson(warn)).toMatchObject({
      level: "warn",
      event: "rate_limit.rejected",
      policy: "login_ip_email",
      method: "POST",
      path: "/api/auth/callback/credentials",
      reason: "rate_limited"
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
    expect(warn.mock.calls.map((call) => JSON.parse(String(call[0])))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "warn",
          event: "rate_limit.backend_unavailable",
        policy: "checkout_create",
        reason: "backend_unavailable_fail_open"
        })
      ])
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

  test("uses only the configured edge-owned client IP header", () => {
    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_HEADER", "cf-connecting-ip");

    expect(
      getRateLimitClientIp(
        new Request("http://localhost/api/test", {
          headers: {
            "cf-connecting-ip": "203.0.113.8",
            "x-forwarded-for": "198.51.100.20",
            "x-real-ip": "192.0.2.4"
          }
        })
      )
    ).toBe("203.0.113.8");

    expect(
      getRateLimitClientIp(
        new Request("http://localhost/api/test", {
          headers: { "x-forwarded-for": "198.51.100.20" }
        })
      )
    ).toBe("unknown");
  });

  test("an IPv6 client is keyed by its /64, and an IPv4-mapped address by its IPv4 address (T53)", () => {
    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_HEADER", "x-forwarded-for");
    const ip = (value: string) => getRateLimitClientIp(new Request("http://localhost/api/test", { headers: { "x-forwarded-for": value } }));
    expect(ip("2001:db8:aaaa:bbbb:1:2:3:4")).toBe("2001:db8:aaaa:bbbb::/64");
    expect(ip("2001:DB8:AAAA:BBBB::99")).toBe("2001:db8:aaaa:bbbb::/64");
    expect(ip("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ip("2001:db8:aaaa:bbbb:ffff::1%eth0")).toBe("2001:db8:aaaa:bbbb::/64");
    expect(ip("::ffff:203.0.113.8")).toBe("203.0.113.8");
    expect(ip("203.0.113.8")).toBe("203.0.113.8");
  });

  test("rejects proxy chains and invalid configured header names", () => {
    expect(
      getRateLimitClientIp(
        new Request("http://localhost/api/test", {
          headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.2" }
        })
      )
    ).toBe("unknown");

    vi.stubEnv("RATE_LIMIT_TRUSTED_PROXY_HEADER", "bad header");
    expect(
      getRateLimitClientIp(
        new Request("http://localhost/api/test")
      )
    ).toBe("unknown");
  });

  test("MFA setup throttles by authenticated user when forwarding headers change", async () => {
    const { user } = await createOrganisationAccount();
    setMockSession({ userId: user.id, email: user.email, accountRole: "organisation",
      mfaSessionId: "rate-limit-session" });
    vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await beginMfaSetup(jsonRequest("http://localhost/api/me/mfa/setup", { password: "password123" }, {
        method: "POST", headers: { "x-forwarded-for": `198.51.100.${attempt + 1}` }
      }));
      expect(response.status).toBe(200);
    }
    const throttled = await beginMfaSetup(jsonRequest("http://localhost/api/me/mfa/setup", { password: "password123" }, {
      method: "POST", headers: { "x-forwarded-for": "203.0.113.250" }
    }));
    expect(throttled.status).toBe(429);
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

    expect(parseConsoleJson(warn)).toMatchObject({
      level: "warn",
      event: "rate_limit.rejected",
        path: "/api/orders/:id/resend",
        reason: "rate_limited"
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      "cmp2mqct70013nyaulu4bl980"
    );
  });
});

describe("Redis rate-limit connection", () => {
  afterEach(() => {
    setRateLimitRedisClientFactoryForTests(null);
    setRateLimitTestBackend(null);
    setRateLimitTestEnabled(null);
  });

  test("shares one cold-start connection across concurrent readiness checks", async () => {
    let releaseConnection!: () => void;
    const connectionGate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const fakeClient = {
      isReady: false,
      isOpen: false,
      on: vi.fn(),
      destroy: vi.fn(),
      connect: vi.fn(async () => {
        fakeClient.isOpen = true;
        await connectionGate;
        fakeClient.isReady = true;
        return fakeClient;
      }),
      ping: vi.fn(async () => "PONG")
    };
    setRateLimitRedisClientFactoryForTests((() => fakeClient) as never);
    setRateLimitTestBackend(null);
    setRateLimitTestEnabled(null);
    vi.stubEnv("RATE_LIMIT_ENABLED", "true");
    vi.stubEnv("RATE_LIMIT_REDIS_URL", "redis://rate-limit.test:6379");

    const checks = [
      checkRateLimitReadiness(),
      checkRateLimitReadiness(),
      checkRateLimitReadiness()
    ];
    await Promise.resolve();
    expect(fakeClient.connect).toHaveBeenCalledTimes(1);
    releaseConnection();
    await expect(Promise.all(checks)).resolves.toEqual([undefined, undefined, undefined]);
    expect(fakeClient.ping).toHaveBeenCalledTimes(3);
  });
});

describe("rate-limited routes", () => {
  beforeEach(() => {
    const backend = createTestRateLimitBackend();
    setRateLimitTestBackend(backend);
    setRateLimitTestBackendFailure(null);
    setRateLimitTestEnabled(true);
    stripeMocks.createSession.mockReset();
    stripeConnectMocks.startOrganisationStripeOnboarding.mockReset();
    stripeConnectMocks.continueOrganisationStripeOnboarding.mockReset();
    stripeConnectMocks.disconnectAccount.mockReset();
    stripeConnectMocks.startOrganisationStripeOnboarding.mockResolvedValue(
      "https://connect.stripe.test/onboard"
    );
    stripeConnectMocks.continueOrganisationStripeOnboarding.mockResolvedValue(
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

  test("duplicate email fields are refused before the NextAuth handler (SEC-007)", async () => {
    vi.resetModules();
    const nextAuthPost = vi.fn(async () => new Response(null, { status: 401 }));
    vi.doMock("@/auth", () => ({ handlers: { GET: vi.fn(), POST: nextAuthPost } }));
    const rateLimit = await import("@/lib/security/rate-limit");
    rateLimit.setRateLimitTestBackend(rateLimit.createTestRateLimitBackend());
    rateLimit.setRateLimitTestBackendFailure(null);
    rateLimit.setRateLimitTestEnabled(true);
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");

    const body = new URLSearchParams([["email", "decoy@example.com"], ["email", "victim@example.com"], ["password", "wrong"]]);
    const response = await POST(new NextRequest("http://localhost/api/auth/callback/credentials", { method: "POST", body }));
    expect(response.status).toBe(400);
    expect(nextAuthPost).not.toHaveBeenCalled();
  });

  test("only a plain form with an address reaches the NextAuth handler (SEC-040)", async () => {
    vi.resetModules();
    const nextAuthPost = vi.fn(async () => new Response(null, { status: 401 }));
    vi.doMock("@/auth", () => ({ handlers: { GET: vi.fn(), POST: nextAuthPost } }));
    const rateLimit = await import("@/lib/security/rate-limit");
    rateLimit.setRateLimitTestBackend(rateLimit.createTestRateLimitBackend());
    rateLimit.setRateLimitTestBackendFailure(null);
    rateLimit.setRateLimitTestEnabled(true);
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const post = (contentType: string, body: string) =>
      POST(new NextRequest("http://localhost/api/auth/callback/credentials", { method: "POST", headers: { "content-type": contentType }, body }));

    // Auth.js reads the JSON here, while a form parser sees the decoy.
    const bothReadings = '{"email":"victim@example.com","password":"wrong","z":"&email=decoy@example.com&"}';
    expect((await post("application/json", '{"email":"victim@example.com","password":"wrong"}')).status).toBe(400);
    expect((await post("application/x-www-form-urlencoded; charset=application/json", bothReadings)).status).toBe(400);
    expect((await post("application/x-www-form-urlencoded, application/json", bothReadings)).status).toBe(400);
    expect((await post("application/x-www-form-urlencoded", "password=wrong")).status).toBe(400);
    expect((await post("application/x-www-form-urlencoded", `email=member%40example.com&password=${"x".repeat(10_000)}`)).status).toBe(400);
    expect(nextAuthPost).not.toHaveBeenCalled();

    expect((await post("application/x-www-form-urlencoded", "email=member%40example.com&password=wrong")).status).toBe(401);
    expect((await post("application/x-www-form-urlencoded;charset=UTF-8", "email=member%40example.com&password=wrong")).status).toBe(401);
    expect(nextAuthPost).toHaveBeenCalledTimes(2);
  });

  test("one account's sign-ins are capped across addresses (DEBT-002)", async () => {
    vi.resetModules();
    const nextAuthPost = vi.fn(async () => new Response(null, { status: 401 }));
    vi.doMock("@/auth", () => ({ handlers: { GET: vi.fn(), POST: nextAuthPost } }));
    const rateLimit = await import("@/lib/security/rate-limit");
    rateLimit.setRateLimitTestBackend(rateLimit.createTestRateLimitBackend());
    rateLimit.setRateLimitTestBackendFailure(null);
    rateLimit.setRateLimitTestEnabled(true);
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    // Thirty attempts from other addresses already spent this account's hour.
    const elsewhere = new Request("http://localhost/api/auth/callback/credentials", { method: "POST" });
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await expect(rateLimit.enforceRateLimit({ policy: "login_email", request: elsewhere, keyParts: ["target@example.com"] })).resolves.toBeNull();
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const signIn = (email: string) => POST(new NextRequest("http://localhost/api/auth/callback/credentials", { method: "POST", body: new URLSearchParams({ email, password: "wrong" }) }));
    expect((await signIn(" Target@Example.com ")).status).toBe(429);
    expect(nextAuthPost).not.toHaveBeenCalled();
    expect((await signIn("someone-else@example.com")).status).toBe(401);
  });

  // A fresh route module with Auth.js replaced, the rate limiter on and a clean in-memory backend.
  async function authRoute(nextAuthPost: (request: Request) => Promise<Response>) {
    vi.resetModules();
    vi.doMock("@/auth", () => ({ authSecret: "integration-auth-secret", handlers: { GET: vi.fn(), POST: nextAuthPost } }));
    const rateLimit = await import("@/lib/security/rate-limit");
    rateLimit.setRateLimitTestBackend(rateLimit.createTestRateLimitBackend());
    rateLimit.setRateLimitTestBackendFailure(null);
    rateLimit.setRateLimitTestEnabled(true);
    return { rateLimit, POST: (await import("@/app/api/auth/[...nextauth]/route")).POST };
  }
  const form = { "content-type": "application/x-www-form-urlencoded" };

  test("every Auth.js POST reads at most 10 KB, and all but sign-out count on the per-address limit (SEC-049, SEC-058)", async () => {
    const nextAuthPost = vi.fn(async () => new Response(null, { status: 302 }));
    const { rateLimit, POST } = await authRoute(nextAuthPost);
    for (const path of ["signout", "session", "signin", "signin/credentials"]) {
      const response = await POST(new NextRequest(`http://localhost/api/auth/${path}`, { method: "POST", headers: form, body: `csrfToken=${"a".repeat(11_000)}` }));
      expect(response.status).toBe(400);
    }
    // A streamed body is cut off near the cap, never read to its end.
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) {
      if (pulled >= 8_000_000) return controller.close();
      pulled += 65_536; controller.enqueue(new Uint8Array(65_536).fill(97));
    } });
    const streamed = await POST(new NextRequest(new Request("http://localhost/api/auth/signout", { method: "POST", headers: form, body: stream, duplex: "half" } as RequestInit)));
    expect(streamed.status).toBe(400);
    expect(pulled).toBeLessThan(1_000_000);
    expect(nextAuthPost).not.toHaveBeenCalled();
    expect((await POST(new NextRequest("http://localhost/api/auth/signout", { method: "POST", headers: form, body: "csrfToken=x" }))).status).toBe(302);

    const spent = new Request("http://localhost/api/auth/signout", { method: "POST" });
    for (let attempt = 1; attempt < policies.login_ip_global.limit; attempt += 1) {
      await rateLimit.enforceRateLimit({ policy: "login_ip_global", request: spent, keyParts: [rateLimit.getRateLimitClientIp(spent)] });
    }
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const post = (path: string) => POST(new NextRequest(`http://localhost/api/auth/${path}`, { method: "POST", headers: form, body: "csrfToken=x" }));
    // Others behind the same address spent its budget: they are refused, sign-out still works.
    expect((await post("session")).status).toBe(429);
    expect((await post("signout")).status).toBe(302);
    // So does a limiter outage, which fails closed for everything else.
    rateLimit.setRateLimitTestBackendFailure(new Error("synthetic Redis failure"));
    expect((await post("session")).status).toBe(503);
    expect((await post("signout")).status).toBe(302);
    expect(nextAuthPost).toHaveBeenCalledTimes(3);
  });

  test("a browser that signed in before still gets in while anonymous guesses lock the account (SEC-050)", async () => {
    const user = await createMember();
    const { rateLimit, POST } = await authRoute(async (request) => new URLSearchParams(await request.text()).get("password") === "password123"
      ? new Response(null, { status: 302, headers: { location: "http://localhost/dashboard", "set-cookie": "authjs.session-token=signed; Path=/; HttpOnly" } })
      : new Response(null, { status: 302, headers: { location: "http://localhost/login?error=CredentialsSignin" } }));
    const signIn = (password: string, cookie?: string) => POST(new NextRequest("http://localhost/api/auth/callback/credentials", {
      method: "POST", headers: { ...form, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams({ email: user.email, password })
    }));
    expect((await signIn("wrong")).headers.getSetCookie().some((cookie) => cookie.startsWith("thunderstrux-known-device="))).toBe(false);
    const device = (await signIn("password123")).headers.getSetCookie().find((cookie) => cookie.startsWith("thunderstrux-known-device="))!;
    expect(device).toContain("HttpOnly");
    expect(device).toContain("Path=/api/auth/callback/credentials");
    const cookie = device.split(";", 1)[0];

    // Thirty guesses from other addresses spend the account's hour.
    const elsewhere = new Request("http://localhost/api/auth/callback/credentials", { method: "POST" });
    for (let attempt = 0; attempt < 30; attempt += 1) await rateLimit.enforceRateLimit({ policy: "login_email", request: elsewhere, keyParts: [user.email] });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect((await signIn("password123")).status).toBe(429);
    expect((await signIn("password123", cookie)).status).toBe(302);
    expect((await signIn("password123", `thunderstrux-known-device=${"A".repeat(22)}.forged`)).status).toBe(429);
    // A password reset, email change or support sign-out bumps authVersion, which ends the exemption.
    await prisma.user.update({ where: { id: user.id }, data: { authVersion: { increment: 1 } } });
    expect((await signIn("password123", cookie)).status).toBe(429);
  });

  test("signing out ends that login's staff MFA grant, and only that one (#49)", async () => {
    const user = await createMember();
    // Auth.js clears the session cookie only when the sign-out passed its CSRF check.
    const { POST } = await authRoute(async (request) => new URLSearchParams(await request.text()).get("csrfToken") === "valid"
      ? new Response(null, { status: 302, headers: { "set-cookie": "authjs.session-token=; Path=/; Max-Age=0" } })
      : new Response(null, { status: 302, headers: { location: "http://localhost/api/auth/signin?error=MissingCSRF" } }));
    const { mfaGrantDigest } = await import("@/lib/security/csrf");
    const { encode } = await import("next-auth/jwt");
    const { resolveAuthSecret } = await import("@/lib/auth/secret");
    for (const login of ["login-a", "login-b"]) {
      await prisma.mfaGrant.create({ data: { userId: user.id, sessionDigest: mfaGrantDigest(login)!, verifiedAt: new Date(), expiresAt: new Date(Date.now() + 3_600_000) } });
    }
    const token = await encode({ secret: resolveAuthSecret(), salt: "authjs.session-token", token: { userId: user.id, authVersion: 0, staffMfaSessionId: "login-a" } });
    const signOut = (csrfToken: string) => POST(new NextRequest("http://localhost/api/auth/signout", { method: "POST", headers: { ...form, cookie: `authjs.session-token=${token}` }, body: `csrfToken=${csrfToken}` }));
    await signOut("forged");
    expect(await prisma.mfaGrant.count()).toBe(2);
    await signOut("valid");
    expect((await prisma.mfaGrant.findMany({ select: { sessionDigest: true } })).map((grant) => grant.sessionDigest)).toEqual([mfaGrantDigest("login-b")]);
  });

  test("password checks past the gate are refused with 503 and Retry-After, not queued (SEC-019)", async () => {
    const nextAuthPost = vi.fn(async () => new Response(null, { status: 302 }));
    const { POST } = await authRoute(nextAuthPost);
    const { comparePassword, maxPasswordWork, PasswordBusyError } = await import("@/lib/auth/password-hash");
    const { mapRouteError } = await import("@/lib/api/errors");
    const { hash } = await import("bcryptjs");
    const digest = await hash("secret-value", 12);
    const running = Array.from({ length: maxPasswordWork }, () => comparePassword("secret-value", digest));
    await expect(comparePassword("secret-value", digest)).rejects.toBeInstanceOf(PasswordBusyError);
    const busy = await POST(new NextRequest("http://localhost/api/auth/callback/credentials", { method: "POST", headers: form, body: "email=member%40example.com&password=wrong" }));
    expect(busy.status).toBe(503);
    expect(busy.headers.get("Retry-After")).toBe("5");
    expect(nextAuthPost).not.toHaveBeenCalled();
    const mapped = mapRouteError(new PasswordBusyError(), { operation: "test" });
    expect([mapped.status, mapped.headers.get("Retry-After")]).toEqual([503, "5"]);
    expect(await Promise.all(running)).toEqual(Array(maxPasswordWork).fill(true));
    await expect(comparePassword("secret-value", digest)).resolves.toBe(true);
  });

  test("an unknown reset token costs no password hash (SEC-019)", async () => {
    vi.resetModules();
    const hashMock = vi.fn(async () => "hashed-password");
    vi.doMock("bcryptjs", async (importOriginal) => ({ ...(await importOriginal<typeof import("bcryptjs")>()), hash: hashMock }));
    const { consumePasswordReset } = await import("@/lib/auth/account-lifecycle");
    await expect(consumePasswordReset("a".repeat(43), "replacement123")).rejects.toThrow();
    expect(hashMock).not.toHaveBeenCalled();
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

  test("checkout throttling prevents extra Stripe sessions, orders, and reservations, whatever the client address (SEC-005)", async () => {
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
          expectedUnitPrice: ticketType.price,
          idempotencyKey: unique("checkout"),
          quantity: 1
        }, { headers: { "x-forwarded-for": `198.51.100.${attempt + 1}` } })
      );
      expect(response.status).toBe(200);
    }

    const throttled = await checkout(
      jsonRequest("http://localhost/api/payments/checkout/event", {
        eventId: event.id,
        ticketTypeId: ticketType.id,
        expectedUnitPrice: ticketType.price,
        idempotencyKey: unique("checkout"),
        quantity: 1
      }, { headers: { "x-forwarded-for": "203.0.113.99" } })
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
    // SEC-057: a resend already waiting is the one the buyer gets, so ten requests queue one email.
    await expect(
      prisma.emailOutbox.count({
        where: { orderId: order.id, mode: "manual" }
      })
    ).resolves.toBe(1);

    // One society's resends share a budget, so it can't fill the queue every society uses.
    const another = await createOrder({ organisationId: organisation.id, eventId: event.id, ticketTypeId: ticketType.id, userId: member.id, status: "paid", paidAt: new Date() });
    const elsewhere = new Request("http://localhost/api/orders/x/resend", { method: "POST" });
    for (let spent = 10; spent < policies.order_resend_society.limit; spent += 1) {
      await enforceRateLimit({ policy: "order_resend_society", request: elsewhere, keyParts: [organisation.id] });
    }
    const societyThrottled = await resendTickets(
      jsonRequest(`http://localhost/api/orders/${another.id}/resend`, undefined, { method: "POST" }),
      routeContext({ orderId: another.id })
    );
    expect(societyThrottled.status).toBe(429);
    expect(await prisma.emailOutbox.count({ where: { orderId: another.id, mode: "manual" } })).toBe(0);
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

  // DEF-066: a campus shares one address, so these only stop floods.
  test("per-address limits leave room for a campus rush", () => {
    expect(policies).toMatchObject({
      guest_email_ip: { limit: 200, windowSeconds: 3600 },
      signup_ip: { limit: 250, windowSeconds: 3600 },
      login_ip_global: { limit: 500, windowSeconds: 600 },
      guest_token_ip: { limit: 500, windowSeconds: 600 },
      account_token_ip: { limit: 500, windowSeconds: 600 },
      ticket_code_check: { limit: 600, windowSeconds: 600 }
    });
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
        issueSequence: 1,
        orderId: order.id,
        eventId: event.id,
        ticketTypeId: ticketType.id,
        organisationId: organisation.id
      }
    });
    const checkedInAt = new Date("2026-05-01T12:00:00.000Z");
    const checkedTicket = await prisma.ticket.create({
      data: {
        issueSequence: 2,
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
    expect(
      stripeConnectMocks.startOrganisationStripeOnboarding
    ).not.toHaveBeenCalled();

    await exhaustRateLimit("stripe_connect_mutation", [organisation.id, "continue"], 20);
    const throttledContinue = await connectContinue(
      jsonRequest("http://localhost/api/stripe/connect/continue", {
        organisationId: organisation.id
      })
    );
    expect(throttledContinue.status).toBe(429);
    expect(
      stripeConnectMocks.continueOrganisationStripeOnboarding
    ).not.toHaveBeenCalled();

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
