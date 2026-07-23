import assert from 'node:assert/strict';
import test from 'node:test';

import { DungeonEquipmentLayerAssetLoader } from '../src/scripts/dungeon-equipment-layer-preloader.ts';
import { DungeonOverlayEquipmentAdapter } from '../src/scripts/dungeon-overlay-equipment-adapter.ts';

class FakeClassList {
  values = new Set();
  add(...names) {
    names.forEach((name) => this.values.add(name));
  }
  remove(...names) {
    names.forEach((name) => this.values.delete(name));
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
  offsetWidth = 190;
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

const emptyLoadout = { weapon: null, helmet: null, armor: null, boots: null };
const commonLoadout = {
  weapon: { spriteKey: 'rusty-sword' },
  helmet: { spriteKey: 'leather-cap' },
  armor: { spriteKey: 'patched-leather' },
  boots: { spriteKey: 'traveler-boots' },
};
const rareLoadout = {
  weapon: { spriteKey: 'steel-sword' },
  helmet: { spriteKey: 'iron-helmet' },
  armor: { spriteKey: 'iron-armor' },
  boots: { spriteKey: 'guard-boots' },
};

function player(slotNumber = 1, state = 'idle') {
  const actor = new FakeElement();
  actor.dataset.animationState = state;
  const figure = new FakeElement();
  const legacyAvatar = new FakeElement();
  figure.append(legacyAvatar);
  actor.append(figure);
  return { slotNumber, actor, figure, legacyAvatar };
}

function adapter(decoder = async () => {}, warnings = []) {
  return new DungeonOverlayEquipmentAdapter({
    documentRef: fakeDocument,
    loader: new DungeonEquipmentLayerAssetLoader({ decoder, retryCooldownMs: 60_000 }),
    warn: (warning) => warnings.push(warning),
    initialPlayerNodeCount: 6,
  });
}

function reconcileInput(target, visualLoadout, runId = 'run-v2', present = true) {
  return {
    runId,
    slotNumber: target.slotNumber,
    playerActor: target.actor,
    figure: target.figure,
    legacyAvatar: target.legacyAvatar,
    visualLoadoutPresent: present,
    visualLoadout,
  };
}

test('keeps V1 and null viewer payloads on legacy without creating layered nodes', async () => {
  const renderer = adapter();
  const absent = player(1);
  const fallback = player(2);
  assert.equal(await renderer.reconcile(reconcileInput(absent, undefined, 'run-v1', false)), 'legacy');
  assert.equal(await renderer.reconcile(reconcileInput(fallback, null)), 'legacy');
  assert.equal(absent.figure.children.length, 1);
  assert.equal(fallback.figure.children.length, 1);
  assert.equal(renderer.diagnostics().layeredActorCreations, 0);
  assert.equal(renderer.diagnostics().decodeCalls, 0);
});

test('creates one production layered actor with no duplicate shadow, effects, or meta nodes', async () => {
  const renderer = adapter();
  const target = player(1);
  assert.equal(await renderer.reconcile(reconcileInput(target, emptyLoadout)), 'layered');
  const record = renderer.recordFor(target.actor);
  assert.ok(record?.layeredActor);
  assert.deepEqual(
    [...record.layeredActor.nodes.keys()],
    ['weapon-back', 'base-body', 'boots', 'armor', 'helmet', 'weapon-front']
  );
  assert.equal(target.legacyAvatar.hidden, true);
  assert.equal(record.layeredActor.actor.hidden, false);
  assert.equal(record.layeredActor.actor.ariaHidden, 'true');
  assert.equal(renderer.diagnostics().baseLayerCreations, 1);
  assert.equal(renderer.diagnostics().equipmentLayerCreations, 5);
});

test('maps all six slots to their fixed palette independent of names or array order', async () => {
  const renderer = adapter();
  const expected = ['red', 'purple', 'green', 'orange', 'blue', 'black-gold'];
  for (let slotNumber = 6; slotNumber >= 1; slotNumber -= 1) {
    const target = player(slotNumber);
    await renderer.reconcile(reconcileInput(target, emptyLoadout));
    assert.equal(renderer.recordFor(target.actor).layeredActor.palette, expected[slotNumber - 1]);
  }
});

test('mounts common, rare, and mixed layers from manifest URLs only', async () => {
  const renderer = adapter();
  const common = player(1);
  const rare = player(2);
  const mixed = player(3);
  await renderer.reconcile(reconcileInput(common, commonLoadout));
  await renderer.reconcile(reconcileInput(rare, rareLoadout));
  await renderer.reconcile(
    reconcileInput(mixed, {
      weapon: rareLoadout.weapon,
      helmet: commonLoadout.helmet,
      armor: null,
      boots: rareLoadout.boots,
    })
  );

  const commonActor = renderer.recordFor(common.actor).layeredActor;
  const rareActor = renderer.recordFor(rare.actor).layeredActor;
  const mixedActor = renderer.recordFor(mixed.actor).layeredActor;
  assert.match(commonActor.nodes.get('weapon-front').dataset.assetUrl, /\/equipment-v2\/items\/rusty-sword\//);
  assert.match(rareActor.nodes.get('weapon-back').dataset.assetUrl, /\/equipment-v2\/items\/steel-sword\//);
  assert.match(mixedActor.nodes.get('helmet').dataset.assetUrl, /\/equipment-v2\/items\/leather-cap\//);
  assert.match(mixedActor.nodes.get('boots').dataset.assetUrl, /\/equipment-v2\/items\/guard-boots\//);
  assert.equal(mixedActor.nodes.get('armor').hidden, true);
  for (const record of [commonActor, rareActor, mixedActor]) {
    for (const node of record.nodes.values()) {
      const url = node.dataset.assetUrl;
      if (url) assert.match(url, /^\/assets\/dungeon-overlay\/equipment-v2\//);
    }
  }
});

test('maps overlay states without exposing the actor for inside or hit', async () => {
  const renderer = adapter();
  const target = player(1, 'inside');
  await renderer.reconcile(reconcileInput(target, commonLoadout));
  const layered = renderer.recordFor(target.actor).layeredActor;

  renderer.setState(target.actor, 'arriving');
  assert.equal(layered.state, 'walk-front');
  assert.equal(layered.actor.hidden, false);
  renderer.setState(target.actor, 'entering');
  assert.equal(layered.state, 'walk-back');
  renderer.setState(target.actor, 'inside');
  assert.equal(layered.actor.hidden, true);
  assert.equal(target.legacyAvatar.hidden, true);
  renderer.setState(target.actor, 'hit');
  assert.equal(layered.actor.hidden, true);
  renderer.setState(target.actor, 'returning');
  assert.equal(layered.state, 'walk-front');
  assert.equal(layered.actor.hidden, false);
  renderer.setState(target.actor, 'dead');
  assert.equal(layered.state, 'death');
  for (const layer of ['weapon-back', 'weapon-front', 'helmet', 'armor', 'boots']) {
    assert.equal(layered.nodes.get(layer).hidden, true);
  }
  renderer.setState(target.actor, 'ghost');
  assert.equal(layered.state, 'ghost');
});

test('falls back only the affected player when a base asset fails', async () => {
  const warnings = [];
  const renderer = adapter(async (url) => {
    if (url.includes('/base/red/')) throw new Error('base failure');
  }, warnings);
  const red = player(1);
  const green = player(3);
  assert.equal(await renderer.reconcile(reconcileInput(red, commonLoadout)), 'legacy');
  assert.equal(await renderer.reconcile(reconcileInput(green, commonLoadout)), 'layered');
  assert.equal(red.legacyAvatar.hidden, false);
  assert.equal(renderer.recordFor(red.actor).layeredActor.actor.hidden, true);
  assert.equal(green.legacyAvatar.hidden, true);
  assert.ok(warnings.some((warning) => warning.code === 'base_asset_failed' && warning.slotNumber === 1));
});

test('isolates equipment failures and hides both linked steel weapon parts', async () => {
  const warnings = [];
  const renderer = adapter(async (url) => {
    if (url.includes('/leather-cap/')) throw new Error('helmet failure');
    if (url.includes('/steel-sword/idle-back.webp')) throw new Error('linked weapon failure');
  }, warnings);
  const common = player(1);
  const rare = player(2);
  assert.equal(await renderer.reconcile(reconcileInput(common, commonLoadout)), 'layered');
  assert.equal(await renderer.reconcile(reconcileInput(rare, rareLoadout)), 'layered');
  const commonActor = renderer.recordFor(common.actor).layeredActor;
  const rareActor = renderer.recordFor(rare.actor).layeredActor;
  assert.equal(commonActor.nodes.get('helmet').hidden, true);
  assert.equal(commonActor.nodes.get('armor').hidden, false);
  assert.equal(rareActor.nodes.get('weapon-back').hidden, true);
  assert.equal(rareActor.nodes.get('weapon-front').hidden, true);
  assert.ok(warnings.some((warning) => warning.code === 'equipment_asset_failed'));
  assert.ok(warnings.some((warning) => warning.code === 'steel_linked_asset_failed'));
});

test('keeps every node and animation stable across one hundred identical polls', async () => {
  const renderer = adapter();
  const target = player(5);
  await renderer.reconcile(reconcileInput(target, rareLoadout));
  const record = renderer.recordFor(target.actor);
  const container = record.layeredActor.actor;
  const figure = record.layeredActor.figure;
  const nodes = new Map(record.layeredActor.nodes);
  const initial = renderer.diagnostics();

  for (let poll = 0; poll < 100; poll += 1) {
    assert.equal(await renderer.reconcile(reconcileInput(target, rareLoadout)), 'layered');
    renderer.setState(target.actor, 'idle');
  }

  const final = renderer.diagnostics();
  assert.equal(renderer.recordFor(target.actor).layeredActor.actor, container);
  assert.equal(renderer.recordFor(target.actor).layeredActor.figure, figure);
  nodes.forEach((node, layer) => assert.equal(renderer.recordFor(target.actor).layeredActor.nodes.get(layer), node));
  assert.equal(final.layeredActorCreations, initial.layeredActorCreations);
  assert.equal(final.baseLayerCreations, initial.baseLayerCreations);
  assert.equal(final.equipmentLayerCreations, initial.equipmentLayerCreations);
  assert.equal(final.loadoutChanges, initial.loadoutChanges);
  assert.equal(final.stateChanges, initial.stateChanges);
  assert.equal(final.decodeCalls, initial.decodeCalls);
});

test('deduplicates shared equipment decodes across a full six-player party', async () => {
  const renderer = adapter();
  const party = Array.from({ length: 6 }, (_, index) => player(index + 1));
  for (const target of party) {
    await renderer.reconcile(reconcileInput(target, commonLoadout));
  }
  const diagnostics = renderer.diagnostics();
  assert.equal(diagnostics.decodeCalls, 32);
  assert.equal(renderer.loader.cache.size, 32);
  assert.ok(diagnostics.cacheHits > 0);
  assert.equal(diagnostics.layeredActorCreations, 6);
  assert.equal(diagnostics.playerNodeCreations, 6);
});

test('cleans the previous run loadout without replacing the stable outer player nodes', async () => {
  const renderer = adapter();
  const target = player(4);
  await renderer.reconcile(reconcileInput(target, commonLoadout, 'run-one'));
  const oldLayered = renderer.recordFor(target.actor).layeredActor.actor;
  await renderer.reconcile(reconcileInput(target, rareLoadout, 'run-two'));
  const nextLayered = renderer.recordFor(target.actor).layeredActor.actor;
  assert.notEqual(nextLayered, oldLayered);
  assert.equal(oldLayered.parentElement, null);
  assert.equal(target.actor.children[0], target.figure);
  assert.equal(target.figure.children[0], target.legacyAvatar);
  assert.equal(renderer.recordFor(target.actor).loadoutSignature, 'steel-sword|iron-helmet|iron-armor|guard-boots');
});
