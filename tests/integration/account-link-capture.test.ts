import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";
import { accountLinkCaptureScript } from "@/lib/auth/account-link-capture";
test("parser capture retains a link before router hydration rewrites the fragment", () => {
  const token = "a".repeat(43);
  const listeners = new Map<string, (event: { newURL: string }) => void>();
  const window = { location: { pathname: "/reset-password", href: `https://example.com/reset-password#token=${token}` }, __thunderstruxAccountLink: null as null | { token: string; path: string; capturedAt: number },
    addEventListener: (name: string, listener: (event: { newURL: string }) => void) => listeners.set(name, listener) };
  const captured = () => window.__thunderstruxAccountLink;
  runInNewContext(accountLinkCaptureScript, { window, URL, URLSearchParams, Date });
  expect(captured()?.token).toBe(token);
  window.location.href = "https://example.com/reset-password";
  window.__thunderstruxAccountLink = null;
  // replaceState can clear the current URL before the hashchange event runs.
  listeners.get("hashchange")!({ newURL: `https://example.com/reset-password#token=${token}` });
  expect(captured()?.token).toBe(token);
  listeners.get("hashchange")!({ newURL: "https://example.com/reset-password" });
  expect(captured()?.token).toBe(token);
  listeners.get("hashchange")!({ newURL: `https://example.com/change-email#token=${"b".repeat(43)}` });
  expect(captured()?.token).toBe(token);
});
