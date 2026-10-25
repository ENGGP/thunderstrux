import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { proxy } from "@/proxy";
import { authSecret } from "@/lib/auth/secret";
import { appCookieSecure } from "@/lib/auth/public-origin";
import { guestCookieOptions } from "@/lib/guest/guest-access";
import { prisma } from "@/lib/db";
import { createMember } from "@/tests/helpers/test-data";

describe("proxy session cookies", () => {
  test.each([
    { authUrl: "https://thunderstrux.mistayu.com", legacyUrl: undefined, requestUrl: "http://localhost:3000", secure: true },
    { authUrl: "http://localhost:3080", legacyUrl: undefined, requestUrl: "http://localhost:3080", secure: false },
    { authUrl: undefined, legacyUrl: "https://thunderstrux.mistayu.com", requestUrl: "http://localhost:3000", secure: true },
    { authUrl: undefined, legacyUrl: undefined, requestUrl: "https://example.com", secure: true },
    { authUrl: undefined, legacyUrl: undefined, requestUrl: "http://localhost:3080", secure: false }
  ])("reads the issued cookie with AUTH_URL=$authUrl, NEXTAUTH_URL=$legacyUrl and request=$requestUrl", async ({ authUrl, legacyUrl, requestUrl, secure }) => {
    vi.stubEnv("AUTH_URL", authUrl);
    vi.stubEnv("NEXTAUTH_URL", legacyUrl);
    const user = await createMember();
    const cookieName = `${secure ? "__Secure-" : ""}authjs.session-token`;
    const token = await encode({ secret: authSecret, salt: cookieName, token: { userId: user.id, authVersion: user.authVersion } });

    for (const path of ["/dashboard", "/dashboard/organisations", "/account/settings", "/events/public-event"]) {
      const response = await proxy(new NextRequest(`${requestUrl}${path}`, { headers: { cookie: `${cookieName}=${token}` } }));
      expect(response.status, path).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }

    const anonymous = await proxy(new NextRequest(`${requestUrl}/dashboard?tab=tickets`));
    expect(anonymous.status).toBe(307);
    expect(new URL(anonymous.headers.get("location")!).searchParams.get("callbackUrl")).toBe("/dashboard?tab=tickets");
  });

  test("reads chunked secure cookies and still rejects tampered, stale, versionless and disabled sessions", async () => {
    vi.stubEnv("AUTH_URL", "https://thunderstrux.mistayu.com");
    const user = await createMember();
    const cookieName = "__Secure-authjs.session-token";
    const issue = (claims: Record<string, unknown>) => encode({ secret: authSecret, salt: cookieName, token: claims });
    const request = (cookie: string) => new NextRequest("http://localhost:3000/account/settings", { headers: { cookie } });
    const token = await issue({ userId: user.id, authVersion: user.authVersion });
    const split = Math.floor(token.length / 2);
    expect((await proxy(request(`${cookieName}.0=${token.slice(0, split)}; ${cookieName}.1=${token.slice(split)}`))).status).toBe(200);

    for (const invalid of ["tampered", await issue({ userId: user.id }), await issue({ userId: user.id, authVersion: user.authVersion + 1 })]) {
      const response = await proxy(request(`${cookieName}=${invalid}`));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    }
    await prisma.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
    expect((await proxy(request(`${cookieName}=${token}`))).status).toBe(307);
  });

  test.each([
    { nodeEnv: "development", authUrl: "https://preview.example.test", secure: true },
    { nodeEnv: "development", authUrl: "http://127.0.0.1:3080", secure: false },
    { nodeEnv: "production", authUrl: "http://localhost:3100", secure: true }
  ])("guest and context cookies are Secure when NODE_ENV=$nodeEnv and AUTH_URL=$authUrl is https or production (SEC-017)", ({ nodeEnv, authUrl, secure }) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    vi.stubEnv("AUTH_URL", authUrl);
    expect(appCookieSecure()).toBe(secure);
    expect(guestCookieOptions(new Date()).secure).toBe(secure);
  });
});
