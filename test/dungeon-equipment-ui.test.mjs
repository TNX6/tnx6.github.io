import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DungeonEquipmentApi,
  DungeonEquipmentHttpError,
  buildDungeonEquipmentMutationBody,
  compareDungeonEquipment,
  createDungeonEquipmentOperation,
  equipmentErrorMessage,
  filterDungeonEquipmentItems,
  isDungeonEquipmentConcurrencyError,
  isDungeonEquipmentFeatureUnavailable,
  isDungeonEquipmentUnauthenticated,
  loadDungeonEquipmentData,
  normalizeDungeonEquipmentInventory,
  normalizeDungeonEquipmentLoadout,
} from '../src/scripts/dungeon-equipment-model.ts';

const root = new URL('../', import.meta.url);

const bonuses = (attack = 0, defense = 0, health = 0, dodge = 0) => ({ attack, defense, health, dodge });

function item(overrides = {}) {
  return {
    itemKey: 'dungeon.equipment.rusty_sword',
    itemName: 'السيف الصدئ',
    slot: 'weapon',
    rarity: 'common',
    bonuses: bonuses(2),
    ...overrides,
  };
}

function owned(overrides = {}) {
  return {
    ...item(),
    ownedQuantity: 1,
    equipped: false,
    equippedRequiredQuantity: 0,
    unequippedAvailableQuantity: 1,
    ...overrides,
  };
}

function loadout(overrides = {}) {
  return {
    ok: true,
    loadoutVersion: 2,
    slots: { weapon: null, helmet: null, armor: null, boots: null },
    totalBonuses: bonuses(),
    ...overrides,
  };
}

test('normalizes empty and equipped loadouts into the four canonical slots', () => {
  const empty = normalizeDungeonEquipmentLoadout(loadout());
  assert.deepEqual(Object.keys(empty.slots), ['weapon', 'helmet', 'armor', 'boots']);
  assert.equal(
    Object.values(empty.slots).every((value) => value === null),
    true
  );
  assert.deepEqual(empty.totalBonuses, bonuses());

  const equipped = normalizeDungeonEquipmentLoadout(
    loadout({
      slots: { weapon: item(), helmet: null, armor: null, boots: null },
      totalBonuses: bonuses(2),
    })
  );
  assert.equal(equipped.slots.weapon.itemName, 'السيف الصدئ');
  assert.deepEqual(equipped.totalBonuses, bonuses(2));
});

test('keeps quantity two with one equipped copy and one unequipped copy', () => {
  const inventory = normalizeDungeonEquipmentInventory({
    items: [owned({ ownedQuantity: 2, equipped: true, equippedRequiredQuantity: 1, unequippedAvailableQuantity: 1 })],
  });
  assert.deepEqual(
    {
      owned: inventory.items[0].ownedQuantity,
      required: inventory.items[0].equippedRequiredQuantity,
      available: inventory.items[0].unequippedAvailableQuantity,
    },
    { owned: 2, required: 1, available: 1 }
  );
});

test('filters by canonical slot and compares common equipment with rare equipment', () => {
  const common = owned();
  const rare = owned({
    itemKey: 'dungeon.equipment.ember_blade',
    itemName: 'نصل الجمر',
    rarity: 'rare',
    bonuses: bonuses(5, 0, 0, 1),
  });
  const armor = owned({ itemKey: 'dungeon.equipment.leather_armor', slot: 'armor' });
  assert.deepEqual(
    filterDungeonEquipmentItems([common, rare, armor], 'weapon').map((entry) => entry.itemKey),
    [common.itemKey, rare.itemKey]
  );
  assert.deepEqual(
    compareDungeonEquipment(common, rare).map(({ stat, difference }) => [stat, difference]),
    [
      ['attack', 3],
      ['defense', 0],
      ['health', 0],
      ['dodge', 1],
    ]
  );
});

test('builds exact equip and unequip bodies without any identity fields', () => {
  const equipment = owned();
  const equip = createDungeonEquipmentOperation('equip', 'weapon', equipment, () => 'request-equip-0001');
  const unequip = createDungeonEquipmentOperation('unequip', 'weapon', null, () => 'request-unequip-0001');
  assert.deepEqual(buildDungeonEquipmentMutationBody(equip), {
    requestId: 'request-equip-0001',
    slot: 'weapon',
    itemKey: equipment.itemKey,
  });
  assert.deepEqual(buildDungeonEquipmentMutationBody(unequip), {
    requestId: 'request-unequip-0001',
    slot: 'weapon',
  });
  assert.equal(
    JSON.stringify([buildDungeonEquipmentMutationBody(equip), buildDungeonEquipmentMutationBody(unequip)]).includes(
      'userId'
    ),
    false
  );
});

test('reusing an uncertain operation keeps its request ID while another operation gets a new ID', () => {
  const ids = ['request-stable-0001', 'request-new-0002'];
  const equipment = owned();
  const first = createDungeonEquipmentOperation('equip', 'weapon', equipment, () => ids.shift());
  const retryBody = buildDungeonEquipmentMutationBody(first);
  assert.equal(buildDungeonEquipmentMutationBody(first).requestId, retryBody.requestId);
  const second = createDungeonEquipmentOperation('unequip', 'weapon', null, () => ids.shift());
  assert.notEqual(second.requestId, first.requestId);
});

test('loads loadout before inventory and stops before inventory when loadout returns feature 404', async () => {
  const order = [];
  const api = {
    async getLoadout() {
      order.push('loadout');
      return normalizeDungeonEquipmentLoadout(loadout());
    },
    async getInventory() {
      order.push('inventory');
      return normalizeDungeonEquipmentInventory({ items: [] });
    },
  };
  await loadDungeonEquipmentData(api);
  assert.deepEqual(order, ['loadout', 'inventory']);

  let inventoryCalls = 0;
  const hiddenFeature = {
    async getLoadout() {
      throw new DungeonEquipmentHttpError(404, 'NOT_FOUND', 'Not found');
    },
    async getInventory() {
      inventoryCalls += 1;
      return { items: [] };
    },
  };
  await assert.rejects(() => loadDungeonEquipmentData(hiddenFeature), isDungeonEquipmentFeatureUnavailable);
  assert.equal(inventoryCalls, 0);
});

test('maps authentication, concurrency, rate-limit, and mutation errors to safe Arabic copy', () => {
  const unauthenticated = new DungeonEquipmentHttpError(401, 'DUNGEON_EQUIPMENT_UNAUTHENTICATED', 'raw');
  const concurrency = new DungeonEquipmentHttpError(409, 'DUNGEON_EQUIPMENT_CONCURRENCY_CONFLICT', 'raw');
  const limited = new DungeonEquipmentHttpError(429, 'DUNGEON_EQUIPMENT_RATE_LIMITED', 'raw');
  assert.equal(isDungeonEquipmentUnauthenticated(unauthenticated), true);
  assert.equal(isDungeonEquipmentConcurrencyError(concurrency), true);
  assert.match(equipmentErrorMessage(concurrency, 'mutation'), /جلسة أخرى/);
  assert.match(equipmentErrorMessage(limited, 'mutation'), /انتظر قليلًا/);
  assert.equal(equipmentErrorMessage(new Error('SQL secret'), 'mutation').includes('SQL secret'), false);
});

test('Equipment API sends credentialed exact mutation body and supports replaying the same operation', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url: String(url), init });
    return Response.json({
      ...loadout(),
      outcome: 'equipped',
      replayed: requests.length > 1,
      changedSlot: 'weapon',
    });
  };
  const api = new DungeonEquipmentApi('https://api.example.test', fetcher);
  const operation = createDungeonEquipmentOperation('equip', 'weapon', owned(), () => 'request-network-retry-1');
  await api.mutate(operation);
  await api.mutate(operation);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].init.credentials, 'include');
  assert.equal(requests[0].init.headers['Content-Type'], 'application/json');
  assert.equal(requests[0].init.body, requests[1].init.body);
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    requestId: 'request-network-retry-1',
    slot: 'weapon',
    itemKey: 'dungeon.equipment.rusty_sword',
  });
});

test('accepts every documented mutation outcome without changing the request contract', async () => {
  const outcomes = ['equipped', 'replaced', 'already_equipped', 'unequipped', 'already_unequipped'];
  for (const outcome of outcomes) {
    const api = new DungeonEquipmentApi('https://api.example.test', async () =>
      Response.json({ ...loadout(), outcome, replayed: outcome === 'already_equipped', changedSlot: 'weapon' })
    );
    const operation = createDungeonEquipmentOperation('unequip', 'weapon', null, () => `request-${outcome}`);
    const result = await api.mutate(operation);
    assert.equal(result.outcome, outcome);
  }
});

test('renders API text through DOM textContent and never exposes item keys in DOM attributes', async () => {
  const [client, component] = await Promise.all([
    readFile(new URL('src/scripts/dungeon-equipment-client.ts', root), 'utf8'),
    readFile(new URL('src/components/profile/DungeonEquipmentPanel.astro', root), 'utf8'),
  ]);
  assert.doesNotMatch(client, /innerHTML/);
  assert.doesNotMatch(client, /localStorage|sessionStorage/);
  assert.doesNotMatch(client, /dataset\.(?:itemKey|itemkey)|data-item-key/);
  assert.match(client, /textContent = text/);
  assert.match(client, /createDungeonEquipmentOperation\('equip', selected\.slot, selected\)/);
  assert.doesNotMatch(component, /data-item-key|userId|twitchUserId/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /<button[^>]+type="button"/);

  const hostile = normalizeDungeonEquipmentInventory({
    items: [owned({ itemName: '<img src=x onerror=alert(1)>', rarity: '<script>' })],
  });
  assert.equal(hostile.items[0].itemName, '<img src=x onerror=alert(1)>');
});

test('integrates the independent component directly after the existing profile inventory', async () => {
  const profile = await readFile(new URL('src/pages/profile-v2.astro', root), 'utf8');
  assert.match(profile, /import DungeonEquipmentPanel from '~\/components\/profile\/DungeonEquipmentPanel\.astro'/);
  const inventoryPosition = profile.indexOf('<div class="inventory" id="inventory"></div>');
  const equipmentPosition = profile.indexOf('<DungeonEquipmentPanel />');
  const sideStackPosition = profile.indexOf('<aside class="v2-side-stack">');
  assert.ok(inventoryPosition >= 0 && equipmentPosition > inventoryPosition && equipmentPosition < sideStackPosition);
});

test('keeps the owner panel request-driven, non-polling, abortable, and hidden on public profile URLs', async () => {
  const client = await readFile(new URL('src/scripts/dungeon-equipment-client.ts', root), 'utf8');
  assert.match(client, /new URLSearchParams\(location\.search\)\.has\('user'\)/);
  assert.match(client, /new AbortController\(\)/);
  assert.match(client, /window\.addEventListener\('pagehide', cleanup\)/);
  assert.doesNotMatch(client, /setInterval/);
  assert.match(client, /this\.state\.loading = false;[\s\S]{0,900}this\.render\(\)/);
});

test('reloads after concurrency without replaying the failed mutation automatically', async () => {
  const client = await readFile(new URL('src/scripts/dungeon-equipment-client.ts', root), 'utf8');
  assert.match(
    client,
    /isDungeonEquipmentConcurrencyError\(error\)[\s\S]{0,500}this\.state\.pendingOperation = null;[\s\S]{0,500}await this\.loadAfterMutation\(\)/
  );
  assert.doesNotMatch(client, /isDungeonEquipmentConcurrencyError\(error\)[\s\S]{0,500}runMutation\(/);
});
