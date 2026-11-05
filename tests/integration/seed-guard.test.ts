import { spawnSync } from "node:child_process";
import { compare } from "bcryptjs";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";

const seed = (env: Record<string, string | undefined>) =>
  spawnSync(process.execPath, ["prisma/seed.mjs"], { env: { ...process.env, SEED_DEMO_PASSWORD: undefined, ...env }, encoding: "utf8", timeout: 120_000 });

describe("seed guard (SEC-015, SEC-051)", () => {
  test("a public origin, or production with no origin, without SEED_DEMO_PASSWORD writes nothing; a short one never seeds", async () => {
    // Empty, not unset: Prisma would load the dev .env into an unset one, and a migration container has none.
    const noOrigin = { AUTH_URL: "", NEXTAUTH_URL: "", NEXT_PUBLIC_APP_URL: "" };
    for (const env of [
      { AUTH_URL: "https://preview.example.test" }, { NEXT_PUBLIC_APP_URL: "https://preview.example.test" }, { AUTH_URL: "https://preview.example.test", SEED_DEMO_PASSWORD: "too-short" },
      { ...noOrigin, NODE_ENV: "production" }, { NEXT_PUBLIC_APP_URL: "http://localhost:3000", SEED_DEMO_PASSWORD: "too-short" },
      // SEC-073: a loopback origin under production is still a deployed app.
      { AUTH_URL: "http://localhost:3080", NEXTAUTH_URL: "http://localhost:3080", NEXT_PUBLIC_APP_URL: "http://localhost:3080", NODE_ENV: "production" }
    ]) {
      const result = seed(env);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("SEED_DEMO_PASSWORD");
    }
    expect(await prisma.user.count()).toBe(0);
  });

  test("a public origin with SEED_DEMO_PASSWORD seeds with that password, never password123", async () => {
    const result = seed({ AUTH_URL: "https://preview.example.test", SEED_DEMO_PASSWORD: "demo-preview-password-1" });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).not.toContain("password123");
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "engineering.org@example.com" } });
    expect(await compare("demo-preview-password-1", owner.password)).toBe(true);
    expect(await compare("password123", owner.password)).toBe(false);
  }, 180_000);

  test("a supplied SEED_DEMO_PASSWORD is used even with no origin, as a migration container runs (SEC-051)", async () => {
    const result = seed({ AUTH_URL: "", NEXTAUTH_URL: "", NEXT_PUBLIC_APP_URL: "", NODE_ENV: "production", SEED_DEMO_PASSWORD: "demo-migration-password-1" });
    expect(result.status, result.stderr).toBe(0);
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: "engineering.org@example.com" } });
    expect(await compare("demo-migration-password-1", owner.password)).toBe(true);
    expect(await compare("password123", owner.password)).toBe(false);
  }, 180_000);
});
