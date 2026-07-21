import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { hasActivePlayerAnimation } from '../src/scripts/dungeon-overlay-animation-state.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const clientSource = readFileSync(`${projectRoot}src/scripts/dungeon-overlay-client.ts`, 'utf8');
const overlayCss = readFileSync(`${projectRoot}src/assets/styles/dungeon-overlay.css`, 'utf8');

test('real entry waits for walk-back and records entering as a timed transient state', () => {
  assert.match(clientSource, /ensureActorStateAsset\(slot, 'walkBackSheet'\)/);
  assert.match(
    clientSource,
    /startTransientPlayerState\(slot, 'entering', 'inside', PARTY_ENTRY_DURATION_MS, schedule\)/
  );
});

test('polling preserves entering instead of resetting it to idle', () => {
  const actor = { dataset: { animationState: 'entering', animationEndsAt: '5000' } };
  assert.equal(hasActivePlayerAnimation(actor, 4_000), true);
  assert.match(clientSource, /if \(hasActiveTransientPlayerState\(slot\)\) return;/);
});

test('actor readiness hides sprite, shadow, and meta as one unit', () => {
  assert.match(overlayCss, /\.dov-player-actor\[data-visual-ready='false'\]/);
  assert.match(clientSource, /actor\.dataset\.visualReady = 'true'/);
  assert.doesNotMatch(clientSource, /replaceChildren\([^)]*dov-player-actor/);
});
