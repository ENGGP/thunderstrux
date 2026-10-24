import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { assertTestKey, cardScenarios, stagingScenarios, stripeApiVersion } from './e2e-guards.mjs';

const card = 'Pay using Stripe test card 4242 4242 4242 4242, any future expiry, any CVC.';
// What the person at the terminal does on each scenario's Checkout page.
const instructions = {
  success: `${card} The app then refunds it in full.`,
  decline: 'Attempt payment using Stripe decline card 4000 0000 0000 0002; confirm the decline is displayed.',
  cancel: 'Use the Checkout back/cancel link and confirm the app cancel page appears.',
  member: `${card} This is a member-price ticket ($9.00, not $15.00).`,
  guest: `${card} This is a verified guest's ticket.`,
  membership: `${card} This is a paid membership.`,
  merchandise: `${card} This is a two-line merchandise order; the app then refunds it in full.`,
  compensation: `${card} The order has already expired locally, so the app refunds it automatically.`,
  'commerce-dispute': 'Pay using Stripe dispute test card 4000 0000 0000 0259, any future expiry, any CVC. Stripe opens a dispute; the run then loses it.',
  'commerce-outside-refund': `${card} The run then refunds part of it from outside Thunderstrux, and the app refunds the rest.`,
  'commerce-compensation': `${card} This merchandise order has already expired locally, so the app refunds it automatically.`
};

export async function runStaging({ compose, capture, ready, runtimeFile, directory, runId, manifest, save, signal = new AbortController().signal, recovery = false }) {
  signal.throwIfAborted();
  const scenarios = stagingScenarios(process.argv);
  const localKey = process.argv.includes('--use-local-test-key');
  const source = parseEnv(await readFile(resolve(localKey ? '.env' : '.env.staging.local'), 'utf8'));
  const values = localKey ? {
    STRIPE_TEST_SECRET_KEY: source.STRIPE_SECRET_KEY,
    STRIPE_TEST_CONNECTED_ACCOUNT: process.env.STRIPE_TEST_CONNECTED_ACCOUNT
  } : source;
  assertTestKey(values.STRIPE_TEST_SECRET_KEY);
  if (!/^acct_[A-Za-z0-9]+$/.test(values.STRIPE_TEST_CONNECTED_ACCOUNT ?? '')) throw new Error('A ready test connected account ID is required');
  // Missing Resend or Spaces values block that provider's evidence, not the run.
  const providers = [
    ...(values.RESEND_TEST_API_KEY && values.RESEND_TEST_FROM ? [`E2E_RESEND_API_KEY=${values.RESEND_TEST_API_KEY}`, `E2E_EMAIL_FROM=${values.RESEND_TEST_FROM}`] : []),
    ...['SPACES_TEST_ENDPOINT', 'SPACES_TEST_BUCKET', 'SPACES_TEST_ACCESS_KEY', 'SPACES_TEST_SECRET_KEY'].filter(name => values[name]).map(name => `${name}=${values[name]}`)
  ];
  if (providers.some(line => /[\r\n$]/.test(line))) throw new Error('Provider values must be single-line and contain no $');
  const original = await readFile(runtimeFile, 'utf8');
  const runtime = original.replace(/^STRIPE_SECRET_KEY=.*$/m, `STRIPE_SECRET_KEY=${values.STRIPE_TEST_SECRET_KEY}`);
  await writeFile(runtimeFile, `${runtime}\nSTRIPE_API_KEY=${values.STRIPE_TEST_SECRET_KEY}\nSTRIPE_TEST_CONNECTED_ACCOUNT=${values.STRIPE_TEST_CONNECTED_ACCOUNT}\n${providers.map(line => `${line}\n`).join('')}`);
  let input;
  const run = (...args) => {
    if (args[0] !== 'cleanup') signal.throwIfAborted();
    return capture('run', '--rm', '--no-deps', 'tests', 'node', 'scripts/staging-driver.mjs', ...args);
  };
  try {
    if (recovery) {
      await compose('up', '-d', 'app');
      await ready();
    }
    if (!recovery) {
      manifest.scenarios = scenarios;
      manifest.blocked = [];
      if (!providers.some(line => line.startsWith('E2E_RESEND_API_KEY='))) manifest.blocked.push('email');
      await save();
      const manual = scenarios.some(scenario => cardScenarios.includes(scenario));
      if (manual && !process.stdin.isTTY) throw new Error('Run pnpm test:payments:staging in an interactive terminal for manual test-card acceptance');
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
      const storage = JSON.parse((await run('storage')).split('\n').find(line => line.startsWith('E2E_STORAGE:')).slice('E2E_STORAGE:'.length));
      manifest.storage = storage;
      if (storage.status === 'blocked') manifest.blocked.push('storage');
      await save();
      console.log(`storage: ${storage.status}${storage.missing ? ` (${storage.missing.join(', ')} not set)` : ''}`);
      if (manual) input = createInterface({input: process.stdin, output: process.stdout});
      for (const scenario of scenarios) {
        signal.throwIfAborted();
        manifest.stripeResourcesPossible = true;
        await save();
        await run('prepare', scenario);
        if (cardScenarios.includes(scenario)) {
          // Read private state inside its owning container (root-owned 0600 on Linux).
          const handoff = await run('handoff', scenario);
          const privateState = JSON.parse(handoff.split('\n').find(line => line.startsWith('E2E_PRIVATE:')).slice('E2E_PRIVATE:'.length));
          console.log(`\n${scenario.toUpperCase()}: open this test Checkout URL privately:\n${privateState.url}`);
          console.log(instructions[scenario]);
          const answer = await input.question('Type confirmed after completing this step: ', {signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60_000)])});
          signal.throwIfAborted();
          if (answer.trim() !== 'confirmed') throw new Error('Manual scenario was not confirmed');
        }
        await run('verify', scenario);
        const evidence = JSON.parse(await readFile(resolve(directory, 'reports', `payment-${scenario}.json`), 'utf8'));
        const listenerLog = await capture('logs', '--no-color', 'stripe');
        const appLog = await capture('logs', '--no-color', 'app');
        // Every Stripe event the scenario relied on was delivered by the listener and received by the app,
        // shaped for the app's API version. An event fetched from the API carries the account's default
        // version instead, so only the app's own log shows what it received.
        for (const eventId of evidence.eventIds) {
          if (!listenerLog.split('\n').some(line => line.includes(eventId) && line.includes('[200]')) || !appLog.includes(eventId)) {
            throw new Error(`No correlated successful Stripe delivery and app receipt found for ${scenario}`);
          }
          if (!appLog.split('\n').some(line => line.includes(eventId) && line.includes(`"apiVersion":"${stripeApiVersion}"`))) {
            throw new Error(`Webhook API version differs from application for ${scenario}; the listener must forward ${stripeApiVersion} events`);
          }
        }
        manifest[scenario] = {...evidence, deliveryVerified: evidence.eventIds.length > 0};
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
