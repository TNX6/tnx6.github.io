import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildDungeonRewardFeedItems,
  buildDungeonTerminalPresentation,
  DUNGEON_EVENT_FEED_LIMIT,
  DungeonEventFeedStore,
  dungeonViewerEventToFeedItem,
} from '../src/scripts/dungeon-overlay-feed.ts';
import { normalizeDungeonViewerText } from '../src/scripts/dungeon-overlay-presentation.ts';

const root = new URL('../', import.meta.url);

function event(sequenceNumber, overrides = {}) {
  return {
    sequenceNumber,
    stage: 'encounter',
    title: `حدث ${sequenceNumber}`,
    message: `تفاصيل ${sequenceNumber}`,
    severity: 'info',
    outcome: 'continued',
    visibleAt: '2026-07-21T00:00:00.000Z',
    players: [],
    ...overrides,
  };
}

function summary() {
  return {
    id: 'run-summary',
    status: 'completed',
    serverNow: '2026-07-21T00:00:00.000Z',
    startedAt: '2026-07-20T23:59:00.000Z',
    completedAt: '2026-07-21T00:00:00.000Z',
    result: 'completed',
    participants: [
      { slotNumber: 1, displayName: 'تنكس', level: 1, status: 'survived', survived: true, isOpener: true },
      { slotNumber: 2, displayName: 'tnx66', level: 2, status: 'dead', survived: false, isOpener: false },
      { slotNumber: 3, displayName: 'خالد', level: 3, status: 'survived', survived: true, isOpener: false },
    ],
    rewards: [
      {
        displayName: 'تنكس',
        xp: 65,
        materials: [
          { itemName: 'شظية حديد', quantity: 1 },
          { itemName: 'Cave Wood', quantity: 2 },
        ],
      },
      { displayName: 'خالد', xp: 5, materials: [] },
    ],
  };
}

test('deduplicates event IDs and keeps the newest four in chronological DOM order', () => {
  const store = new DungeonEventFeedStore();
  const items = Array.from({ length: 7 }, (_, index) => dungeonViewerEventToFeedItem('run-feed', event(index + 1)));
  items.forEach((item) => store.append(item));
  assert.equal(store.append(items[6]).added, false);
  assert.equal(DUNGEON_EVENT_FEED_LIMIT, 4);
  assert.deepEqual(
    store.values().map((item) => item.id),
    items.slice(3).map((item) => item.id)
  );
});

test('hydrates recovered events without losing deduplication and resets between runs', () => {
  const store = new DungeonEventFeedStore();
  const recovered = Array.from({ length: 5 }, (_, index) => dungeonViewerEventToFeedItem('run-old', event(index + 1)));
  assert.deepEqual(
    store.hydrate(recovered).map((item) => item.id),
    recovered.slice(1).map((item) => item.id)
  );
  assert.equal(store.append(recovered[4]).added, false);
  store.reset();
  const nextRun = dungeonViewerEventToFeedItem('run-new', event(1));
  assert.equal(store.append(nextRun).added, true);
  assert.deepEqual(
    store.values().map((item) => item.id),
    [nextRun.id]
  );
});

test('maps a targeted event to the public player name without exposing a slot label', () => {
  const item = dungeonViewerEventToFeedItem(
    'run-player',
    event(3, {
      stage: 'trap',
      title: 'فخ حجري',
      message: 'وقع في الممر الضيق.',
      severity: 'danger',
      outcome: 'hit',
      players: [{ slotNumber: 2, displayName: 'tnx66' }],
    })
  );
  assert.match(item.text, /^tnx66:/);
  assert.equal(item.text.includes('slot'), false);
  assert.deepEqual(item.playerSlots, [2]);
  assert.equal(item.tone, 'danger');
});

test('builds deterministic reward events and prevents reward replay after polling', () => {
  const runSummary = summary();
  const first = buildDungeonRewardFeedItems(runSummary);
  const second = buildDungeonRewardFeedItems(runSummary);
  assert.deepEqual(
    first.map((item) => item.id),
    second.map((item) => item.id)
  );
  assert.equal(
    first.some((item) => item.isolatedText === '+65 XP'),
    true
  );
  expectRewardXpItem(
    first.find((item) => item.isolatedText === '+65 XP'),
    'تنكس',
    '+65 XP'
  );
  assert.equal(
    first.some((item) => item.text.includes('شظية حديد ×1')),
    true
  );
  const store = new DungeonEventFeedStore(20);
  first.forEach((item) => assert.equal(store.append(item).added, true));
  second.forEach((item) => assert.equal(store.append(item).added, false));
});

function expectRewardXpItem(item, playerName, xpText) {
  assert.ok(item);
  assert.equal(item.playerName, playerName);
  assert.equal(item.actionText, 'حصل على');
  assert.equal(item.isolatedText, xpText);
  return item;
}

test('keeps Arabic and English player names separate from LTR XP values', () => {
  const runSummary = summary();
  runSummary.rewards = [
    { displayName: 'تنكس', xp: 5, materials: [] },
    { displayName: 'tnx66', xp: 65, materials: [] },
    { displayName: 'خالد', xp: 1000, materials: [] },
  ];
  const items = buildDungeonRewardFeedItems(runSummary);
  expectRewardXpItem(items[0], 'تنكس', '+5 XP');
  expectRewardXpItem(items[1], 'tnx66', '+65 XP');
  expectRewardXpItem(items[2], 'خالد', '+1000 XP');
});

test('builds a safe six-row terminal model only from summary rewards', () => {
  const presentation = buildDungeonTerminalPresentation(summary());
  assert.equal(presentation.survivors, 2);
  assert.equal(presentation.deaths, 1);
  assert.equal(presentation.description, 'نجا 2 من أصل 3 لاعبين، ومات 1.');
  assert.equal(presentation.rows.length, 3);
  assert.deepEqual(presentation.rows[0], {
    key: 'slot:1',
    displayName: 'تنكس',
    status: 'نجا',
    xpText: '+65 XP',
    materials: ['شظية حديد ×1', 'Cave Wood ×2'],
  });
  assert.equal(presentation.rows[1].xpText, null);
  assert.deepEqual(presentation.rows[1].materials, []);
  assert.equal(JSON.stringify(presentation).includes('undefined'), false);
});

test('cleans known internal copy without inventing additional events', () => {
  const sources = ['غنائم مخطط لها', 'planned loot', 'reward planned', 'placeholder', 'demo reward'];
  sources.forEach((source) => {
    const normalized = normalizeDungeonViewerText(source);
    assert.equal(/غنائم مخطط لها|planned loot|reward planned|placeholder|demo reward/iu.test(normalized), false);
  });
});

test('uses differential feed updates, isolated XP direction, and registers both regression demos', async () => {
  const [client, css, astro] = await Promise.all([
    readFile(new URL('src/scripts/dungeon-overlay-client.ts', root), 'utf8'),
    readFile(new URL('src/assets/styles/dungeon-overlay.css', root), 'utf8'),
    readFile(new URL('src/pages/overlays/dungeon.astro', root), 'utf8'),
  ]);
  assert.match(client, /eventFeed\.append\(node\)/);
  assert.match(client, /hydrateEventFeed\(events\.slice\(-4\)/);
  assert.match(client, /playerName\.className = 'dov-event-feed__player'/);
  assert.match(client, /xp\.dir = 'ltr'/);
  assert.match(client, /item\.append\(name, status, xp, materials\)/);
  assert.match(css, /\.dov-event-feed__isolated[\s\S]*unicode-bidi:\s*isolate/);
  assert.match(css, /data-feed-age='1'[\s\S]*opacity:\s*0\.82/);
  assert.match(css, /data-feed-age='2'[\s\S]*opacity:\s*0\.62/);
  assert.match(css, /\.dov-overlay--terminal \.dov-event-feed\s*{\s*display:\s*none !important/);
  assert.match(css, /\.dov-event-feed--hidden\s*{\s*opacity:\s*0/);
  assert.match(client, /hideEventFeedForTerminal\(runLater/);
  assert.doesNotMatch(client, /terminal\.rewardEvents\.forEach/);
  assert.match(css, /grid-template-areas:\s*'name status xp materials'/);
  assert.match(astro, /id="dovEventFeed"[\s\S]*role="log"/);
  assert.match(client, /'event-feed-regression'/);
  assert.match(client, /'reward-summary-regression'/);
});
