import { afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/tests/helpers/db-reset";

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => globalThis.__THUNDERSTRUX_TEST_SESSION__ ?? null),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn()
}));

beforeEach(async () => {
  globalThis.__THUNDERSTRUX_TEST_SESSION__ = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      throw new Error(`Real network calls are blocked in integration tests: ${String(input)}`);
    })
  );
  await resetTestDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
