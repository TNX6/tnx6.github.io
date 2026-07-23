import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_EQUIPMENT_ASSET_MANIFEST,
  DUNGEON_EQUIPMENT_PRODUCTION_ROOT,
  validateDungeonEquipmentManifest,
} from '../src/scripts/dungeon-equipment-assets.ts';

const expected = [
  ['dungeon.equipment.weapon.rusty_sword', 'rusty-sword', 'weapon', 'common'],
  ['dungeon.equipment.weapon.steel_sword', 'steel-sword', 'weapon', 'rare'],
  ['dungeon.equipment.helmet.leather_cap', 'leather-cap', 'helmet', 'common'],
  ['dungeon.equipment.helmet.iron_helmet', 'iron-helmet', 'helmet', 'rare'],
  ['dungeon.equipment.armor.patched_leather', 'patched-leather', 'armor', 'common'],
  ['dungeon.equipment.armor.iron_armor', 'iron-armor', 'armor', 'rare'],
  ['dungeon.equipment.boots.traveler_boots', 'traveler-boots', 'boots', 'common'],
  ['dungeon.equipment.boots.guard_boots', 'guard-boots', 'boots', 'rare'],
];

test('defines the eight canonical equipment assets without legacy keys or gameplay stats', () => {
  assert.equal(DUNGEON_EQUIPMENT_ASSET_MANIFEST.length, 8);
  assert.deepEqual(
    DUNGEON_EQUIPMENT_ASSET_MANIFEST.map(({ itemKey, spriteKey, slot, rarity }) => [itemKey, spriteKey, slot, rarity]),
    expected
  );
  const serialized = JSON.stringify(DUNGEON_EQUIPMENT_ASSET_MANIFEST);
  assert.doesNotMatch(serialized, /legacy|attack|defense|health|dodge|stats|bonus/i);
});

test('keeps item and sprite identities unique with safe future production paths', () => {
  const itemKeys = DUNGEON_EQUIPMENT_ASSET_MANIFEST.map((item) => item.itemKey);
  const spriteKeys = DUNGEON_EQUIPMENT_ASSET_MANIFEST.map((item) => item.spriteKey);
  assert.equal(new Set(itemKeys).size, itemKeys.length);
  assert.equal(new Set(spriteKeys).size, spriteKeys.length);
  assert.deepEqual(validateDungeonEquipmentManifest(), []);

  for (const item of DUNGEON_EQUIPMENT_ASSET_MANIFEST) {
    for (const paths of Object.values(item.paths)) {
      for (const assetPath of Object.values(paths)) {
        assert.ok(assetPath.startsWith(`${DUNGEON_EQUIPMENT_PRODUCTION_ROOT}/items/${item.spriteKey}/`));
        assert.doesNotMatch(assetPath, /\.\.|\\/);
      }
    }
  }
});

test('enforces front-only or split weapons and main-only wearable slots', () => {
  const rusty = DUNGEON_EQUIPMENT_ASSET_MANIFEST[0];
  const steel = DUNGEON_EQUIPMENT_ASSET_MANIFEST[1];
  assert.deepEqual(rusty.layers, { back: false, main: false, front: true });
  assert.deepEqual(steel.layers, { back: true, main: false, front: true });
  assert.equal(steel.linkedWeaponParts, true);
  for (const item of DUNGEON_EQUIPMENT_ASSET_MANIFEST.slice(2)) {
    assert.deepEqual(item.layers, { back: false, main: true, front: false });
  }
});
