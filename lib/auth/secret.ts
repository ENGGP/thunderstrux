const unsafeAuthSecrets = new Set([
  "",
  "dev-secret",
  "replace-with-a-non-empty-secret"
]);

// One resolver for auth.ts (signs sessions) and proxy.ts (reads them): two
// different development fallbacks would make every proxied request look signed out.
export function resolveAuthSecret(env: NodeJS.ProcessEnv = process.env) {
  const secret = env.AUTH_SECRET?.trim() ?? "";
  const isBuild = env.npm_lifecycle_event === "build";

  if (!unsafeAuthSecrets.has(secret)) {
    return secret;
  }

  if (env.NODE_ENV === "production" && !isBuild) {
    throw new Error(
      "AUTH_SECRET must be set to a strong non-placeholder value in production."
    );
  }

  if (!isBuild) {
    console.warn(
      "AUTH_SECRET is using a development fallback. Set AUTH_SECRET in .env for persistent local sessions."
    );
  }

  return "dev-only-auth-secret";
}

export const authSecret = resolveAuthSecret();
