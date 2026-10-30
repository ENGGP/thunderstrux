import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertOnlyStagingRun, assertRunId, assertTestDatabase, assertTestKey, assertOwnedManifest, assertStripeIdentity, stagingScenarios } from '../../scripts/e2e-guards.mjs';

test('cleanup accepts only generated project identifiers', () => {
  for (const value of ['main', '../thunderstrux', 'thunderstrux', 'browser-', 'run-aaaaaaaaaaaaaaaaaaaaaaaa', '']) {
    assert.throws(() => assertRunId(value));
  }
  const id = `browser-${'a'.repeat(24)}`;
  assert.equal(assertRunId(id), id);
  assert.throws(() => assertOwnedManifest({version: 1, runId: id, project: 'thunderstrux'}, id));
});
test('each run has its own images and a host port Docker picks, so two runs cannot meet', () => {
  const compose = readFileSync('docker-compose.e2e.yml', 'utf8');
  assert.doesNotMatch(compose, /thunderstrux-e2e-\w+:local/);
  assert.equal(compose.match(/thunderstrux-e2e-\w+:\$\{E2E_RUN_ID:\?/g).length, 4);
  assert.match(compose, /- '127\.0\.0\.1::3100'/);
});
test('a staging run refuses to share Stripe test mode with another; other runs may run beside it', () => {
  const run = `staging-${'a'.repeat(24)}`;
  const other = `staging-${'b'.repeat(24)}`;
  assertOnlyStagingRun(['', 'thunderstrux', `baseline-${'c'.repeat(24)}`, run], run);
  assert.throws(() => assertOnlyStagingRun([run, other], run), new RegExp(other));
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
  assert.deepEqual(stagingScenarios([]), ['free', 'success', 'decline', 'cancel', 'member', 'guest', 'membership', 'merchandise', 'compensation', 'commerce-dispute', 'commerce-outside-refund', 'commerce-compensation']);
  for (const scenario of stagingScenarios([])) assert.deepEqual(stagingScenarios([`--scenario=${scenario}`]), [scenario]);
  for (const args of [['--scenario'], ['--scenario='], ['--scenario=unknown'], ['--scenario=cancel', '--scenario=success']]) {
    assert.throws(() => stagingScenarios(args));
  }
});

test('staging checks delivered events against the same Stripe API version the app pins', async () => {
  const { stripeApiVersion } = await import('../../scripts/e2e-guards.mjs');
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../../lib/stripe/version.ts', import.meta.url), 'utf8');
  assert.match(app, new RegExp(`export const stripeApiVersion = "${stripeApiVersion.replace('.', '\.')}";`));
});
