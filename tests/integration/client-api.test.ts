import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi, type Mock } from "vitest";
import { ClientApiError, fetchJson, fetchWithCsrf, getClientErrorMessage, type ApiErrorPayload } from "@/lib/client/api";
import { useCheckout, waitForAttempt } from "@/lib/client/checkout";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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

  test("a token that can't be fetched is answered as it came, without sending the change", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    expect((await fetchWithCsrf("/api/events", { method: "POST", body: "{}" })).status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

  test("a caller's timeout also stops the token fetch, so the door never hangs on it", async () => {
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })));
    await expect(fetchWithCsrf("/api/tickets/ticket-1/check-in", { method: "POST", signal: AbortSignal.timeout(1) })).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

describe("client error messages", () => {
  const failure = (payload: ApiErrorPayload | null, message = "Request failed") => new ClientApiError(message, 400, payload);

  test("users see the server's field message first, then its error, a page's own wording, or the fallback for anything unsafe", () => {
    expect(getClientErrorMessage(failure({ error: { message: "Invalid request body", details: [{ path: ["reason"], message: "Give a reason" }] } }), "Fallback")).toBe("Give a reason");
    expect(getClientErrorMessage(failure({ error: { message: "Order not found" } }), "Fallback")).toBe("Order not found");
    expect(getClientErrorMessage(failure({ message: "Sold out" }), "Fallback")).toBe("Sold out");
    expect(getClientErrorMessage(failure({ error: { message: "Order not found" } }), "Fallback", { "Order not found": "That order has gone" })).toBe("That order has gone");
    for (const unsafe of ["Internal Server Error", " ", "x".repeat(201)]) {
      expect(getClientErrorMessage(failure({ error: { message: unsafe } }), "Fallback")).toBe("Fallback");
    }
    expect(getClientErrorMessage(new TypeError("fetch failed"), "Fallback")).toBe("Network error. Check your connection and try again.");
    expect(getClientErrorMessage(new Error("Choose a size"), "Fallback")).toBe("Choose a size");
    expect(getClientErrorMessage("boom", "Fallback")).toBe("Fallback");
  });

  test("a failed request carries the server's answer, or a plain message when the body isn't JSON; an empty answer reads as null", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Event not found" } }), { status: 404 }))
      .mockResolvedValueOnce(new Response("<html>Bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 })));
    await expect(fetchJson("/api/events/missing")).rejects.toMatchObject({ name: "ClientApiError", status: 404, message: "Event not found" });
    await expect(fetchJson("/api/events/missing")).rejects.toMatchObject({ status: 502, message: "Request failed. Please try again.", payload: null });
    await expect(fetchJson("/api/events/missing")).resolves.toBeNull();
  });
});

describe("checkout attempt polling", () => {
  test("polls every two seconds: ready opens Stripe, completed names the order, failed says nothing was charged, and half a minute of processing is slow", async () => {
    vi.useFakeTimers();
    const answers = (...bodies: object[]) => {
      const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "processing" })));
      for (const body of bodies) fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body)));
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    const fetchMock = answers({ status: "processing" }, { status: "ready", url: "https://checkout.stripe.com/c/pay/cs_test" });
    const ready = waitForAttempt("attempt-1");
    await vi.advanceTimersByTimeAsync(1999);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/payments/checkout/attempts/attempt-1", undefined);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await ready).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_test" });

    answers({ status: "completed", orderId: "order-1" });
    const completed = waitForAttempt("attempt-2");
    await vi.runAllTimersAsync();
    expect(await completed).toEqual({ orderId: "order-1" });

    answers({ status: "failed" });
    // DEF-075: the refusal's title already says it didn't start, and its body adds that nothing was charged.
    const failed = expect(waitForAttempt("attempt-3")).rejects.toThrow(new Error("We couldn't open the payment page. Please try again."));
    await vi.runAllTimersAsync();
    await failed;

    const processing = answers();
    const slow = waitForAttempt("attempt-4");
    await vi.runAllTimersAsync();
    expect(await slow).toBe("slow");
    expect(processing).toHaveBeenCalledTimes(15);
  });
});

describe("a Pay button's run", () => {
  // Rendered once on the server, where the key's ref works and state updates do nothing.
  function button(failedMessage?: string) {
    const outcome = { finished: vi.fn(), slow: vi.fn(), refused: vi.fn() };
    let start!: ReturnType<typeof useCheckout>["start"];
    renderToStaticMarkup(createElement(function Button() {
      ({ start } = useCheckout({ ...outcome, failedMessage }));
      return null;
    }));
    return { ...outcome, press: async (post: Mock) => {
      const run = start(post);
      await vi.runAllTimersAsync();
      await run;
    } };
  }
  const attemptAnswers = (status: string) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status }))));
  const processing = { attemptId: "attempt-1", status: "processing" };
  const keys = (post: Mock) => post.mock.calls.map(([key]) => key);

  test("a lost response keeps the key, so a retry finds the same checkout; a refusal ends the intent", async () => {
    vi.useFakeTimers();
    const pay = button();
    const post = vi.fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new ClientApiError("Sold out", 409, null))
      .mockResolvedValueOnce({ kind: "fulfilled", orderId: "order-1" });
    await pay.press(post);
    await pay.press(post);
    await pay.press(post);
    const [lost, retried, next] = keys(post);
    expect(retried).toBe(lost);
    expect(next).not.toBe(lost);
    expect(pay.refused).toHaveBeenCalledTimes(2);
    expect(pay.finished).toHaveBeenCalledWith("order-1");
  });

  test("a failed attempt after Stripe timed out ends the intent, so the next press doesn't replay it", async () => {
    vi.useFakeTimers();
    attemptAnswers("failed");
    const pay = button("Ticket wording.");
    const post = vi.fn().mockResolvedValue(processing);
    await pay.press(post);
    await pay.press(post);
    expect(keys(post)[1]).not.toBe(keys(post)[0]);
    expect(pay.refused.mock.calls[0][0]).toMatchObject({ message: "Ticket wording." });
  });

  test("a slow Stripe keeps the key: nothing is known yet, and trying again must find the same checkout", async () => {
    vi.useFakeTimers();
    attemptAnswers("processing");
    const pay = button();
    const post = vi.fn().mockResolvedValue(processing);
    await pay.press(post);
    await pay.press(post);
    expect(pay.slow).toHaveBeenCalledTimes(2);
    expect(pay.refused).not.toHaveBeenCalled();
    expect(keys(post)[1]).toBe(keys(post)[0]);
  });

  test("Stripe's page opens, and a free order finishes under either family's id", async () => {
    vi.useFakeTimers();
    const pay = button();
    vi.stubGlobal("window", { location: { href: "" } });
    await pay.press(vi.fn().mockResolvedValue({ kind: "stripe", url: "https://checkout.stripe.com/c/pay/cs_test" }));
    expect(window.location.href).toBe("https://checkout.stripe.com/c/pay/cs_test");
    await pay.press(vi.fn().mockResolvedValue({ kind: "fulfilled", commerceOrderId: "commerce-1" }));
    expect(pay.finished).toHaveBeenCalledWith("commerce-1");
  });
});
