import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { userInfo } from 'node:os';
import { assertRunId, assertOwnedManifest } from './e2e-guards.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2).filter(arg => arg !== '--');
const mode = args[0] ?? 'test';
const runId = assertRunId(mode === 'cleanup' ? args[1] : `p216-${randomBytes(12).toString('hex')}`);
const directory = resolve(root, 'tmp', 'e2e', runId);
const runtimeFile = resolve(directory, 'runtime.env');
const reportDir = resolve(directory, 'reports');
const manifestFile = resolve(directory, 'manifest.json');
const env = { ...process.env, E2E_RUNTIME_FILE: runtimeFile, E2E_OUTPUT_DIR: reportDir };
// Explicit --env-file prevents Compose from discovering the developer's .env.
const composeArgs = ['compose', '--env-file', runtimeFile, '-f', resolve(root, 'docker-compose.e2e.yml'), '-p', runId];
let manifest;
let activeChild;
let interrupted = false;
const cancellation = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  cancellation.abort(new Error('Run interrupted'));
  activeChild?.kill('SIGTERM');
});

export async function command(args, capture = false) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('docker', args, { cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: false });
    activeChild = child;
    let output = '';
    if (capture) {
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
    }
    child.on('error', reject);
    child.on('close', code => {
      activeChild = undefined;
      if (code === 0) resolvePromise(output);
      else reject(new Error(`Docker command failed (${code})${capture ? ': ' + output.slice(-1500).replace(/(?:sk_test_|whsec_)[A-Za-z0-9]+/g, '[redacted]').replace(/https:\/\/checkout\.stripe\.com\/\S+/g, '[private Checkout URL]') : ''}`));
    });
  });
}
const compose = (...args) => command([...composeArgs, ...args]);
const capture = (...args) => command([...composeArgs, ...args], true);
async function save() { await writeFile(manifestFile, JSON.stringify(manifest, null, 2)); }
async function createRuntime() {
  await writeFile(runtimeFile, `AUTH_SECRET=${randomBytes(32).toString('hex')}\nMFA_ENFORCEMENT_MODE=${mode === 'test' ? 'enforce' : 'off'}\nMFA_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}\nSTRIPE_SECRET_KEY=\nSTRIPE_WEBHOOK_SECRET=whsec_p216_synthetic\nSTRIPE_CONNECT_WEBHOOK_SECRET=whsec_p216_connect\nE2E_RUN_ID=${runId}\n`, {mode: 0o600});
}
async function retainRecovery() {
  assertOwnedManifest(manifest, runId);
  try {
    // Remove all run containers, but keep the database volume for Stripe recovery.
    const ids = (await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${runId}`], true)).trim().split(/\s+/).filter(Boolean);
    if (ids.length) await command(['rm', '-f', ...ids], true);
  } finally {
    await unlink(runtimeFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  manifest.passed = false;
  await save();
}
async function cleanup() {
  const saved = JSON.parse(await readFile(manifestFile, 'utf8'));
  assertOwnedManifest(saved, runId);
  if (saved.cleanupComplete) {
    await unlink(runtimeFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
    return;
  }
  const ids = (await capture('--profile', '*', 'ps', '-aq')).trim().split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const label = (await command(['inspect', '--format', '{{index .Config.Labels "com.docker.compose.project"}}', id], true)).trim();
    if (label !== runId) throw new Error('Container ownership mismatch; cleanup refused');
  }
  await compose('--profile', '*', 'down', '--volumes', '--remove-orphans', '--timeout', '10');
  const remaining = (await command(['ps', '-aq', '--filter', `label=com.docker.compose.project=${runId}`], true)).trim();
  if (remaining) throw new Error('Run containers remain after cleanup');
  manifest.cleanupComplete = true;
  await save();
  await unlink(runtimeFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
}
async function checkPort() {
  await new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', () => fail(new Error('Port 3100 is occupied; existing server will not be reused')));
    server.listen(3100, '127.0.0.1', () => server.close(ok));
  });
}
async function ready() {
  for (let n = 0; n < 90; n++) {
    if (interrupted) throw new Error('Run interrupted');
    try {
      const response = await fetch('http://localhost:3100/api/public/events', { signal: AbortSignal.timeout(2000) });
      if (response.ok) return;
    } catch { /* App may still be migrating. */ }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  throw new Error('Application/database readiness timed out');
}

try {
  if (mode === 'cleanup') {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    assertOwnedManifest(manifest, runId);
    if (!manifest.cleanupComplete && manifest.staging && manifest.stripeResourcesPossible && !manifest.stripeCleanupComplete) {
      await checkPort();
      await createRuntime();
      const { runStaging } = await import('./staging-payments.mjs');
      await runStaging({ compose, capture, ready, runtimeFile, directory, runId, manifest, save, signal: cancellation.signal, recovery: true });
      if (!manifest.stripeCleanupComplete) throw new Error('Stripe recovery remains incomplete; resources retained');
    }
    await cleanup();
  } else {
    if (!['test', 'staging', 'baseline'].includes(mode)) throw new Error('Unknown test mode');
    await checkPort();
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
      const owner = `${process.env.USERDOMAIN}\\${userInfo().username}`;
      await new Promise((ok, fail) => {
        const child = spawn('icacls', [directory, '/inheritance:r', '/grant:r', `${owner}:(OI)(CI)F`, 'SYSTEM:(OI)(CI)F'], {stdio: 'ignore', shell: false});
        child.on('error', fail);
        child.on('close', code => code === 0 ? ok() : fail(new Error('Cannot restrict staging directory permissions')));
      });
    }
    await mkdir(reportDir, { recursive: true, mode: 0o700 });
    manifest = { version: 1, runId, project: runId, staging: mode === 'staging', createdAt: new Date().toISOString() };
    await save();
    await createRuntime();
    console.log(`P2.16 run: ${runId}`);
    await compose('build', 'app', 'runner');
    if (interrupted) throw new Error('Run interrupted');
    if (mode === 'staging') {
      const { runStaging } = await import('./staging-payments.mjs');
      await runStaging({ compose, capture, ready, runtimeFile, directory, runId, manifest, save, signal: cancellation.signal });
    } else {
      await compose('up', '-d', 'app');
      await ready();
      if (mode === 'baseline') {
        await compose('run', '--rm', '--no-deps', 'runner', 'sh', '-c', 'pnpm typecheck && pnpm test && pnpm security:audit');
      } else {
        await compose('run', '--rm', '--no-deps', 'runner', 'pnpm', 'exec', 'playwright', 'test', 'mfa-enforced.spec.ts', '--project=desktop');
        await compose('stop', 'app');
        const afterMfa = await readFile(runtimeFile, 'utf8');
        await writeFile(runtimeFile, afterMfa.replace('MFA_ENFORCEMENT_MODE=enforce\n', 'MFA_ENFORCEMENT_MODE=off\n'));
        await compose('up', '-d', '--force-recreate', 'app');
        await ready();
        await compose('run', '--rm', '--no-deps', 'runner', 'pnpm', 'exec', 'playwright', 'test', 'browser.spec.ts', 'mobile.spec.ts');
        await compose('stop', 'app');
        const runtime = await readFile(runtimeFile, 'utf8');
        await writeFile(runtimeFile, runtime.replace('STRIPE_SECRET_KEY=\n', 'STRIPE_SECRET_KEY=sk_test_synthetic\n'));
        await compose('up', '-d', '--force-recreate', 'app');
        await ready();
        await compose('run', '--rm', '--no-deps', 'runner', 'pnpm', 'exec', 'playwright', 'test', 'webhooks.spec.ts', '--project=desktop');
      }
    }
    cancellation.signal.throwIfAborted();
    manifest.passed = true;
    await save();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (manifest?.staging && manifest.stripeResourcesPossible && !manifest.stripeCleanupComplete) {
    await retainRecovery().catch(error => { console.error(`Credential cleanup failed: ${error.message}`); process.exitCode = 1; });
  }
  if (manifest) {
    if (!manifest.staging || manifest.stripeCleanupComplete || !manifest.stripeResourcesPossible) {
      await cleanup().catch(async error => { manifest.passed = false; await save(); console.error(`Cleanup pending for ${runId}: ${error.message}`); process.exitCode = 1; });
    } else console.error(`Staging resources retained for recovery: ${runId}`);
    console.log(`Evidence manifest: tmp/e2e/${runId}/manifest.json`);
  }
}
