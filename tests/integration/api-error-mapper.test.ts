import { describe, expect, test, vi } from "vitest";
import {
  badRequest,
  forbidden,
  mapRouteError,
  routeErrorRule
} from "@/lib/api/errors";
import { parseJsonResponse } from "@/tests/helpers/http";

class InputError extends Error {}
class AccessError extends Error {}

describe("central API error mapper", () => {
  const request = new Request("http://localhost/api/example/private-id", {
    method: "POST"
  });

  test("maps known domain errors in declared order", async () => {
    const response = mapRouteError(new AccessError("Denied safely"), {
      operation: "example.mutate",
      request,
      rules: [
        routeErrorRule(InputError, (error) => badRequest(error.message)),
        routeErrorRule(AccessError, (error) => forbidden(error.message))
      ]
    });

    expect(response.status).toBe(403);
    await expect(parseJsonResponse(response)).resolves.toMatchObject({
      error: { code: "FORBIDDEN", message: "Denied safely" }
    });
  });

  test("redacts unknown failures behind a structured internal error", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = mapRouteError(new Error("database password leaked"), {
      operation: "example.mutate",
      request
    });

    expect(response.status).toBe(500);
    await expect(parseJsonResponse(response)).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        details: []
      }
    });

    const logEntry = JSON.parse(String(error.mock.calls[0]?.[0]));
    expect(logEntry).toMatchObject({
      level: "error",
      event: "api.request_failed",
      operation: "example.mutate",
      method: "POST"
    });
    expect(JSON.stringify(logEntry)).not.toContain("private-id");
    expect(JSON.stringify(logEntry)).not.toContain("database password leaked");
  });
});
