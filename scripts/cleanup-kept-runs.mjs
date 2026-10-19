import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { runIdPattern } from './e2e-guards.mjs';

// Removes every browser and baseline run kept since its feature started
// (containers, network and test database), one at a time through the runner's
// own owned cleanup. Staging runs awaiting Stripe recovery are left alone.
let runs;
try { runs = await readdir('tmp/e2e'); } catch (error) { if (error.code !== 'ENOENT') throw error; runs = []; }
let failed = 0;
for (const run of runs.filter(name => runIdPattern.test(name))) {
  const manifest = JSON.parse(await readFile(`tmp/e2e/${run}/manifest.json`, 'utf8').catch(() => '{}'));
  if (manifest.cleanupComplete || manifest.staging) continue;
  console.log(`Cleaning up ${run}`);
  if (spawnSync(process.execPath, ['scripts/run-e2e.mjs', 'cleanup', run], { stdio: 'inherit' }).status !== 0) failed += 1;
}
if (failed) { console.error(`${failed} run(s) still need cleanup`); process.exitCode = 1; }
