import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { encode } from "next-auth/jwt";
import { describe, expect, test, vi } from "vitest";
import { createMember } from "@/tests/helpers/test-data";
import { proxy } from "@/proxy";

describe("dependency security compatibility", () => {
  test("Next's native Sharp dependency still encodes and resizes images", async () => {
    const require = createRequire(import.meta.url);
    const nextRequire = createRequire(require.resolve("next/package.json"));
    const sharp = nextRequire("sharp");
    const source = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#ff0000" }
    }).png().toBuffer();
    const resized = await sharp(source).resize(4, 4).webp().toBuffer();
    expect(await sharp(resized).metadata()).toMatchObject({
      width: 4, height: 4, format: "webp"
    });
  });

  test("malformed bearer tokens redirect to login without throwing", async () => {
    for (const token of ["%", "%E0%A4%A", "not-a-jwt"]) {
      const response = await proxy(new NextRequest("http://localhost/dashboard", {
        headers: { authorization: `Bearer ${token}` }
      }));
      expect(response.status).toBe(307);
      expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    }
  });

  test("a valid encrypted session cookie still passes the proxy", async () => {
    const token = await encode({
      secret: process.env.AUTH_SECRET || "dev-secret",
      salt: "authjs.session-token",
      token: { userId: "compatibility-user", accountRole: "member" }
    });
    const response = await proxy(new NextRequest("http://localhost/dashboard", {
      headers: { cookie: `authjs.session-token=${token}` }
    }));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("real credentials login, session callbacks and sign-out remain compatible", async () => {
    vi.stubEnv("AUTH_TRUST_HOST", "true");
    const { handlers } = await vi.importActual<typeof import("@/auth")>("@/auth");
    const user = await createMember();
    const cookies = new Map<string, string>();
    const request = async (path: string, body?: Record<string, string>) => {
      const req = new NextRequest(`http://localhost/api/auth/${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join("; "),
          ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {})
        },
        body: body ? new URLSearchParams(body) : undefined
      });
      const response = await (body ? handlers.POST(req) : handlers.GET(req));
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(";", 1)[0];
        const separator = pair.indexOf("=");
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return response;
    };
    const { csrfToken } = await (await request("csrf")).json();
    const rejected = await request("callback/credentials", {
      csrfToken, email: user.email, password: "wrong", callbackUrl: "http://localhost/dashboard"
    });
    expect(rejected.headers.get("location")).toContain("error=CredentialsSignin");
    expect(await (await request("session")).json()).toBeNull();
    const accepted = await request("callback/credentials", {
      csrfToken, email: user.email, password: "password123", callbackUrl: "http://localhost/dashboard"
    });
    expect(accepted.status).toBe(302);
    expect(await (await request("session")).json()).toMatchObject({
      user: { id: user.id, email: user.email, accountRole: "member" }
    });
    await request("signout", { csrfToken, callbackUrl: "http://localhost" });
    expect(await (await request("session")).json()).toBeNull();
  });

  test("Prisma loads nested configuration with the scoped deepmerge security override", async () => {
    const require = createRequire(import.meta.url);
    const prismaRequire = createRequire(require.resolve("prisma/package.json"));
    const { loadConfigFromFile } = prismaRequire("@prisma/config");
    const directory = await mkdtemp(join(tmpdir(), "thunderstrux-prisma-config-"));
    try {
      await writeFile(join(directory, "prisma.config.cjs"),
        'module.exports = { schema: "prisma/schema.prisma", migrations: { path: "prisma/migrations", seed: "node prisma/seed.mjs" } };\n');
      const result = await loadConfigFromFile({ configRoot: directory });
      expect(result.error).toBeUndefined();
      expect(result.resolvedPath).toBe(join(directory, "prisma.config.cjs"));
      expect(result.config.schema).toBe(join(directory, "prisma/schema.prisma"));
      expect(result.config.migrations.seed).toBe("node prisma/seed.mjs");
      expect(result.config.migrations.path).toBe(join(directory, "prisma/migrations"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
