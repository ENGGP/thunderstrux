import { afterAll, beforeEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { resetTestDatabase } from "@/tests/helpers/db-reset";

vi.mock("@/auth", () => ({
  authSecret: "integration-auth-secret",
  auth: vi.fn(async () => globalThis.__THUNDERSTRUX_TEST_SESSION__ ?? null),
  handlers: {},
  signIn: vi.fn(),
  signOut: vi.fn()
}));

beforeEach(async () => {
  globalThis.__THUNDERSTRUX_TEST_SESSION__ = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // No developer .env or real provider credentials are needed in CI.
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_integration_placeholder");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_integration_placeholder");
  vi.stubEnv("STRIPE_CONNECT_WEBHOOK_SECRET", "whsec_connect_integration_placeholder");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
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
