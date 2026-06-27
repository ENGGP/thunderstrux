import { describe, expect, test, vi } from "vitest";
import { GET as health } from "@/app/api/health/route";
import { emitOperationalAlert } from "@/lib/ops/alerts";
import { emitMetric } from "@/lib/ops/metrics";
import { logError, logInfo, redactLogContext } from "@/lib/ops/logger";
import { parseJsonResponse } from "@/tests/helpers/http";

function parseConsoleJson(spy: ReturnType<typeof vi.spyOn>, index = 0) {
  const message = spy.mock.calls[index]?.[0];

  if (typeof message !== "string") {
    throw new Error("Expected structured log string");
  }

  return JSON.parse(message) as Record<string, unknown>;
}

describe("ops logging foundation", () => {
  test("redacts sensitive nested context and preserves safe fields", () => {
    const error = new Error("provider unavailable");
    const redacted = redactLogContext({
      orderId: "order_123",
      headers: {
        authorization: "Bearer secret",
        cookie: "session=value"
      },
      password: "secret-password",
      stripePayload: { id: "evt_123" },
      rawBody: "{full payload}",
      emailHtml: "<html>ticket</html>",
      providerSecret: "secret",
      error
    });

    expect(redacted).toMatchObject({
      orderId: "order_123",
      headers: {
        authorization: "[REDACTED]",
        cookie: "[REDACTED]"
      },
      password: "[REDACTED]",
      stripePayload: "[REDACTED]",
      rawBody: "[REDACTED]",
      emailHtml: "[REDACTED]",
      providerSecret: "[REDACTED]",
      error: {
        name: "Error",
        message: "provider unavailable"
      }
    });
  });

  test("structured logs are single JSON console records", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    logInfo("test.event", {
      orderId: "order_123",
      token: "secret-token"
    });

    const entry = parseConsoleJson(info);
    expect(entry).toMatchObject({
      level: "info",
      event: "test.event",
      service: "thunderstrux",
      orderId: "order_123",
      token: "[REDACTED]"
    });
    expect(entry.timestamp).toEqual(expect.any(String));
  });

  test("operational alerts preserve event payload compatibility through structured logs", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    emitOperationalAlert("paid_but_unfulfilled_compensation_required", {
      orderId: "order_123",
      stripeSessionId: "cs_123",
      eventId: "event_123",
      reason: "inventory_unavailable_after_payment",
      source: "webhook"
    });

    const entry = parseConsoleJson(error);
    expect(entry).toMatchObject({
      level: "error",
      event: "paid_but_unfulfilled_compensation_required",
      service: "thunderstrux",
      orderId: "order_123",
      stripeSessionId: "cs_123",
      eventId: "event_123",
      reason: "inventory_unavailable_after_payment",
      source: "webhook"
    });
  });

  test("metrics emit console-only structured metric records", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    emitMetric("checkout_session_create_failures_total", 1, {
      route: "checkout"
    });

    const entry = parseConsoleJson(info);
    expect(entry).toMatchObject({
      level: "info",
      event: "ops.metric",
      metricName: "checkout_session_create_failures_total",
      metricValue: 1,
      tags: {
        route: "checkout"
      }
    });
  });

  test("health endpoint returns minimal public-safe status", async () => {
    const response = await health();

    expect(response.status).toBe(200);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      status: "ok",
      service: "thunderstrux"
    });
  });
});
