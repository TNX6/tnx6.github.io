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

test('sends an exact bodyless browser POST and parses every production nudge result', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    { result: 'actively_processing', status: 202, ok: true, action: 'retry' },
    { result: 'events_persisted', status: 200, ok: true, action: 'complete', eventsPersisted: 6 },
    { result: 'terminal_replay', status: 200, ok: true, action: 'complete' },
    { result: 'not_due', status: 409, ok: false, action: 'stop' },
    { result: 'run_not_active', status: 409, ok: false, action: 'stop' },
  ];
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input, init });
    const current = cases[requests.length - 1];
    return new Response(
      JSON.stringify({
        ok: current.ok,
        runId: 'run-1',
        result: current.result,
        statusBefore: current.result === 'events_persisted' ? 'joining' : 'running',
        statusAfter: current.result === 'events_persisted' ? 'completed' : 'running',
        eventsPersisted: current.eventsPersisted ?? 0,
        lifecycleIterations: current.eventsPersisted ?? 0,
      }),
      { status: current.status }
    );
  };
  try {
    for (const expected of cases) {
      const result = await advanceDungeonRunIfDue('run-1', new AbortController().signal);
      assert.equal(result.result, expected.result);
      assert.equal(result.httpStatus, expected.status);
      assert.equal(dungeonLifecycleNudgeClientAction(result), expected.action);
    }
    assert.equal(requests.length, cases.length);
    for (const { input, init } of requests) {
      assert.match(String(input), /\/api\/dungeon\/runs\/run-1\/advance-if-due$/);
      assert.equal(init.method, 'POST');
      assert.equal(init.body, undefined);
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Accept'), 'application/json');
      assert.equal(headers.get('Content-Type'), null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a real HTTP 400 is permanent and cannot be treated as a completed nudge', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'DUNGEON_LIFECYCLE_NUDGE_INVALID_REQUEST', message: 'invalid' },
      }),
      { status: 400 }
    );
  try {
    await assert.rejects(
      advanceDungeonRunIfDue('run-1', new AbortController().signal),
      (error) => error?.status === 400
    );
    assert.equal(isRetryableDungeonLifecycleNudgeStatus(400), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
