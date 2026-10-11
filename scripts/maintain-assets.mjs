import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@/': `${process.cwd().replace(/\\/g, '/')}/` } });
const { maintainAssets, inspectAssetObjects, inspectAssets } = await jiti.import('../lib/assets/maintenance.ts');
const { prisma } = await jiti.import('../lib/db/index.ts');
const args = process.argv.slice(2).filter(arg => arg !== '--');
if (args.some((arg, index) => !['--apply', '--objects', '--integrity', '--cursor'].includes(arg) && args[index - 1] !== '--cursor')) throw new Error('Unsupported asset maintenance argument');
try {
  const cursorIndex = args.indexOf('--cursor');
  const cursor = cursorIndex < 0 ? undefined : args[cursorIndex + 1];
  if (cursorIndex >= 0 && (!cursor || cursor.startsWith('--'))) throw new Error('Provide a cursor');
  if (args.includes('--objects') && args.includes('--integrity')) throw new Error('Choose one inspection mode');
  console.log(JSON.stringify(args.includes('--objects') ? await inspectAssetObjects(undefined, cursor) : args.includes('--integrity') ? await inspectAssets(undefined, cursor) : await maintainAssets({ dryRun: !args.includes('--apply'), cursor })));
} finally { await prisma.$disconnect(); }
