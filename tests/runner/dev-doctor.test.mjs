import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidMfaEncryptionKey,
  migrationStatusIsCurrent,
  startupAppliesMigrations
} from "../../scripts/dev-doctor-guards.mjs";

test("development startup contract requires migration deployment before the dev server", () => {
  assert.equal(startupAppliesMigrations("sh -c pnpm prisma:migrate:deploy && pnpm dev"), true);
  assert.equal(startupAppliesMigrations("pnpm dev"), false);
  assert.equal(startupAppliesMigrations("pnpm prisma:migrate:deploy"), false);
  assert.equal(startupAppliesMigrations("sh -c pnpm dev && pnpm prisma:migrate:deploy"), false);
});

test("migration status accepts only Prisma's successful current-schema result", () => {
  assert.equal(migrationStatusIsCurrent(0, "Database schema is up to date!"), true);
  assert.equal(migrationStatusIsCurrent(1, "Following migration have not yet been applied"), false);
  assert.equal(migrationStatusIsCurrent(null, ""), false);
});

test("MFA encryption key check accepts only canonical base64 for 32 bytes", () => {
  assert.equal(isValidMfaEncryptionKey(Buffer.alloc(32, 7).toString("base64")), true);
  assert.equal(isValidMfaEncryptionKey(Buffer.alloc(31, 7).toString("base64")), false);
  assert.equal(isValidMfaEncryptionKey("not-base64"), false);
});
