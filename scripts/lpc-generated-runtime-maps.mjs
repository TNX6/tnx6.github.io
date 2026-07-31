import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const catalogPath = path.join(
  projectRoot,
  'public',
  'assets',
  'dungeon-overlay',
  'lpc-v1',
  'generated-equipment-catalog.json'
);
const outputDirectory = path.join(projectRoot, 'public', 'assets', 'dungeon-overlay', 'lpc-v1', 'runtime');
const slots = ['weapon', 'helmet', 'armor', 'boots'];
const visualCategoriesBySlot = Object.freeze({
  weapon: ['weapon', 'shield', 'tools', 'quiver'],
  helmet: ['helmet', 'hat', 'hair', 'head', 'facial', 'eyes', 'beards'],
  armor: ['armor', 'torso', 'body', 'neck', 'dress', 'backpack', 'arms', 'shoulders', 'cape', 'shadow'],
  boots: ['boots', 'legs', 'feet'],
});
const slotByVisualCategory = new Map(
  Object.entries(visualCategoriesBySlot).flatMap(([slot, categories]) => categories.map((category) => [category, slot]))
);

const visualSlotFor = (visualId) => {
  const category = /^lpc-visual-([a-z0-9]+)-[a-z0-9][a-z0-9-]*$/.exec(visualId)?.[1];
  return category ? (slotByVisualCategory.get(category) ?? null) : null;
};

const assetPaths = (asset) => (typeof asset === 'string' ? [asset] : [asset?.back, asset?.front]);

const assertAssetPathExists = async (assetPath, itemId, state) => {
  if (typeof assetPath !== 'string' || !assetPath.startsWith('/assets/')) {
    throw new Error(`${itemId} has an invalid ${state} asset path.`);
  }
  await access(path.join(projectRoot, 'public', assetPath.slice(1)));
};

const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
if (!Array.isArray(catalog.items) || catalog.items.length !== 682) {
  throw new Error(
    `Expected 682 generated LPC catalog items, received ${
      Array.isArray(catalog.items) ? catalog.items.length : 'invalid catalog'
    }.`
  );
}

const internalIds = new Set();
const visualIds = new Set();
for (const item of catalog.items) {
  if (typeof item.internalItemId !== 'string' || internalIds.has(item.internalItemId)) {
    throw new Error(`Duplicate or invalid internalItemId: ${item.internalItemId}`);
  }
  if (typeof item.lpcVisualId !== 'string' || visualIds.has(item.lpcVisualId)) {
    throw new Error(`Duplicate or invalid lpcVisualId: ${item.lpcVisualId}`);
  }
  if (visualSlotFor(item.lpcVisualId) !== item.slot) {
    throw new Error(`${item.lpcVisualId} does not route to its canonical ${item.slot} slot.`);
  }
  internalIds.add(item.internalItemId);
  visualIds.add(item.lpcVisualId);
}

const crossIdentityCollisions = [...internalIds].filter((id) => visualIds.has(id));
if (crossIdentityCollisions.length > 0) {
  throw new Error(`Cross-identity collision: ${crossIdentityCollisions[0]}`);
}

await mkdir(outputDirectory, { recursive: true });

for (const slot of slots) {
  const entries = catalog.items
    .filter((item) => item.slot === slot)
    .map((item) => ({
      internalItemId: item.internalItemId,
      lpcVisualId: item.lpcVisualId,
      slot: item.slot,
      layered: item.layered,
      idle: item.assets.idle,
      walk: item.assets.walk,
      hurt: item.assets.hurt,
      idleBreath: item.assets.idleBreath,
    }))
    .sort((left, right) => left.internalItemId.localeCompare(right.internalItemId));

  for (const entry of entries) {
    for (const [state, asset] of Object.entries({
      idle: entry.idle,
      walk: entry.walk,
      hurt: entry.hurt,
      idleBreath: entry.idleBreath,
    })) {
      for (const assetPath of assetPaths(asset)) {
        await assertAssetPathExists(assetPath, entry.internalItemId, state);
      }
    }
  }

  await writeFile(path.join(outputDirectory, `generated-${slot}-map.json`), `${JSON.stringify(entries)}\n`, 'utf8');
  console.log(`${slot}: ${entries.length} items`);
}
