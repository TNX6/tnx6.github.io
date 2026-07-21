import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginDungeonTerminalFade,
  dungeonTerminalDescription,
  DUNGEON_TERMINAL_FADE_MS,
  formatDungeonXp,
  normalizeDungeonViewerText,
} from '../src/scripts/dungeon-overlay-presentation.ts';

function fadeFixture() {
  const classes = new Set();
  const scheduled = [];
  let hidden = false;
  const target = {
    classList: {
      add: (value) => classes.add(value),
      remove: (value) => classes.delete(value),
    },
  };
  const schedule = (delayMs, callback) => scheduled.push({ delayMs, callback });
  return { classes, scheduled, target, schedule, hidden: () => hidden, hide: () => (hidden = true) };
}

test('formats XP in an isolated left-to-right friendly order', () => {
  assert.equal(formatDungeonXp(5), '+5 XP');
  assert.equal(formatDungeonXp(65), '+65 XP');
  assert.equal(formatDungeonXp(1000), '+1000 XP');
});

test('uses concise result copy and replaces the internal planned-loot phrase', () => {
  assert.equal(dungeonTerminalDescription(true, 0), 'لم يتمكن الفريق من إكمال الدنجن.');
  assert.equal(dungeonTerminalDescription(false, 2), 'عثر الناجون على غنائم داخل الدنجن.');
  assert.equal(normalizeDungeonViewerText('عثر الناجون على غنائم مخطط لها'), 'عثر الناجون على غنائم داخل الدنجن');
});

test('keeps the terminal visible until the full 400ms fade completes', () => {
  const fixture = fadeFixture();
  beginDungeonTerminalFade(fixture.target, fixture.schedule, fixture.hide);
  assert.equal(fixture.classes.has('dov-overlay--leaving'), true);
  assert.equal(fixture.hidden(), false);
  assert.equal(fixture.scheduled[0].delayMs, DUNGEON_TERMINAL_FADE_MS);
  fixture.scheduled[0].callback();
  assert.equal(fixture.hidden(), true);
});

test('a new run can cancel an older terminal fade before it hides the overlay', () => {
  const fixture = fadeFixture();
  const cancel = beginDungeonTerminalFade(fixture.target, fixture.schedule, fixture.hide);
  cancel();
  assert.equal(fixture.classes.has('dov-overlay--leaving'), false);
  fixture.scheduled[0].callback();
  assert.equal(fixture.hidden(), false);
});
