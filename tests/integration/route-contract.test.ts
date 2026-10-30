import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

// T39: every API route keeps the shared error and request contracts, so a new
// route can't quietly log raw errors or skip the origin check. The few routes
// with their own contract are named here with the reason.

const apiRoot = join(process.cwd(), "app", "api");
const ownErrorContract: Record<string, string> = {
  "auth/[...nextauth]": "Auth.js owns its responses",
  health: "liveness answers without touching the error mapper",
  "health/ready": "readiness reports dependency status itself",
  "security/csrf": "issues a token and cannot fail on input",
  "payments/webhook": "Stripe expects its own status codes",
  "stripe/connect/webhook": "Stripe expects its own status codes",
  "stripe/accounts/webhook": "Stripe expects its own status codes"
};
const noOriginCheck: Record<string, string> = {
  "auth/[...nextauth]": "Auth.js checks its own CSRF token",
  "payments/webhook": "signed by Stripe",
  "stripe/connect/webhook": "signed by Stripe",
  "stripe/accounts/webhook": "signed by Stripe",
  "merchandise/quote": "a read: prices a basket and changes nothing"
};

function routes(directory = apiRoot): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return routes(path);
    return name === "route.ts" ? [path] : [];
  });
}
const nameOf = (path: string) => relative(apiRoot, path).replaceAll("\\", "/").replace(/\/route\.ts$/, "");
// The route file and the lib modules it imports, one level deep.
function sources(path: string) {
  const own = readFileSync(path, "utf8");
  const imported = [...own.matchAll(/from "@\/(lib\/[^"]+)"/g)].flatMap(([, module]) => {
    for (const candidate of [`${module}.ts`, `${module}/index.ts`]) {
      try {
        return [readFileSync(join(process.cwd(), candidate), "utf8")];
      } catch {
        // not this file name
      }
    }
    return [];
  });
  return { own, all: [own, ...imported].join("\n") };
}

describe("API route contract (T39)", () => {
  const files = routes();

  test("every route maps errors centrally, so failures log only their class", () => {
    const missing = files.filter((file) => !(nameOf(file) in ownErrorContract) && !/\bmapRouteError\(/.test(sources(file).all)).map(nameOf);
    expect(missing).toEqual([]);
    // Nothing logs a raw error object from a route.
    expect(files.filter((file) => /console\.error\([^)]*\berror\b/.test(sources(file).own)).map(nameOf)).toEqual([]);
  });

  test("every route that changes data checks the request's origin", () => {
    const mutating = files.filter((file) => /export (async function|const) (POST|PATCH|PUT|DELETE)\b/.test(sources(file).own));
    expect(mutating.length).toBeGreaterThan(50);
    const missing = mutating
      .filter((file) => !(nameOf(file) in noOriginCheck))
      .filter((file) => !/enforceTrustedMutationRequest|verifyGuestCsrf/.test(sources(file).all))
      .map(nameOf);
    expect(missing).toEqual([]);
  });

  test("the exceptions still exist, so the lists can't hide a removed route", () => {
    const names = new Set(files.map(nameOf));
    for (const name of [...Object.keys(ownErrorContract), ...Object.keys(noOriginCheck)]) expect(names.has(name)).toBe(true);
  });
});
