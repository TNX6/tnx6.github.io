import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUNGEON_NUDGE_MAX_ATTEMPTS,
  DUNGEON_NUDGE_RETRY_MS,
  DUNGEON_NUDGE_RETRY_WINDOW_MS,
  canRetryDungeonLifecycleNudge,
  dungeonLifecycleNudgeClientAction,
  isRetryableDungeonLifecycleNudgeStatus,
} from '../src/scripts/dungeon-overlay-nudge-policy.ts';
import { advanceDungeonRunIfDue } from '../src/scripts/dungeon-overlay-viewer.ts';

function response(overrides = {}) {
  return {
    runId: 'run-1',
    result: 'actively_processing',
    statusBefore: 'running',
    statusAfter: 'running',
    eventsPersisted: 0,
    lifecycleIterations: 0,
    httpStatus: 202,
    ...overrides,
  };
}

test('marks a nudge complete only after events or a terminal result', () => {
  assert.equal(
    dungeonLifecycleNudgeClientAction(
      response({ result: 'events_persisted', statusAfter: 'completed', eventsPersisted: 6 })
    ),
    'complete'
  );
  assert.equal(dungeonLifecycleNudgeClientAction(response()), 'retry');
  assert.equal(
    dungeonLifecycleNudgeClientAction(response({ result: 'terminal_replay', statusAfter: 'failed' })),
    'complete'
  );
});

test('retries three actively-processing responses and completes on the fourth response', () => {
  const responses = [
    response(),
    response(),
    response(),
    response({
      result: 'events_persisted',
      statusAfter: 'completed',
      eventsPersisted: 6,
      httpStatus: 200,
    }),
  ];
  let attempts = 0;
  for (const value of responses) {
    attempts += 1;
    if (dungeonLifecycleNudgeClientAction(value) === 'complete') break;
  }
  assert.equal(attempts, 4);
});

test('treats processing conflicts as retryable and permanent failures as terminal', () => {
  assert.equal(isRetryableDungeonLifecycleNudgeStatus(null), true);
  assert.equal(isRetryableDungeonLifecycleNudgeStatus(409), true);
  assert.equal(isRetryableDungeonLifecycleNudgeStatus(423), true);
  assert.equal(isRetryableDungeonLifecycleNudgeStatus(400), false);
  assert.equal(isRetryableDungeonLifecycleNudgeStatus(404), false);
});

test('keeps retries bounded inside one ten-second scheduler window', () => {
  assert.equal(DUNGEON_NUDGE_RETRY_MS, 750);
  assert.equal(DUNGEON_NUDGE_MAX_ATTEMPTS, 8);
  assert.equal(DUNGEON_NUDGE_RETRY_WINDOW_MS, 10_000);
  assert.ok(DUNGEON_NUDGE_RETRY_MS * DUNGEON_NUDGE_MAX_ATTEMPTS < DUNGEON_NUDGE_RETRY_WINDOW_MS);
  assert.equal(canRetryDungeonLifecycleNudge(0, 0), true);
  assert.equal(canRetryDungeonLifecycleNudge(7, 9_999), true);
  assert.equal(canRetryDungeonLifecycleNudge(8, 6_000), false);
  assert.equal(canRetryDungeonLifecycleNudge(3, 10_000), false);
});

test('parses the production nudge contract for persisted and processing responses', async () => {
  const originalFetch = globalThis.fetch;
  const payloads = [
    new Response(
      JSON.stringify({
        ok: true,
        runId: 'run-1',
        result: 'actively_processing',
        statusBefore: 'running',
        statusAfter: 'running',
        eventsPersisted: 0,
        lifecycleIterations: 1,
      }),
      { status: 202 }
    ),
    new Response(
      JSON.stringify({
        ok: true,
        runId: 'run-1',
        result: 'events_persisted',
        statusBefore: 'joining',
        statusAfter: 'completed',
        eventsPersisted: 6,
        lifecycleIterations: 6,
      }),
      { status: 200 }
    ),
  ];
  globalThis.fetch = async () => payloads.shift();
  try {
    const processing = await advanceDungeonRunIfDue('run-1', new AbortController().signal);
    const completed = await advanceDungeonRunIfDue('run-1', new AbortController().signal);
    assert.equal(processing.httpStatus, 202);
    assert.equal(dungeonLifecycleNudgeClientAction(processing), 'retry');
    assert.equal(completed.httpStatus, 200);
    assert.equal(dungeonLifecycleNudgeClientAction(completed), 'complete');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
