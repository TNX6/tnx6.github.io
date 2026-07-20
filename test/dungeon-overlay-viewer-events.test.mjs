import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchDungeonRunEvents } from '../src/scripts/dungeon-overlay-viewer.ts';

test('preserves safe event player slots for targeted hit reactions', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ok: true,
        runId: 'run-players',
        events: [
          {
            sequenceNumber: 2,
            stage: 'encounter',
            title: 'هجوم',
            message: 'أصيب اللاعب',
            severity: 'danger',
            outcome: 'hit',
            visibleAt: '2026-07-20T12:00:00Z',
            players: [{ slotNumber: 3, displayName: 'تنكس' }],
          },
          {
            sequenceNumber: 1,
            stage: 'entrance',
            title: 'الدخول',
            message: 'دخل الفريق',
            severity: 'info',
            outcome: 'entered',
            visibleAt: '2026-07-20T11:59:55Z',
          },
        ],
      })
    );

  try {
    const events = await fetchDungeonRunEvents('run-players', new AbortController().signal);
    assert.deepEqual(
      events.map((event) => event.sequenceNumber),
      [1, 2]
    );
    assert.deepEqual(events[0].players, []);
    assert.deepEqual(events[1].players, [{ slotNumber: 3, displayName: 'تنكس' }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
