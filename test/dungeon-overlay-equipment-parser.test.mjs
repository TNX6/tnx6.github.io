import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeViewerVisualLoadout,
  parseViewerVisualLoadout,
} from '../src/scripts/dungeon-overlay-equipment-adapter.ts';
import { fetchActiveDungeonRun } from '../src/scripts/dungeon-overlay-viewer.ts';

const fullCommon = {
  weapon: { spriteKey: 'rusty-sword' },
  helmet: { spriteKey: 'leather-cap' },
  armor: { spriteKey: 'patched-leather' },
  boots: { spriteKey: 'traveler-boots' },
};

const fullRare = {
  weapon: { spriteKey: 'steel-sword' },
  helmet: { spriteKey: 'iron-helmet' },
  armor: { spriteKey: 'iron-armor' },
  boots: { spriteKey: 'guard-boots' },
};

function layered(value, slotNumber = 1) {
  const normalized = normalizeViewerVisualLoadout(value, true, slotNumber);
  assert.equal(normalized.mode, 'layered');
  return normalized;
}

test('distinguishes absent and null from a valid empty layered loadout', () => {
  assert.deepEqual(normalizeViewerVisualLoadout(undefined, false, 1), { mode: 'legacy' });
  assert.deepEqual(normalizeViewerVisualLoadout(null, true, 1), { mode: 'legacy' });
  assert.deepEqual(layered({}), {
    mode: 'layered',
    loadout: { weapon: null, helmet: null, armor: null, boots: null },
    signature: '|||',
  });
});

test('normalizes full common, full rare, and mixed loadouts through the manifest', () => {
  assert.deepEqual(layered(fullCommon).loadout, {
    weapon: 'dungeon.equipment.weapon.rusty_sword',
    helmet: 'dungeon.equipment.helmet.leather_cap',
    armor: 'dungeon.equipment.armor.patched_leather',
    boots: 'dungeon.equipment.boots.traveler_boots',
  });
  assert.deepEqual(layered(fullRare).loadout, {
    weapon: 'dungeon.equipment.weapon.steel_sword',
    helmet: 'dungeon.equipment.helmet.iron_helmet',
    armor: 'dungeon.equipment.armor.iron_armor',
    boots: 'dungeon.equipment.boots.guard_boots',
  });
  assert.deepEqual(
    layered({
      weapon: fullRare.weapon,
      helmet: fullCommon.helmet,
      armor: null,
      boots: fullRare.boots,
    }).loadout,
    {
      weapon: 'dungeon.equipment.weapon.steel_sword',
      helmet: 'dungeon.equipment.helmet.leather_cap',
      armor: null,
      boots: 'dungeon.equipment.boots.guard_boots',
    }
  );
});

test('drops unknown, wrong-slot, traversal, URL, itemKey, and primitive values locally', () => {
  const normalized = layered({
    weapon: { spriteKey: 'leather-cap' },
    helmet: { spriteKey: '../iron-helmet' },
    armor: { spriteKey: 'https://example.com/armor.webp' },
    boots: { itemKey: 'dungeon.equipment.boots.guard_boots' },
    ignored: '<img src=x onerror=alert(1)>',
  });
  assert.deepEqual(normalized.loadout, { weapon: null, helmet: null, armor: null, boots: null });
  assert.deepEqual(layered({ weapon: 7, helmet: true, armor: [], boots: '<style>' }).loadout, {
    weapon: null,
    helmet: null,
    armor: null,
    boots: null,
  });
  assert.deepEqual(normalizeViewerVisualLoadout(fullCommon, true, 7), { mode: 'legacy' });
});

test('sanitizes partial viewer objects and ignores extra fields', () => {
  assert.deepEqual(parseViewerVisualLoadout({ weapon: { spriteKey: 'rusty-sword', url: 'bad' }, extra: 'ignored' }), {
    weapon: { spriteKey: 'rusty-sword' },
    helmet: null,
    armor: null,
    boots: null,
  });
  assert.equal(parseViewerVisualLoadout('rusty-sword'), null);
});

test('keeps the optional field absent for V1 and preserves null/object semantics additively', async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [
    {
      slotNumber: 1,
      displayName: 'Legacy',
      level: 1,
    },
    {
      slotNumber: 2,
      displayName: 'Fallback',
      level: 2,
      visualLoadout: null,
    },
    {
      slotNumber: 3,
      displayName: 'Layered',
      level: 3,
      visualLoadout: { ...fullCommon, unknownField: 'ignored' },
    },
  ];
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        run: {
          id: 'viewer-v2',
          status: 'joining',
          serverNow: '2026-07-23 12:00:00',
          maxPlayers: 6,
          joinedPlayers: 3,
          remainingSlots: 3,
          registrationClosesAt: '2026-07-23 12:01:00',
          secondsRemaining: 60,
          participants: payloads,
          futureField: { ignored: true },
        },
      })
    );

  try {
    const run = await fetchActiveDungeonRun(new AbortController().signal);
    assert.ok(run);
    assert.equal(Object.hasOwn(run.participants[0], 'visualLoadout'), false);
    assert.equal(Object.hasOwn(run.participants[1], 'visualLoadout'), true);
    assert.equal(run.participants[1].visualLoadout, null);
    assert.deepEqual(run.participants[2].visualLoadout, fullCommon);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
