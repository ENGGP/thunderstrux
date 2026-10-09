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

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => name === "thunderstrux-context" && globalThis.__THUNDERSTRUX_TEST_CONTEXT__ ? { value: globalThis.__THUNDERSTRUX_TEST_CONTEXT__ } : undefined })
}));

beforeEach(async () => {
  globalThis.__THUNDERSTRUX_TEST_CONTEXT__ = undefined;
  globalThis.__THUNDERSTRUX_TEST_SESSION__ = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  // No developer .env or real provider credentials are needed in CI.
  vi.stubEnv("NOTIFICATION_ENCRYPTION_KEY", Buffer.alloc(32, 8).toString("base64"));
  vi.stubEnv("EMAIL_FROM", "synthetic@example.com");
  vi.stubEnv("THUNDERSTRUX_MAIL_CAPTURE_URL", "");
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
