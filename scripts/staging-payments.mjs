import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { assertTestKey } from './e2e-guards.mjs';

export async function runStaging({ compose, capture, ready, runtimeFile, directory, runId, manifest, save, signal = new AbortController().signal, recovery = false }) {
  signal.throwIfAborted();
  const localKey = process.argv.includes('--use-local-test-key');
  const source = parseEnv(await readFile(resolve(localKey ? '.env' : '.env.staging.local'), 'utf8'));
  const values = localKey ? {
    STRIPE_TEST_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_TEST_CONNECTED_ACCOUNT: process.env.STRIPE_TEST_CONNECTED_ACCOUNT
  } : source;
  assertTestKey(values.STRIPE_TEST_SECRET_KEY);
  if (!/^acct_[A-Za-z0-9]+$/.test(values.STRIPE_TEST_CONNECTED_ACCOUNT ?? '')) throw new Error('A ready test connected account ID is required');
  const original = await readFile(runtimeFile, 'utf8');
  const runtime = original.replace(/^STRIPE_SECRET_KEY=.*$/m, `STRIPE_SECRET_KEY=${values.STRIPE_TEST_SECRET_KEY}`);
  await writeFile(runtimeFile, `${runtime}\nSTRIPE_API_KEY=${values.STRIPE_TEST_SECRET_KEY}\nSTRIPE_TEST_CONNECTED_ACCOUNT=${values.STRIPE_TEST_CONNECTED_ACCOUNT}\n`);
  let input;
  const run = (...args) => {
    if (args[0] !== 'cleanup') signal.throwIfAborted();
    return capture('run', '--rm', '--no-deps', 'runner', 'node', 'scripts/staging-driver.mjs', ...args);
  };
  try {
    if (recovery) {
      await compose('up', '-d', 'app');
      await ready();
    }
    if (!recovery) {
      // Capture, never stream listener startup: it contains the signing secret.
      await capture('--profile', 'staging', 'up', '-d', 'stripe');
      let signingSecret;
      for (let n = 0; n < 45; n++) {
        signal.throwIfAborted();
        const log = await capture('logs', '--no-color', 'stripe');
        signingSecret = log.match(/whsec_[A-Za-z0-9]+/)?.[0];
        if (signingSecret) break;
        await new Promise(done => setTimeout(done, 1000));
      }
      if (!signingSecret) throw new Error('Stripe listener did not become ready');
      signal.throwIfAborted();
      await writeFile(runtimeFile, (await readFile(runtimeFile, 'utf8')).replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, `STRIPE_WEBHOOK_SECRET=${signingSecret}`));
      await compose('up', '-d', 'app');
      await ready();
      await run('preflight');
      if (!process.stdin.isTTY) throw new Error('Run pnpm test:payments:staging in an interactive terminal for manual test-card acceptance');
      input = createInterface({input: process.stdin, output: process.stdout});
      for (const scenario of ['success', 'decline', 'cancel']) {
        signal.throwIfAborted();
        manifest.stripeResourcesPossible = true;
        await save();
        await run('prepare', scenario);
        // Read private state inside its owning container (root-owned 0600 on Linux).
        const handoff = await run('handoff', scenario);
        const privateState = JSON.parse(handoff.split('\n').find(line => line.startsWith('P216_PRIVATE:')).slice('P216_PRIVATE:'.length));
        console.log(`\n${scenario.toUpperCase()}: open this test Checkout URL privately:\n${privateState.url}`);
        console.log(scenario === 'success' ? 'Pay using Stripe test card 4242 4242 4242 4242, future expiry, any CVC.' : scenario === 'decline' ? 'Attempt payment using Stripe decline card 4000 0000 0000 0002; confirm the decline is displayed.' : 'Use the Checkout back/cancel link and confirm the app cancel page appears.');
        const answer = await input.question('Type confirmed after completing this step: ', {signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)])});
        signal.throwIfAborted();
        if (answer.trim() !== 'confirmed') throw new Error('Manual scenario was not confirmed');
        await run('verify', scenario);
        const evidence = JSON.parse(await readFile(resolve(directory, 'reports', `payment-${scenario}.json`), 'utf8'));
        const listenerLog = await capture('logs', '--no-color', 'stripe');
        const appLog = await capture('logs', '--no-color', 'app');
        if (!listenerLog.split('\n').some(line => line.includes(evidence.eventId) && line.includes('[200]')) || !appLog.includes(evidence.eventId)) {
          throw new Error('No correlated successful Stripe delivery and app receipt found');
        }
        manifest[scenario] = {...evidence, deliveryVerified: true, ...(scenario === 'cancel' ? {cancelNavigation: 'manually-attested'} : {})};
        await save();
        console.log(`${scenario}: verified`);
      }
    }
  } finally {
    input?.close();
    try {
      await run('cleanup');
      manifest.stripeCleanupComplete = true;
      await save();
    } catch {
      console.error(`Stripe cleanup remains pending. Keep manifest ${runId} and run pnpm test:e2e:cleanup -- ${runId} with .env.staging.local available.`);
      throw new Error('Stripe cleanup incomplete; run is not passed');
    }
  }
}
