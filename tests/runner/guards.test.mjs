import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRunId, assertTestDatabase, assertTestKey, assertOwnedManifest, assertStripeIdentity, stagingScenarios } from '../../scripts/e2e-guards.mjs';

test('cleanup accepts only generated project identifiers', () => {
  for (const value of ['main', '../thunderstrux', 'thunderstrux', 'p216-', '']) {
    assert.throws(() => assertRunId(value));
  }
  const id = `p216-${'a'.repeat(24)}`;
  assert.equal(assertRunId(id), id);
  assert.throws(() => assertOwnedManifest({version: 1, runId: id, project: 'thunderstrux'}, id));
});
test('database guard refuses host, shared, and non-test targets', () => {
  const safe = 'postgresql://e2e:password@db:5432/thunderstrux_e2e_test';
  assertTestDatabase(safe);
  for (const value of [safe.replace('@db', '@localhost'), safe.replace('_e2e_test', ''), safe + '?schema=public']) {
    assert.throws(() => assertTestDatabase(value));
  }
});
test('payment harness rejects live and missing keys', () => {
  assertTestKey('sk_test_example');
  for (const value of ['', 'sk_live_example', 'rk_live_example', undefined]) assert.throws(() => assertTestKey(value));
});
test('recovery refuses a different platform, connected account or run', () => {
  const saved = {platformId: 'acct_platform', connectedAccountId: 'acct_connected', runId: 'original'};
  assertStripeIdentity(saved, {...saved});
  for (const key of Object.keys(saved)) assert.throws(() => assertStripeIdentity(saved, {...saved, [key]: 'different'}));
});

test('focused staging selection is explicit and rejects unknown or duplicate scenarios', () => {
  assert.deepEqual(stagingScenarios([]), ['success', 'decline', 'cancel']);
  for (const scenario of ['success', 'decline', 'cancel']) assert.deepEqual(stagingScenarios([`--scenario=${scenario}`]), [scenario]);
  for (const args of [['--scenario'], ['--scenario='], ['--scenario=unknown'], ['--scenario=cancel', '--scenario=success']]) {
    assert.throws(() => stagingScenarios(args));
  }
});
