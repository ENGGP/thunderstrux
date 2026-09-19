import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runStaging } from '../../scripts/staging-payments.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('cancelled staging refuses to read credentials or start Docker work', async () => {
  const controller = new AbortController();
  controller.abort(new Error('Run interrupted'));
  let calls = 0;
  await assert.rejects(runStaging({
    signal: controller.signal,
    compose: async () => { calls++; },
    capture: async () => { calls++; },
  }), /Run interrupted/);
  assert.equal(calls, 0);
});

async function recoveryFixture(check) {
  const directory = await mkdtemp(join(tmpdir(), 'p216-recovery-test-'));
  const original = process.cwd();
  try {
    await writeFile(join(directory, '.env.staging.local'), 'STRIPE_TEST_SECRET_KEY=sk_test_fixture\nSTRIPE_TEST_CONNECTED_ACCOUNT=acct_fixture\n');
    const runtimeFile = join(directory, 'runtime.env');
    await writeFile(runtimeFile, 'STRIPE_SECRET_KEY=\n');
    process.chdir(directory);
    await check({directory, runtimeFile, manifest: {}, save: async () => {}, recovery: true, runId: `p216-${'a'.repeat(24)}`});
  } finally {
    process.chdir(original);
    await rm(directory, {recursive: true, force: true});
  }
}

test('recovery preserves readiness failure while recording successful Stripe cleanup', async () => {
  await recoveryFixture(async options => {
    const commands = [];
    await assert.rejects(runStaging({...options,
      compose: async () => {},
      ready: async () => { throw new Error('readiness failed'); },
      capture: async (...args) => { commands.push(args); return ''; },
    }), /readiness failed/);
    assert.equal(options.manifest.stripeCleanupComplete, true);
    assert.equal(commands.length, 1);
    assert.equal(commands[0].at(-1), 'cleanup');
  });
});

test('failed Stripe recovery never records cleanup as complete', async () => {
  await recoveryFixture(async options => {
    await assert.rejects(runStaging({...options,
      compose: async () => {},
      ready: async () => {},
      capture: async () => { throw new Error('provider unavailable'); },
    }), /Stripe cleanup incomplete/);
    assert.notEqual(options.manifest.stripeCleanupComplete, true);
  });
});
