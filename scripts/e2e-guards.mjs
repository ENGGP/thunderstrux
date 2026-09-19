export function assertRunId(value) {
  if (!/^p216-[a-f0-9]{24}$/.test(value ?? '')) throw new Error('Invalid P2.16 run ID');
  return value;
}

export function assertTestDatabase(value) {
  const url = new URL(value);
  if (url.protocol !== 'postgresql:' || url.hostname !== 'db' ||
      url.pathname !== '/thunderstrux_e2e_test' || url.port !== '5432' ||
      url.username !== 'e2e' || url.search) {
    throw new Error('Refusing database outside the isolated P2.16 stack');
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
