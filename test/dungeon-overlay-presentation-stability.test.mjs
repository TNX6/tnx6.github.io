import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { setPlayerAnimationState } from '../src/scripts/dungeon-overlay-animation-state.ts';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const client = readFileSync(`${projectRoot}src/scripts/dungeon-overlay-client.ts`, 'utf8');
const css = readFileSync(`${projectRoot}src/assets/styles/dungeon-overlay.css`, 'utf8');
const astro = readFileSync(`${projectRoot}src/pages/overlays/dungeon.astro`, 'utf8');

function functionBody(name) {
  const start = client.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const nextFunction = /\n {2}(?:async )?function /g;
  nextFunction.lastIndex = start + 10;
  const next = nextFunction.exec(client)?.index ?? -1;
  return client.slice(start, next === -1 ? client.length : next);
}

test('keeps the six player actors mounted and reconciles slot classes without replacing nodes', () => {
  assert.match(astro, /const slots = Array\.from\(\{ length: 6 \}/);
  assert.match(astro, /slots\.map\(\(slot\) =>/);
  assert.match(astro, /class="dov-player-actor"/);
  const setPlayer = functionBody('setPlayer');
  assert.doesNotMatch(setPlayer, /slot\.className\s*=/);
  assert.match(setPlayer, /slot\.classList\.remove\('dov-slot--empty'\)/);
  assert.match(setPlayer, /slot\.classList\.toggle\('dov-slot--opener'/);
  assert.match(client, /presentationKey: `\$\{currentRunId \?\? 'unknown-run'\}:slot:\$\{participant\.slotNumber\}`/);
  assert.match(client, /player\.presentationKey \?\? `demo:slot:/);
  assert.doesNotMatch(client, /replaceChildren\([^)]*dov-player-actor/);
});

test('does not restart idle when one hundred identical polls request the same state', () => {
  let layoutReads = 0;
  const actor = {
    dataset: { animationState: 'idle' },
    get offsetWidth() {
      layoutReads += 1;
      return 190;
    },
  };
  for (let poll = 0; poll < 100; poll += 1) {
    assert.equal(setPlayerAnimationState(actor, 'idle'), false);
  }
  assert.equal(layoutReads, 0);
  assert.equal(actor.dataset.animationState, 'idle');
});

test('runs entry once and restores a running page directly to hidden inside actors', () => {
  const entry = functionBody('presentPartyEntryOnce');
  const recovery = functionBody('restoreRunningParticipantsInside');
  assert.match(entry, /if \(entryPresentedRunId === runId\)/);
  assert.match(entry, /sendPartyInside\(runLater\)/);
  assert.match(recovery, /setSlotAnimationState\(slot, 'inside'\)/);
  assert.doesNotMatch(recovery, /sendPartyInside|startTransientPlayerState/);
});

test('keeps event effects separate from player visibility and deduplicates by run and sequence', () => {
  const eventMotion = functionBody('triggerEventMotion');
  const eventScene = functionBody('prepareRealEventScene');
  assert.doesNotMatch(eventMotion, /setPlayer|animationState|playerActor|\.style|\.dataset/);
  assert.doesNotMatch(eventScene, /setSlotAnimationState|setPlayerAnimationState|playerActor/);
  assert.match(client, /const eventKey = `\$\{currentRunId \?\? 'unknown-run'\}:\$\{event\.sequenceNumber\}`/);
  assert.match(client, /if \(processedEventKeys\.has\(eventKey\)\) return/);
  assert.match(client, /processedEventKeys\.clear\(\)/);
});

test('removes the event feed from terminal layout and skips recovered terminal feed hydration', () => {
  assert.match(css, /\.dov-event-feed--hidden\s*{\s*opacity:\s*0/);
  assert.match(css, /\.dov-overlay--terminal \.dov-event-feed\s*{\s*display:\s*none !important/);
  assert.match(client, /eventFeed\.replaceChildren\(\);\s*eventFeed\.hidden = true/);
  assert.match(client, /syncEvents\(events, openedDuringTerminal, false\)/);
  assert.doesNotMatch(client, /terminal\.rewardEvents\.forEach/);
});

test('registers the two-player long-poll visual regression demo', () => {
  assert.match(client, /'presentation-stability-regression'/);
  assert.match(client, /for \(let poll = 1; poll <= 30; poll \+= 1\)/);
  assert.match(client, /RUN_EVENTS\.slice\(0, 4\)/);
});
