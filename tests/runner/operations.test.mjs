import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ADMIN_PORTAL_PORT,
  adminPortalRunArgs,
  assertHttpLoopbackUrl,
  assertOperationsProject,
  assertRestoreDatabase,
  assertRollbackCompatibility,
  databaseUrlForRestore,
  migrationDigest
} from "../../scripts/operations-guards.mjs";

test("a deploy refuses an env file with an empty EMAIL_FROM, before touching anything", async () => {
  const envFile = join(await mkdtemp(join(tmpdir(), "operations-env-")), ".env");
  await writeFile(envFile, "EMAIL_FROM=\n");
  const deploy = spawnSync(process.execPath, ["scripts/operations.mjs", "deploy", "--project", "ops-email-from", "--env-file", envFile, "--url", "http://127.0.0.1:1"], { encoding: "utf8" });
  assert.notEqual(deploy.status, 0);
  assert.match(deploy.stderr, /Set EMAIL_FROM in the env file/);
});

test("operations identifiers are narrowly scoped", () => {
  assert.equal(assertOperationsProject("ops-local-rehearsal"), "ops-local-rehearsal");
  assert.throws(() => assertOperationsProject("thunderstrux"));
  assert.equal(assertRestoreDatabase("ops_restore_test"), "ops_restore_test");
  assert.throws(() => assertRestoreDatabase("thunderstrux"));
});

test("the admin portal container publishes on loopback only and switches the portal on there alone", () => {
  const args = adminPortalRunArgs("ops-preview");
  assert.equal(args[args.indexOf("-p") + 1], `127.0.0.1:${ADMIN_PORTAL_PORT}:3000`);
  assert.equal(args.filter((arg) => arg === "-p").length, 1);
  assert.ok(args.includes("ADMIN_PORTAL_ENABLED=true"));
  assert.ok(args.includes(`AUTH_URL=http://localhost:${ADMIN_PORTAL_PORT}`));
  assert.ok(!args.some((arg) => arg.startsWith("NEXT_PUBLIC_APP_URL=")), "notices keep linking to the public site");
  assert.ok(args.includes("--rm") && args.at(-1) === "app");
  assert.throws(() => adminPortalRunArgs("thunderstrux"));
});

test("rehearsal URLs are loopback-only", () => {
  assert.equal(assertHttpLoopbackUrl("http://127.0.0.1:3200"), "http://127.0.0.1:3200");
  assert.throws(() => assertHttpLoopbackUrl("https://example.com"));
});

test("restore URL preserves credentials and replaces only the database", () => {
  const result = databaseUrlForRestore(
    "postgresql://app:secret@db:5432/source?schema=public",
    "verified_restore_test"
  );
  assert.equal(result, "postgresql://app:secret@db:5432/verified_restore_test?schema=public");
  assert.throws(() => databaseUrlForRestore(
    "postgresql://app:secret@db:5432/verified_restore_test?schema=public",
    "verified_restore_test"
  ));
});

test("migration digest is stable and content-sensitive", () => {
  const first = migrationDigest([{ name: "b", contents: "2" }, { name: "a", contents: "1" }]);
  assert.equal(first, migrationDigest([{ name: "a", contents: "1" }, { name: "b", contents: "2" }]));
  assert.notEqual(first, migrationDigest([{ name: "a", contents: "changed" }]));
});

test("rollback declaration must be reviewed and match the actual release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ops-compat-"));
  const path = join(directory, "compatibility.json");
  const expected = {
    candidateImageId: "sha256:candidate",
    previousImageId: "sha256:previous",
    migrationDigest: "abc"
  };
  await writeFile(path, JSON.stringify({ ...expected, reviewed: true }));
  await assert.doesNotReject(assertRollbackCompatibility(path, expected));
  await writeFile(path, JSON.stringify({ ...expected, reviewed: false }));
  await assert.rejects(assertRollbackCompatibility(path, expected));
});
