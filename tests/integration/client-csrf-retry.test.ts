import { afterEach, describe, expect, test, vi } from "vitest";
import { fetchWithCsrf } from "@/lib/client/api";

afterEach(() => vi.unstubAllGlobals());

describe("client CSRF refresh", () => {
  test("retries once after an Auth.js cookie rotation invalidates the fetched token", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "before-refresh" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: "FORBIDDEN", message: "Invalid CSRF token" } }), { status: 403 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "after-refresh" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await fetchWithCsrf("/api/events", { method: "POST", body: "{}" });
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get("x-thunderstrux-csrf-token"))
      .toBe("before-refresh");
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get("x-thunderstrux-csrf-token"))
      .toBe("after-refresh");
  });

  test("does not replay an unrelated forbidden mutation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "current" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: {
        code: "FORBIDDEN", message: "Insufficient permissions" } }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithCsrf("/api/events", { method: "POST", body: "{}" })).status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
