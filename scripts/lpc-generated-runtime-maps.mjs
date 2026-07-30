import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const catalogPath = path.join(
  projectRoot,
  'public',
  'assets',
  'dungeon-overlay',
  'lpc-v1',
  'generated-equipment-catalog.json',
);
const outputDirectory = path.join(
  projectRoot,
  'public',
  'assets',
  'dungeon-overlay',
  'lpc-v1',
  'runtime',
);
const slots = ['weapon', 'helmet', 'armor', 'boots'];

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
if (!Array.isArray(catalog.items) || catalog.items.length !== 682) {
  throw new Error(
    `Expected 682 generated LPC catalog items, received ${
      Array.isArray(catalog.items) ? catalog.items.length : 'invalid catalog'
    }.`,
  );
}

await mkdir(outputDirectory, { recursive: true });

for (const slot of slots) {
  const entries = catalog.items
    .filter((item) => item.slot === slot)
    .map((item) => ({
      internalItemId: item.internalItemId,
      slot: item.slot,
      layered: item.layered,
      idle: item.assets.idle,
      walk: item.assets.walk,
      hurt: item.assets.hurt,
      idleBreath: item.assets.idleBreath,
    }))
    .sort((left, right) =>
      left.internalItemId.localeCompare(right.internalItemId),
    );

  await writeFile(
    path.join(outputDirectory, `generated-${slot}-map.json`),
    `${JSON.stringify(entries)}\n`,
    'utf8',
  );
  console.log(`${slot}: ${entries.length} items`);
}
