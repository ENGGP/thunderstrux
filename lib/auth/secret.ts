const unsafeAuthSecrets = new Set([
  "",
  "dev-secret",
  "replace-with-a-non-empty-secret",
  // docker/Dockerfile's build-only value must never sign sessions at runtime.
  "build-time-only-auth-secret-change-at-runtime"
]);
const minimumProductionLength = 32;

// One resolver for auth.ts (signs sessions) and proxy.ts (reads them): two
// different development fallbacks would make every proxied request look signed out.
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const isBuild = env.npm_lifecycle_event === "build";
  const production = env.NODE_ENV === "production" && !isBuild;

  if (!unsafeAuthSecrets.has(secret) && !(production && secret.length < minimumProductionLength)) {
    return secret;
  }

  // Only tests and builds may use the fallback: its value is in source, and a
  // development app can be reachable from outside (SEC-016).
  if (env.NODE_ENV !== "test" && !isBuild) {
    throw new Error(
      production
        ? `AUTH_SECRET must be a random value of at least ${minimumProductionLength} characters in production.`
        : "AUTH_SECRET must be set to a random value. Generate one with: openssl rand -base64 32"
    );
  }

  return "dev-only-auth-secret";
}

export const authSecret = resolveAuthSecret();
