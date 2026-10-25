import { spawnSync } from "node:child_process";
import { compare } from "bcryptjs";
import { describe, expect, test } from "vitest";
import { prisma } from "@/lib/db";

const seed = (env: Record<string, string | undefined>) =>
  spawnSync(process.execPath, ["prisma/seed.mjs"], { env: { ...process.env, SEED_DEMO_PASSWORD: undefined, ...env }, encoding: "utf8", timeout: 120_000 });

describe("seed guard (SEC-015)", () => {
  test("a public origin without SEED_DEMO_PASSWORD writes nothing", async () => {
    for (const env of [{ AUTH_URL: "https://preview.example.test" }, { NEXT_PUBLIC_APP_URL: "https://preview.example.test" }, { AUTH_URL: "https://preview.example.test", SEED_DEMO_PASSWORD: "too-short" }]) {
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
});
