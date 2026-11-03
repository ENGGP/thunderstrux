import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function assertOperationsProject(value) {
  if (!/^ops-[a-z0-9][a-z0-9-]{2,40}$/.test(value ?? "")) {
    throw new Error("Operations project must match ops-[a-z0-9-]");
  }

  return value;
}

export function assertRestoreDatabase(value) {
  if (!/^[a-z][a-z0-9_]{2,54}_restore_test$/.test(value ?? "")) {
    throw new Error("Restore database must be a simple name ending in _restore_test");
  }

  return value;
}

export function assertHttpLoopbackUrl(value) {
  const url = new URL(value);

  if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname)) {
    throw new Error("Local rehearsal URL must use HTTP on localhost");
  }

  return url.toString().replace(/\/$/, "");
}

export function migrationDigest(entries) {
  const hash = createHash("sha256");

  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update(entry.name);
    hash.update("\0");
    hash.update(entry.contents);
    hash.update("\0");
  }

  return hash.digest("hex");
}

export async function assertRollbackCompatibility(path, expected) {
  const declaration = JSON.parse(await readFile(path, "utf8"));

  for (const field of ["candidateImageId", "previousImageId", "migrationDigest"]) {
    if (declaration[field] !== expected[field]) {
      throw new Error(`Rollback compatibility ${field} does not match this deployment`);
    }
  }

  if (declaration.reviewed !== true) {
    throw new Error("Rollback compatibility declaration is not reviewed");
  }

  return declaration;
}

export function databaseUrlForRestore(source, databaseName) {
  assertRestoreDatabase(databaseName);
  const url = new URL(source);

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must use PostgreSQL");
  }

  if (url.pathname.replace(/^\//, "") === databaseName) {
    throw new Error("Restore target must differ from the source database");
  }

  url.pathname = `/${databaseName}`;
  return url.toString();
}

// T54: the admin portal's one-off container (Q6): published on loopback only,
// with the portal switched on and its own sign-in origin. NEXT_PUBLIC_APP_URL
// stays the public site, so every notice links there, never to the portal.
export const ADMIN_PORTAL_PORT = 3091;
export function adminPortalRunArgs(project) {
  const origin = `http://localhost:${ADMIN_PORTAL_PORT}`;
  return [
    "run", "-d", "--rm", "--no-deps", "--name", `${assertOperationsProject(project)}-admin`,
    "-p", `127.0.0.1:${ADMIN_PORTAL_PORT}:3000`,
    "-e", "PORT=3000", "-e", "ADMIN_PORTAL_ENABLED=true",
    "-e", `AUTH_URL=${origin}`, "-e", `NEXTAUTH_URL=${origin}`, "-e", `TRUSTED_APP_ORIGINS=${origin}`,
    "app"
  ];
}
