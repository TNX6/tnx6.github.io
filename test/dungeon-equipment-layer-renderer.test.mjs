import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_EQUIPMENT_ASSET_BY_SPRITE_KEY,
  DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST,
} from '../src/scripts/dungeon-equipment-assets.ts';
import { DungeonEquipmentLayerAssetLoader } from '../src/scripts/dungeon-equipment-layer-preloader.ts';
import {
  createLayeredActor,
  layeredActorNodeOrder,
  preloadLayeredActorAssets,
  preloadLayeredActorJoiningAssets,
  setLayeredActorLoadout,
  setLayeredActorState,
} from '../src/scripts/dungeon-equipment-layer-renderer.ts';

class FakeClassList {
  values = new Set();
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  contains(name) {
    return this.values.has(name);
  }
}

class FakeStyle {
  values = new Map();
  setProperty(name, value) {
    this.values.set(name, value);
  }
  removeProperty(name) {
    this.values.delete(name);
  }
}

class FakeElement {
  dataset = {};
  style = new FakeStyle();
  classList = new FakeClassList();
  children = [];
  hidden = false;
  parentElement = null;
  textContent = '';
  tabIndex = 0;
  attributes = new Map();
  append(...nodes) {
    nodes.forEach((node) => {
      node.parentElement = this;
      this.children.push(node);
    });
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
    this.parentElement = null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
}

const fakeDocument = { createElement: () => new FakeElement() };

const DUNGEON_EQUIPMENT_COMMON_LOADOUT = Object.freeze({
  weapon: 'rusty-sword',
  helmet: 'leather-cap',
  armor: 'patched-leather',
  boots: 'traveler-boots',
});

const DUNGEON_EQUIPMENT_RARE_LOADOUT = Object.freeze({
  weapon: 'steel-sword',
  helmet: 'iron-helmet',
  armor: 'iron-armor',
  boots: 'guard-boots',
});

function actor(loadout = {}) {
  const host = new FakeElement();
  return createLayeredActor({
    host,
    documentRef: fakeDocument,
    loadout,
    manifest: DUNGEON_EQUIPMENT_ASSET_BY_SPRITE_KEY,
    baseManifest: DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST,
  });
}

test('creates one base, one shadow, and the approved stable layer order', () => {
  const layered = actor();
  assert.deepEqual(layeredActorNodeOrder(layered), [
    'shadow',
    'weapon-back',
    'base-body',
    'boots',
    'armor',
    'helmet',
    'weapon-front',
    'effects-accent',
    'meta',
  ]);
  assert.equal([...layered.nodes.keys()].filter((layer) => layer === 'base-body').length, 1);
  assert.equal([...layered.nodes.keys()].filter((layer) => layer === 'shadow').length, 1);
});

test('changes one equipment slot without replacing unrelated nodes', () => {
  const layered = actor(DUNGEON_EQUIPMENT_COMMON_LOADOUT);
  const base = layered.nodes.get('base-body');
  const armor = layered.nodes.get('armor');
  const helmet = layered.nodes.get('helmet');
  const originalHelmetUrl = helmet.dataset.assetUrl;
  assert.deepEqual(setLayeredActorLoadout(layered, { helmet: DUNGEON_EQUIPMENT_RARE_LOADOUT.helmet }), ['helmet']);
  assert.equal(layered.nodes.get('base-body'), base);
  assert.equal(layered.nodes.get('armor'), armor);
  assert.equal(layered.nodes.get('helmet'), helmet);
  assert.notEqual(helmet.dataset.assetUrl, originalHelmetUrl);

  const armorBeforeWeaponChange = layered.nodes.get('armor');
  const armorUrlBeforeWeaponChange = armorBeforeWeaponChange.dataset.assetUrl;
  assert.deepEqual(setLayeredActorLoadout(layered, { weapon: DUNGEON_EQUIPMENT_RARE_LOADOUT.weapon }), ['weapon']);
  assert.equal(layered.nodes.get('armor'), armorBeforeWeaponChange);
  assert.equal(layered.nodes.get('armor').dataset.assetUrl, armorUrlBeforeWeaponChange);
});

test('keeps node and animation identity through one hundred stable poll updates', () => {
  const layered = actor(DUNGEON_EQUIPMENT_RARE_LOADOUT);
  const nodes = new Map(layered.nodes);
  const created = layered.counters.nodesCreated;
  for (let index = 0; index < 100; index += 1) {
    assert.deepEqual(setLayeredActorLoadout(layered, DUNGEON_EQUIPMENT_RARE_LOADOUT), []);
    assert.equal(setLayeredActorState(layered, 'idle'), false);
  }
  assert.equal(layered.counters.nodesCreated, created);
  nodes.forEach((node, layer) => assert.equal(layered.nodes.get(layer), node));
  assert.equal(layered.counters.stateTransitions, 0);
});

test('synchronizes state across base and equipment, then hides equipment for death and ghost', () => {
  const layered = actor(DUNGEON_EQUIPMENT_RARE_LOADOUT);
  assert.equal(setLayeredActorState(layered, 'walk-back'), true);
  for (const layer of ['base-body', 'boots', 'armor', 'helmet', 'weapon-back', 'weapon-front']) {
    assert.equal(layered.nodes.get(layer).dataset.assetState, 'walk-back');
  }
  assert.equal(setLayeredActorState(layered, 'death'), true);
  assert.match(layered.nodes.get('base-body').dataset.assetUrl, /\/death\.webp$/);
  for (const layer of ['boots', 'armor', 'helmet', 'weapon-back', 'weapon-front']) {
    assert.equal(layered.nodes.get(layer).hidden, true);
  }
  assert.equal(setLayeredActorState(layered, 'ghost'), true);
  assert.match(layered.nodes.get('base-body').dataset.assetUrl, /\/ghost\.webp$/);
  assert.equal(layered.nodes.get('shadow').hidden, true);
  assert.equal(setLayeredActorState(layered, 'idle'), true);
  assert.equal(layered.nodes.get('shadow').hidden, false);
  assert.equal(layered.nodes.get('armor').hidden, false);
});

test('clears only the removed equipment visual and preserves base and meta', () => {
  const layered = actor(DUNGEON_EQUIPMENT_COMMON_LOADOUT);
  const base = layered.nodes.get('base-body');
  const meta = layered.nodes.get('meta');
  assert.deepEqual(setLayeredActorLoadout(layered, { helmet: null }), ['helmet']);
  assert.equal(layered.nodes.get('helmet').hidden, true);
  assert.equal(layered.nodes.get('helmet').dataset.assetUrl, undefined);
  assert.equal(layered.nodes.get('base-body'), base);
  assert.equal(layered.nodes.get('meta'), meta);
});

test('keeps weapon back behind base, front above armor and helmet, and meta last', () => {
  const layered = actor(DUNGEON_EQUIPMENT_RARE_LOADOUT);
  const order = layeredActorNodeOrder(layered);
  assert.ok(order.indexOf('weapon-back') < order.indexOf('base-body'));
  assert.ok(order.indexOf('weapon-front') > order.indexOf('helmet'));
  assert.ok(order.indexOf('weapon-front') > order.indexOf('armor'));
  assert.equal(order.at(-1), 'meta');
});

test('isolates an equipment decode failure without hiding the base', async () => {
  const layered = actor(DUNGEON_EQUIPMENT_COMMON_LOADOUT);
  const loader = new DungeonEquipmentLayerAssetLoader({
    decoder: async (url) => {
      if (url.includes('/leather-cap/')) throw new Error('fixture failure');
    },
    retryCooldownMs: 60_000,
  });
  const results = await preloadLayeredActorAssets(layered, loader);
  assert.ok(results.some((result) => !result.loaded));
  assert.equal(layered.nodes.get('base-body').hidden, false);
  assert.equal(layered.nodes.get('helmet').hidden, true);
  assert.notEqual(layered.nodes.get('armor').hidden, true);
});

test('deduplicates URLs and limits retries after a controlled failure', async () => {
  let decodes = 0;
  let now = 0;
  const loader = new DungeonEquipmentLayerAssetLoader({
    decoder: async () => {
      decodes += 1;
      throw new Error('decode failed');
    },
    retryCooldownMs: 100,
    maxAttempts: 2,
    now: () => now,
  });
  await Promise.all([loader.load('/fixture.webp'), loader.load('/fixture.webp')]);
  assert.equal(decodes, 1);
  await loader.load('/fixture.webp');
  assert.equal(decodes, 1);
  now = 101;
  await loader.load('/fixture.webp');
  assert.equal(decodes, 2);
  now = 1_000;
  await loader.load('/fixture.webp');
  assert.equal(decodes, 2);
});

test('preloads only the active loadout and the requested lifecycle states', async () => {
  const decoded = [];
  const layered = actor(DUNGEON_EQUIPMENT_COMMON_LOADOUT);
  const loader = new DungeonEquipmentLayerAssetLoader({
    decoder: async (url) => decoded.push(url),
  });
  await preloadLayeredActorJoiningAssets(layered, loader);
  assert.ok(decoded.some((url) => url.endsWith('/idle.webp')));
  assert.ok(decoded.some((url) => url.endsWith('/walk-back.webp')));
  assert.ok(decoded.some((url) => url.endsWith('/idle-main.webp')));
  assert.equal(
    decoded.some((url) => url.includes('/walk-front')),
    false
  );
  assert.equal(
    decoded.some((url) => url.includes('/iron-armor/')),
    false
  );

  decoded.length = 0;
  setLayeredActorState(layered, 'death');
  await preloadLayeredActorAssets(layered, loader);
  assert.deepEqual(decoded, [DUNGEON_EQUIPMENT_BASE_STYLE_MANIFEST.red.paths.death]);
});
