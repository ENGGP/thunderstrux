import { createJiti } from 'jiti';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { validateIntegrationDatabaseUrl } from './integration-test-guards.mjs';

// This helper writes fixtures and destroys objects, so only the owned rehearsal is eligible.
validateIntegrationDatabaseUrl(process.env.DATABASE_URL);
if (process.env.ASSET_STORAGE_ENDPOINT !== 'http://object-store:8333' || process.env.ASSET_STORAGE_BUCKET !== 'operations-assets')
  throw new Error('Asset rehearsal requires isolated operations storage');
const jiti = createJiti(import.meta.url, { alias: { '@/': `${process.cwd().replace(/\\/g, '/')}/` } });
const { prisma } = await jiti.import('../lib/db/index.ts');
const { assetStorage } = await jiti.import('../lib/assets/storage.ts');
const storage = assetStorage();
const [mode, archive] = process.argv.slice(2);
if (!['seed', 'remove', 'restore', 'verify'].includes(mode) || archive !== '/recovery/assets.json') throw new Error('Invalid asset rehearsal invocation');
try {
  if (mode === 'seed') {
    const organisation = await prisma.organisation.findFirstOrThrow();
    const user = await prisma.user.findFirstOrThrow();
    const bytes = await sharp({ create: { width: 8, height: 6, channels: 3, background: 'red' } }).webp().toBuffer();
    const key = `assets/${randomUUID()}.webp`;
    await storage.put(key, bytes);
    const asset = await prisma.asset.create({ data: { organisationId: organisation.id, uploadedByUserId: user.id, storageKey: key,
      kind: 'logo', status: 'ready', readyAt: new Date(), width: 8, height: 6, byteSize: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } });
    await writeFile(archive, JSON.stringify({ id: asset.id, key, bytes: bytes.toString('base64'), sha256: asset.sha256 }), { mode: 0o600 });
  } else {
    const record = JSON.parse(await readFile(archive, 'utf8'));
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: record.id } });
    if (asset.storageKey !== record.key || asset.sha256 !== record.sha256) throw new Error('Asset metadata did not survive restore');
    if (mode === 'remove') { await storage.delete(record.key); if (await storage.head(record.key)) throw new Error('Object removal failed'); }
    if (mode === 'restore') {
      const bytes = Buffer.from(record.bytes, 'base64');
      if (createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Asset archive is corrupt');
      await storage.put(record.key, bytes);
    }
    if (mode === 'restore' || mode === 'verify') {
      const bytes = await storage.get(record.key);
      if (!bytes || bytes.length !== asset.byteSize || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Asset bytes did not survive recovery');
    }
  }
  console.log(JSON.stringify({ assetRehearsal: mode, passed: true }));
} finally { await prisma.$disconnect(); }
