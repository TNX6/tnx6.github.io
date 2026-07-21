import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_PLAYER_ANIMATION_STATES,
  hasActivePlayerAnimation,
  setPlayerAnimationState,
} from '../src/scripts/dungeon-overlay-animation-state.ts';

function animationElement(initialState) {
  let layoutReads = 0;
  return {
    element: {
      dataset: initialState ? { animationState: initialState } : {},
      get offsetWidth() {
        layoutReads += 1;
        return 190;
      },
    },
    layoutReads: () => layoutReads,
  };
}

test('exposes the complete player animation state machine', () => {
  assert.deepEqual(DUNGEON_PLAYER_ANIMATION_STATES, [
    'arriving',
    'idle',
    'entering',
    'inside',
    'returning',
    'hit',
    'dead',
    'ghost',
  ]);
});

test('does not restart the same state during polling updates', () => {
  const fixture = animationElement('idle');
  assert.equal(setPlayerAnimationState(fixture.element, 'idle'), false);
  assert.equal(fixture.element.dataset.animationState, 'idle');
  assert.equal(fixture.layoutReads(), 0);
});

test('can deliberately restart a transient state', () => {
  const fixture = animationElement('hit');
  assert.equal(setPlayerAnimationState(fixture.element, 'hit', true), true);
  assert.equal(fixture.element.dataset.animationState, 'hit');
  assert.equal(fixture.layoutReads(), 1);
});

test('moves through arrival, entry, return, death, and ghost states without classes', () => {
  const fixture = animationElement();
  for (const state of ['arriving', 'idle', 'entering', 'inside', 'returning', 'dead', 'ghost']) {
    assert.equal(setPlayerAnimationState(fixture.element, state), true);
    assert.equal(fixture.element.dataset.animationState, state);
  }
});

test('preserves transient animation state while its deadline is in the future', () => {
  const fixture = animationElement('entering');
  fixture.element.dataset.animationEndsAt = '2000';
  assert.equal(hasActivePlayerAnimation(fixture.element, 1_999), true);
  assert.equal(hasActivePlayerAnimation(fixture.element, 2_000), false);
});
