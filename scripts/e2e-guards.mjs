// A run's ID names what it ran (baseline checks, the browser campaign or
// staging payments); it is also its Compose project and evidence folder.
export const runIdPattern = /^(baseline|browser|staging)-[a-f0-9]{24}$/;

export function assertRunId(value) {
  if (!runIdPattern.test(value ?? '')) throw new Error('Invalid E2E run ID');
  return value;
}

export function assertTestDatabase(value) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== 'db' ||
      url.pathname !== '/thunderstrux_e2e_test' || url.port !== '5432' ||
      url.username !== 'e2e' || url.search) {
    throw new Error('Refusing database outside the isolated E2E stack');
  }
}

export function assertTestKey(value) {
  if (!/^sk_test_[A-Za-z0-9]+$/.test(value ?? '')) throw new Error('A Stripe sk_test_ key is required');
}

export function assertOwnedManifest(manifest, runId) {
  assertRunId(runId);
  if (manifest.version !== 1 || manifest.runId !== runId || manifest.project !== runId) {
    throw new Error('Manifest ownership mismatch');
  }
}

export function assertStripeIdentity(saved, current) {
  if (saved.platformId !== current.platformId || saved.connectedAccountId !== current.connectedAccountId || saved.runId !== current.runId) {
    throw new Error('Recovery Stripe account identity mismatch');
  }
}

// T45: every staging scenario, in run order. `free` needs no card; the rest
// stop for someone to act on a real Stripe Checkout page.
export const allStagingScenarios = ['free', 'success', 'decline', 'cancel', 'member', 'guest', 'membership', 'merchandise', 'compensation'];
export const cardScenarios = allStagingScenarios.filter(name => name !== 'free');

export function stagingScenarios(args) {
  const selected = args.filter(value => value.startsWith('--scenario'));
  if (selected.length === 0) return allStagingScenarios;
  if (selected.length !== 1 || !selected[0].startsWith('--scenario=') || !allStagingScenarios.includes(selected[0].slice('--scenario='.length))) {
    throw new Error(`Use exactly one --scenario= of ${allStagingScenarios.join(', ')}`);
  }
  return [selected[0].slice('--scenario='.length)];
}
