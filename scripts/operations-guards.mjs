import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export function assertOperationsProject(value) {
  if (!/^p217-[a-z0-9][a-z0-9-]{2,40}$/.test(value ?? "")) {
    throw new Error("Operations project must match p217-[a-z0-9-]");
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
