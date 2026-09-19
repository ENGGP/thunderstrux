import { readdir, readFile, appendFile } from 'node:fs/promises';

let runs;
try { runs = await readdir('tmp/e2e'); } catch (error) { if (error.code !== 'ENOENT') throw error; runs = []; }
const lines = ['## Browser E2E results', ''];
for (const run of runs) {
  if (!/^p216-[a-f0-9]{24}$/.test(run)) continue;
  const reports = await readdir(`tmp/e2e/${run}/reports`);
  for (const file of reports.filter(name => /^summary-\d+\.json$/.test(name))) {
    const data = JSON.parse(await readFile(`tmp/e2e/${run}/reports/${file}`, 'utf8'));
    if (!['passed', 'failed', 'timedout', 'interrupted'].includes(data.status)) throw new Error('Unexpected summary status');
    const counts = ['passed', 'failed', 'skipped', 'timedOut', 'interrupted'].map(key => {
      if (!Number.isSafeInteger(data.counts[key]) || data.counts[key] < 0) throw new Error('Invalid result count');
      return `${key}: ${data.counts[key]}`;
    });
    lines.push(`- ${data.status}: ${counts.join(', ')}`);
  }
}
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
else console.log(lines.join('\n'));
