import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createUser, unique } from "@/tests/helpers/test-data";
import { POST as createOrganisation } from "@/app/api/orgs/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { GET as getCsrfToken } from "@/app/api/security/csrf/route";
import { createCsrfTokenForRequest } from "@/lib/security/csrf";
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

  test("accepts trusted referer when origin is missing", async () => {
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
          headers: { referer: "http://localhost:3000/dashboard/orgs" }
        })
      );

      expect(response.status).toBe(201);
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
