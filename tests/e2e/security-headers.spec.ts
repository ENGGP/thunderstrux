import { test, expect } from "./fixtures";

// T39: pages carry the security headers, private API answers are never
// cached, and public reads keep their own caching.
test("pages send the security headers and API answers keep the right caching", async ({ page }) => {
  const home = await page.goto("/");
  const headers = home!.headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["content-security-policy"]).toContain("script-src 'self' 'unsafe-inline'");
  expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");

  const privateAnswer = await page.request.get("/api/me/account");
  expect(privateAnswer.status()).toBe(401);
  expect(privateAnswer.headers()["cache-control"]).toBe("private, no-store");
  const publicAnswer = await page.request.get("/api/public/organisations/search?q=a");
  expect(publicAnswer.headers()["cache-control"]).toBe("public, max-age=60");
});
