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
  cookies: async () => ({ get: (name: string) => {
    if (name === "thunderstrux-context" && globalThis.__THUNDERSTRUX_TEST_CONTEXT__) return { value: globalThis.__THUNDERSTRUX_TEST_CONTEXT__ };
    if (name === "thunderstrux-guest" && globalThis.__THUNDERSTRUX_TEST_GUEST__) return { value: globalThis.__THUNDERSTRUX_TEST_GUEST__ };
    return undefined;
  } })
}));

beforeEach(async () => {
  globalThis.__THUNDERSTRUX_TEST_CONTEXT__ = undefined;
  globalThis.__THUNDERSTRUX_TEST_GUEST__ = undefined;
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
  // Loading the Prisma client reads the project's .env into any variable not
  // already set, so a developer's settings would otherwise leak into tests
  // (rate limiting on, MFA in enroll mode, a trusted proxy header). Pin every
  // behaviour switch to the clean baseline's value; tests change them with
  // their own vi.stubEnv.
  vi.stubEnv("MFA_ENFORCEMENT_MODE", "off");
  vi.stubEnv("MFA_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("LEGACY_ORGANISATION_ACCESS_MODE", "deny");
  vi.stubEnv("RESEND_API_KEY", "re_capture_only");
  for (const name of [
    "RATE_LIMIT_ENABLED", "RATE_LIMIT_TRUSTED_PROXY_HEADER", "RATE_LIMIT_KEY_PREFIX", "RATE_LIMIT_REDIS_URL",
    "AUTH_URL", "NEXTAUTH_URL", "TRUSTED_APP_ORIGINS", "ALERT_WEBHOOK_URL",
    // Worker tuning falls back to the code's defaults. Image storage is left as
    // the container sets it: the baseline gives its tests a disposable bucket.
    "WORKER_TIMEOUT_SECONDS", "EMAIL_OUTBOX_PROCESSING_TIMEOUT_SECONDS", "EMAIL_OUTBOX_MAX_ATTEMPTS", "EMAIL_OUTBOX_BATCH_SIZE"
  ]) vi.stubEnv(name, undefined);
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
