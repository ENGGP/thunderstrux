import { describe, expect, test, vi } from "vitest";
import { prisma } from "@/lib/db";
import { setMockSession } from "@/tests/helpers/auth";
import { jsonRequest, parseJsonResponse } from "@/tests/helpers/http";
import { createUser, unique } from "@/tests/helpers/test-data";
import { POST as createOrganisation } from "@/app/api/orgs/route";
import { POST as paymentsWebhook } from "@/app/api/payments/webhook/route";
import { POST as connectWebhook } from "@/app/api/stripe/connect/webhook/route";

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
      expect(warn).toHaveBeenCalledWith(
        "Trusted origin guard rejected request",
        expect.objectContaining({
          method: "POST",
          path: "/api/orgs",
          origin: "https://evil.example",
          referer: null,
          reason: "untrusted_origin"
        })
      );
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
      expect(warn).toHaveBeenCalledWith(
        "Trusted origin guard rejected request",
        expect.objectContaining({
          reason: "null_origin"
        })
      );
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

  test("temporarily allows missing origin and referer with compatibility warning", async () => {
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
          method: "POST"
        })
      );

      expect(response.status).toBe(201);
      expect(warn).toHaveBeenCalledWith(
        "Trusted origin guard compatibility allow",
        expect.objectContaining({
          method: "POST",
          path: "/api/orgs",
          origin: null,
          referer: null,
          reason: "missing_origin_and_referer_allowed"
        })
      );
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
});
