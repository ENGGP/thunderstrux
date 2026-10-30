import { describe, expect, test } from "vitest";
import nextConfig, { contentSecurityPolicy } from "@/next.config";

describe("security headers (T39)", () => {
  test("every page gets the headers; API answers are private except public reads and health", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((rule) => rule.source === "/:path*")!;
    expect(all.headers.map((header) => header.key)).toEqual(expect.arrayContaining(["Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]));
    for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "form-action 'self'", "img-src 'self' data: blob:"]) expect(contentSecurityPolicy).toContain(directive);
    // The check-in scanner may use the camera, on this site only; the rest stay off.
    expect(all.headers.find((header) => header.key === "Permissions-Policy")?.value).toBe("camera=(self), microphone=(), geolocation=(), payment=(), usb=()");

    const api = rules.find((rule) => rule.source.startsWith("/api/"))!;
    expect(api.headers).toEqual([{ key: "Cache-Control", value: "private, no-store" }]);
    // The source is a path-to-regexp pattern; its named group holds this lookahead.
    const pattern = new RegExp(`^/api/${api.source.match(/\((\(\?!.*)\)$/)![1]}$`);
    for (const path of ["/api/me/account", "/api/orders/x", "/api/orgs/a/calendar"]) expect(pattern.test(path)).toBe(true);
    for (const path of ["/api/public/organisations/search", "/api/public/assets/a", "/api/health", "/api/health/ready"]) expect(pattern.test(path)).toBe(false);
  });

  test("the unused image optimizer stays off, so /_next/image answers 404", () => {
    expect(nextConfig.images?.unoptimized).toBe(true);
  });

  test("the dev server serves no public host and exposes no MCP endpoint (SEC-014)", () => {
    expect(nextConfig.allowedDevOrigins).toEqual(["127.0.0.1", "localhost"]);
    expect(nextConfig.experimental?.mcpServer).toBe(false);
  });
});
