import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createUser, unique } from "@/tests/helpers/test-data";
import { POST as createOrganisation } from "@/app/api/orgs/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as getCsrfToken } from "@/app/api/security/csrf/route";
import { createCsrfTokenForRequest, verifyCsrfTokenForRequest } from "@/lib/security/csrf";
import { trustedRequestOrigin } from "@/lib/security/request-guard";
import { POST as paymentsWebhook } from "@/app/api/payments/webhook/route";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";

function parseConsoleJson(spy: ReturnType<typeof vi.spyOn>, index = 0) {
  const message = spy.mock.calls[index]?.[0];

  if (typeof message !== "string") {
    throw new Error("Expected structured log string");
  }

  return JSON.parse(message) as Record<string, unknown>;
}

function withAppUrlEnv(value: string, run: () => Promise<void>) {
  const previous = process.env.NEXT_PUBLIC_APP_URL;
  process.env.NEXT_PUBLIC_APP_URL = value;

  return run().finally(() => {
    if (previous === undefined) {
      delete process.env.NEXT_PUBLIC_APP_URL;
    } else {
      process.env.NEXT_PUBLIC_APP_URL = previous;
    }
  });
}

describe("trusted origin guard", () => {
  test("a redirect follows the request's origin only when it is trusted", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://thunderstrux.example");
    vi.stubEnv("TRUSTED_APP_ORIGINS", "http://127.0.0.1:3080");
    const from = (origin?: string) => trustedRequestOrigin(new Request("http://internal:3000/api/x", { method: "POST", headers: origin ? { origin } : {} }));
    expect(from("http://127.0.0.1:3080")).toBe("http://127.0.0.1:3080");
    expect(from("https://thunderstrux.example")).toBe("https://thunderstrux.example");
    // Foreign, malformed and missing origins fall back to the app URL in the caller.
    for (const origin of ["https://evil.example", "http://127.0.0.1:3080/path", "null", undefined]) expect(from(origin)).toBeUndefined();
  });

  test("accepts first-party origin on protected mutation", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const response = await createOrganisation(
        jsonRequest("http://localhost/api/orgs", { name: unique("Org") }, {
          method: "POST",
          headers: { origin: "http://localhost:3000" }
        })
      );

      expect(response.status).toBe(201);
      const body = await parseJsonResponse(response);
      expect(body).toMatchObject({
        organisation: {
          id: expect.any(String),
          name: expect.any(String)
        }
      });
    });
  });

  test("rejects untrusted origin on protected mutation without writing rows", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const response = await createOrganisation(
        jsonRequest("http://localhost/api/orgs", { name: unique("Org") }, {
          method: "POST",
          headers: { origin: "https://evil.example" }
        })
      );

      expect(response.status).toBe(403);
      await expect(parseJsonResponse(response)).resolves.toMatchObject({
        error: {
          code: "FORBIDDEN",
          message: "Untrusted request origin"
        }
      });
      await expect(prisma.organisation.count()).resolves.toBe(0);
      expect(parseConsoleJson(warn)).toMatchObject({
          level: "warn",
          event: "trusted_origin.rejected",
          method: "POST",
          path: "/api/orgs",
          origin: "https://evil.example",
          refererOrigin: null,
          reason: "untrusted_origin"
      });
    });
  });

  test("rejects null origin on protected mutation", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const response = await createOrganisation(
        jsonRequest("http://localhost/api/orgs", { name: unique("Org") }, {
          method: "POST",
          headers: { origin: "null" }
        })
      );

      expect(response.status).toBe(403);
      expect(parseConsoleJson(warn)).toMatchObject({
          level: "warn",
          event: "trusted_origin.rejected",
          reason: "null_origin"
      });
    });
  });

  test("rejects malformed Origin values and does not log Referer query tokens", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const response = await signup(
        jsonRequest("http://localhost/api/auth/signup", {
          email: `${unique("signup")}@example.com`,
          password: "password123",
          accountRole: "member"
        }, {
          headers: {
            origin: "http://localhost:3000/path?token=origin-do-not-log",
            referer: "http://localhost:3000/invite?token=do-not-log"
          }
        })
      );

      expect(response.status).toBe(403);
      const log = parseConsoleJson(warn);
      expect(log).toMatchObject({
        event: "trusted_origin.rejected",
        reason: "untrusted_origin",
        refererOrigin: "http://localhost:3000"
      });
      expect(JSON.stringify(log)).not.toContain("do-not-log");
      await expect(prisma.user.count()).resolves.toBe(0);
    });
  });

  test("signup rejects a missing first-party origin before hashing or writing", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const response = await signup(
        new Request("http://localhost/api/auth/signup", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: `${unique("signup")}@example.com`,
            password: "password123",
            accountRole: "member"
          })
        })
      );
      expect(response.status).toBe(403);
      expect(parseConsoleJson(warn)).toMatchObject({
        reason: "missing_origin_and_referer"
      });
      await expect(prisma.user.count()).resolves.toBe(0);
    });
  });

  test("with duplicate session cookies, the token binds the first, which Auth.js authenticates (T53)", () => {
    const token = createCsrfTokenForRequest(new Request("http://localhost/", { headers: { cookie: "authjs.session-token=real" } }))!;
    const request = (cookie: string) => new Request("http://localhost/", { headers: { cookie, "x-thunderstrux-csrf-token": token } });
    expect(verifyCsrfTokenForRequest(request("authjs.session-token=real; authjs.session-token=planted"))).toBe(true);
    expect(verifyCsrfTokenForRequest(request("authjs.session-token=planted; authjs.session-token=real"))).toBe(false);
  });

  test("session cookie mutations require a session-bound CSRF header", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      vi.stubEnv("AUTH_SECRET", "integration-csrf-secret");
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });
      const cookie = "authjs.session-token=first-session";
      const tokenResponse = await getCsrfToken(new Request("http://localhost/api/security/csrf", {
        headers: { cookie }
      }));
      expect(tokenResponse.status).toBe(200);
      expect(tokenResponse.headers.get("cache-control")).toBe("no-store");
      const { token } = await parseJsonResponse(tokenResponse);

      const missing = await createOrganisation(jsonRequest("http://localhost/api/orgs", {
        name: unique("Org")
      }, { headers: { cookie } }));
      expect(missing.status).toBe(403);
      await expect(prisma.organisation.count()).resolves.toBe(0);

      const otherSession = createCsrfTokenForRequest(new Request("http://localhost/", {
        headers: { cookie: "authjs.session-token=other-session" }
      }));
      const wrong = await createOrganisation(jsonRequest("http://localhost/api/orgs", {
        name: unique("Org")
      }, { headers: { cookie, "x-thunderstrux-csrf-token": otherSession! } }));
      expect(wrong.status).toBe(403);

      const valid = await createOrganisation(jsonRequest("http://localhost/api/orgs", {
        name: unique("Org")
      }, { headers: { cookie, "x-thunderstrux-csrf-token": token } }));
      expect(valid.status).toBe(201);
    });
  });

  test("a CSRF token is refused once its hour has passed, in another version or shape, and without a session cookie", () => {
    const cookie = "authjs.session-token=token-session";
    const now = Date.UTC(2026, 9, 26, 10, 59, 59);
    const token = createCsrfTokenForRequest(new Request("http://localhost/", { headers: { cookie } }), now)!;
    const check = (supplied: string, at = now) =>
      verifyCsrfTokenForRequest(new Request("http://localhost/", { headers: { cookie, "x-thunderstrux-csrf-token": supplied } }), at);
    expect(token).toMatch(/^v1\.\d+\.[a-f0-9]{64}$/);
    expect(check(token)).toBe(true);
    expect(check(token, now + 1000)).toBe(false);
    const [, hour, digest] = token.split(".");
    for (const forged of [`v2.${hour}.${digest}`, `${token}.extra`, `v1.${hour}x.${digest}`, `v1.${hour}.${digest.slice(0, 63)}`, `v1.${Number(hour) + 1}.${digest}`]) {
      expect(check(forged)).toBe(false);
    }
    expect(verifyCsrfTokenForRequest(new Request("http://localhost/", { headers: { "x-thunderstrux-csrf-token": token } }), now)).toBe(false);
    expect(createCsrfTokenForRequest(new Request("http://localhost/"), now)).toBeNull();
  });

  test("a session split across chunked cookies binds the same token as the whole cookie", () => {
    const now = Date.UTC(2026, 9, 26, 10, 0, 0);
    const whole = createCsrfTokenForRequest(new Request("http://localhost/", { headers: { cookie: "__Secure-authjs.session-token=abcdef" } }), now)!;
    const check = (cookie: string) => verifyCsrfTokenForRequest(new Request("http://localhost/", { headers: { cookie, "x-thunderstrux-csrf-token": whole } }), now);
    expect(check("__Secure-authjs.session-token.0=abc; __Secure-authjs.session-token.1=def")).toBe(true);
    expect(check("__Secure-authjs.session-token.0=abc; __Secure-authjs.session-token.1=xyz")).toBe(false);
    expect(check("__Secure-authjs.session-token.0=abc")).toBe(false);
    // Another cookie name is another session, even with the same value.
    expect(check("authjs.session-token=abcdef")).toBe(false);
  });

  // Built without jsonRequest, which always adds an Origin header: these reach
  // the Referer fallback a browser uses when it strips Origin.
  const fromReferer = (referer: string, headers: Record<string, string> = {}) => new Request("http://localhost/api/orgs", {
    method: "POST", headers: { "content-type": "application/json", referer, ...headers }, body: JSON.stringify({ name: unique("Org") })
  });

  test("accepts trusted referer when origin is missing", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const response = await createOrganisation(fromReferer("http://localhost:3000/dashboard/orgs"));

      expect(response.status).toBe(201);
    });
  });

  test("without an origin, a foreign or malformed referer is refused, and a session cookie still needs its CSRF token", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({ userId: user.id, email: user.email, accountRole: "organisation" });

      for (const referer of ["https://evil.example/dashboard", "not a url"]) {
        expect((await createOrganisation(fromReferer(referer))).status).toBe(403);
      }
      expect(warn.mock.calls.map(([line]) => JSON.parse(String(line))).filter((entry) => entry.event === "trusted_origin.rejected")).toEqual([
        expect.objectContaining({ reason: "untrusted_referer", origin: null, refererOrigin: "https://evil.example" }),
        expect.objectContaining({ reason: "untrusted_referer", origin: null, refererOrigin: null })
      ]);

      const cookie = "authjs.session-token=referer-session";
      expect((await createOrganisation(fromReferer("http://localhost:3000/dashboard/orgs", { cookie }))).status).toBe(403);
      await expect(prisma.organisation.count()).resolves.toBe(0);
      const token = createCsrfTokenForRequest(new Request("http://localhost/", { headers: { cookie } }))!;
      expect((await createOrganisation(fromReferer("http://localhost:3000/dashboard/orgs", { cookie, "x-thunderstrux-csrf-token": token }))).status).toBe(201);
    });
  });

  test("rejects missing origin and referer without writing rows", async () => {
    await withAppUrlEnv("http://localhost:3000", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const user = await createUser({ accountRole: "organisation" });
      setMockSession({
        userId: user.id,
        email: user.email,
        accountRole: "organisation"
      });

      const response = await createOrganisation(
        new Request("http://localhost/api/orgs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: unique("Org") })
        })
      );

      expect(response.status).toBe(403);
      await expect(prisma.organisation.count()).resolves.toBe(0);
      expect(parseConsoleJson(warn)).toMatchObject({
          level: "warn",
          event: "trusted_origin.rejected",
          method: "POST",
          path: "/api/orgs",
          origin: null,
          refererOrigin: null,
          reason: "missing_origin_and_referer"
      });
    });
  });

  test("Stripe checkout webhook remains exempt from trusted-origin guard", async () => {
    const response = await paymentsWebhook(
      new Request("http://localhost/api/payments/webhook", {
        method: "POST",
        body: "{}"
      })
    );

    expect(response.status).toBe(400);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      error: "Missing Stripe signature"
    });
  });

  test("Stripe checkout webhook invalid signature preserves response and emits structured alert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await paymentsWebhook(
      new Request("http://localhost/api/payments/webhook", {
        method: "POST",
        headers: { "stripe-signature": "invalid-signature" },
        body: JSON.stringify({ id: "evt_invalid", secret: "do-not-log" })
      })
    );

    expect(response.status).toBe(400);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      error: "Invalid Stripe signature"
    });

    expect(parseConsoleJson(error, 0)).toMatchObject({
      level: "error",
      event: "stripe.webhook.signature_failed",
      reason: "invalid_signature",
      requestBytes: expect.any(Number)
    });
    expect(parseConsoleJson(error, 1)).toMatchObject({
      level: "error",
      event: "stripe_webhook_signature_failure",
      reason: "invalid_signature",
      webhook: "payments"
    });
    expect(parseConsoleJson(info)).toMatchObject({
      level: "info",
      event: "ops.metric",
      metricName: "stripe_webhook_signature_failures_total"
    });

    const output = JSON.stringify([
      ...error.mock.calls.map((call) => call[0]),
      ...info.mock.calls.map((call) => call[0])
    ]);
    expect(output).not.toContain("do-not-log");
    expect(output).not.toContain("evt_invalid");
  });

  test("Stripe Connect webhook remains exempt from trusted-origin guard", async () => {
    const response = await connectWebhook(
      new Request("http://localhost/api/stripe/connect/webhook", {
        method: "POST",
        body: "{}"
      })
    );

    expect(response.status).toBe(400);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      error: "Missing Stripe signature"
    });
  });

  test("Stripe Connect webhook invalid signature preserves response and emits structured alert", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const response = await connectWebhook(
      new Request("http://localhost/api/stripe/connect/webhook", {
        method: "POST",
        headers: { "stripe-signature": "invalid-signature" },
        body: JSON.stringify({ id: "evt_connect_invalid", secret: "do-not-log" })
      })
    );

    expect(response.status).toBe(400);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      error: "Invalid Stripe signature"
    });

    expect(parseConsoleJson(error, 0)).toMatchObject({
      level: "error",
      event: "stripe_connect.webhook.signature_failed",
      reason: "invalid_signature",
      requestBytes: expect.any(Number)
    });
    expect(parseConsoleJson(error, 1)).toMatchObject({
      level: "error",
      event: "stripe_webhook_signature_failure",
      reason: "invalid_signature",
      webhook: "stripe_connect"
    });
    expect(parseConsoleJson(info)).toMatchObject({
      level: "info",
      event: "ops.metric",
      metricName: "stripe_webhook_signature_failures_total",
      tags: {
        webhook: "stripe_connect"
      }
    });

    const output = JSON.stringify([
      ...error.mock.calls.map((call) => call[0]),
      ...info.mock.calls.map((call) => call[0])
    ]);
    expect(output).not.toContain("do-not-log");
    expect(output).not.toContain("evt_connect_invalid");
  });
});
