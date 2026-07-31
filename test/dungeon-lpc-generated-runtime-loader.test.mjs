import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';
import ts from 'typescript';

const projectRoot = process.cwd();
const catalog = JSON.parse(
  await readFile(
    path.join(projectRoot, 'public/assets/dungeon-overlay/lpc-v1/generated-equipment-catalog.json'),
    'utf8'
  )
);
const slots = ['weapon', 'helmet', 'armor', 'boots'];
const mapUrlBySlot = Object.fromEntries(
  slots.map((slot) => [slot, `/assets/dungeon-overlay/lpc-v1/runtime/generated-${slot}-map.json`])
);
const mapsByUrl = new Map();
for (const [slot, url] of Object.entries(mapUrlBySlot)) {
  mapsByUrl.set(
    url,
    JSON.parse(
      await readFile(
        path.join(projectRoot, `public/assets/dungeon-overlay/lpc-v1/runtime/generated-${slot}-map.json`),
        'utf8'
      )
    )
  );
}

const importTypeScript = async (filePath, transform = (source) => source) => {
  const source = transform(await readFile(filePath, 'utf8'));
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}#${Math.random()}`);
};

const loader = await importTypeScript(path.join(projectRoot, 'src/scripts/dungeon-lpc-generated-runtime-loader.ts'));
const originalFetch = globalThis.fetch;
let requestedUrls = [];

globalThis.fetch = async (input) => {
  const url = String(input);
  requestedUrls.push(url);
  const body = mapsByUrl.get(url);
  if (!body) return { ok: false, status: 404, url, json: async () => null };
  return {
    ok: true,
    status: 200,
    url,
    json: async () => structuredClone(body),
  };
};

beforeEach(() => {
  loader.clearGeneratedLpcRuntimeMapCache();
  requestedUrls = [];
});

after(() => {
  loader.clearGeneratedLpcRuntimeMapCache();
  globalThis.fetch = originalFetch;
});

test('runtime maps store 682 minimal entries with valid unique identities and assets', async () => {
  const expectedCounts = { weapon: 114, helmet: 357, armor: 175, boots: 36 };
  const allowedFields = ['hurt', 'idle', 'idleBreath', 'internalItemId', 'layered', 'lpcVisualId', 'slot', 'walk'];
  const internalIds = new Set();
  const visualIds = new Set();

  for (const slot of slots) {
    const entries = mapsByUrl.get(mapUrlBySlot[slot]);
    assert.equal(entries.length, expectedCounts[slot]);
    for (const item of entries) {
      assert.deepEqual(Object.keys(item).sort(), allowedFields);
      assert.equal(item.slot, slot);
      assert.equal(internalIds.has(item.internalItemId), false);
      assert.equal(visualIds.has(item.lpcVisualId), false);
      assert.equal(visualIds.has(item.internalItemId), false);
      assert.equal(internalIds.has(item.lpcVisualId), false);
      internalIds.add(item.internalItemId);
      visualIds.add(item.lpcVisualId);

      for (const asset of [item.idle, item.walk, item.hurt, item.idleBreath]) {
        const paths = typeof asset === 'string' ? [asset] : [asset.back, asset.front];
        for (const assetUrl of paths) {
          assert.match(assetUrl, /^\/assets\//);
          await access(path.join(projectRoot, 'public', assetUrl.slice(1)));
        }
      }
    }
  }

  assert.equal(internalIds.size, 682);
  assert.equal(visualIds.size, 682);
  assert.equal(
    [...internalIds].some((id) => visualIds.has(id)),
    false
  );
});

test('all internal and visual IDs resolve to the identical normalized runtime entry', async () => {
  assert.equal(catalog.items.length, 682);
  for (const catalogItem of catalog.items) {
    const visualSlot = catalogItem.slot === 'armor' ? 'chest' : catalogItem.slot;
    assert.equal(loader.generatedLpcRuntimeSlotFor(visualSlot, catalogItem.internalItemId), catalogItem.slot);
    assert.equal(loader.generatedLpcRuntimeSlotFor(visualSlot, catalogItem.lpcVisualId), catalogItem.slot);
    const byInternal = await loader.loadGeneratedLpcRuntimeItem(catalogItem.slot, catalogItem.internalItemId);
    const byVisual = await loader.loadGeneratedLpcRuntimeItem(catalogItem.slot, catalogItem.lpcVisualId);
    assert.ok(byInternal);
    assert.strictEqual(byVisual, byInternal);
    assert.equal(byInternal.internalItemId, catalogItem.internalItemId);
    assert.equal(byInternal.lpcVisualId, catalogItem.lpcVisualId);
  }
  assert.deepEqual(new Set(requestedUrls), new Set(Object.values(mapUrlBySlot)));
  assert.equal(requestedUrls.length, 4);
});

test('visual identity routing is slot-specific and rejects conflicts and malformed IDs', async () => {
  for (const slot of slots) {
    const visualSlot = slot === 'armor' ? 'chest' : slot;
    assert.equal(loader.generatedLpcRuntimeSlotFor(visualSlot, `lpc-visual-${slot}-example-123`), slot);
  }
  assert.equal(loader.generatedLpcRuntimeSlotFor('helmet', 'lpc-visual-weapon-example-123'), null);
  assert.equal(loader.generatedLpcRuntimeSlotFor('weapon', 'lpc-visual-unknown-example'), null);
  assert.equal(loader.generatedLpcRuntimeSlotFor('weapon', 'lpc-visual-weapon-'), null);
  assert.equal(await loader.loadGeneratedLpcRuntimeItem('weapon', 'lpc-visual-unknown-example'), null);
  assert.equal(requestedUrls.length, 0);
});

test('a weapon visual ID loads and caches only the weapon runtime map', async () => {
  const item = catalog.items.find((candidate) => candidate.slot === 'weapon');
  assert.ok(item);
  const [first, second] = await Promise.all([
    loader.loadGeneratedLpcRuntimeItem('weapon', item.lpcVisualId),
    loader.loadGeneratedLpcRuntimeItem('weapon', item.internalItemId),
  ]);
  assert.ok(first);
  assert.strictEqual(second, first);
  assert.deepEqual(requestedUrls, [mapUrlBySlot.weapon]);
  assert.equal(await loader.loadGeneratedLpcRuntimeItem('weapon', 'lpc-visual-weapon-does-not-exist'), null);
  assert.deepEqual(requestedUrls, [mapUrlBySlot.weapon]);
});

test('the eight direct production mappings stay synchronous and generated lookup remains idle otherwise', async () => {
  globalThis.__generatedLookupCalls = 0;
  const adapter = await importTypeScript(path.join(projectRoot, 'src/scripts/dungeon-lpc-adapter.ts'), (source) =>
    source.replace(
      "import { generatedLpcRuntimeSlotFor } from './dungeon-lpc-generated-runtime-loader';",
      'const generatedLpcRuntimeSlotFor = () => { globalThis.__generatedLookupCalls += 1; return null; };'
    )
  );
  const directCases = [
    ['weapon', 'rusty-sword', 'rusty-sword'],
    ['helmet', 'leather-cap', 'leather-cap'],
    ['armor', 'patched-leather', 'patched-leather'],
    ['boots', 'traveler-boots', 'leather-boots'],
    ['weapon', 'steel-sword', 'steel-sword'],
    ['helmet', 'iron-helmet', 'iron-helmet'],
    ['armor', 'iron-armor', 'iron-armor'],
    ['boots', 'guard-boots', 'guard-boots'],
  ];

  for (const [productionSlot, itemId, expectedId] of directCases) {
    const visualSlot = productionSlot === 'armor' ? 'chest' : productionSlot;
    const result = adapter.adaptDungeonPlayerToLpc({
      slot: 1,
      username: 'tester',
      visualLoadout: { [productionSlot]: { spriteKey: itemId } },
    });
    assert.equal(result.props.loadout[visualSlot], true);
    assert.equal(result.props.itemIds[visualSlot], expectedId);
  }
  assert.equal(globalThis.__generatedLookupCalls, 0);

  const empty = adapter.adaptDungeonPlayerToLpc({ slot: 1, username: 'tester' });
  assert.equal(Object.values(empty.props.loadout).some(Boolean), false);
  assert.equal(globalThis.__generatedLookupCalls, 0);
  assert.equal(requestedUrls.length, 0);

  const rendererMode = await importTypeScript(path.join(projectRoot, 'src/scripts/dungeon-renderer-mode.ts'));
  assert.equal(rendererMode.resolveDungeonRendererMode(''), 'equipment-v2');
  assert.equal(rendererMode.resolveDungeonRendererMode('?renderer=lpc'), 'lpc');
  assert.equal(requestedUrls.length, 0);
  delete globalThis.__generatedLookupCalls;
});
