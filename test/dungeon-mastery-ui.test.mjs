import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  DungeonMasteryApi,
  DungeonMasteryContractError,
  DungeonMasteryHttpError,
  dungeonMasteryErrorMessage,
  isDungeonMasteryFeatureUnavailable,
  isDungeonMasteryRetryable,
  isDungeonMasteryUnauthenticated,
  normalizeDungeonMasteryResponse,
} from '../src/scripts/dungeon-mastery-model.ts';

const root = new URL('../', import.meta.url);
const fixtureUrl = new URL('test/fixtures/dungeon-mastery-overview-v1.json', root);
const fixtureBytes = await readFile(fixtureUrl);
const fixture = JSON.parse(fixtureBytes.toString('utf8'));

function clone(value) {
  return structuredClone(value);
}

function invalid(mutator, source = fixture.cases.midRank) {
  const value = clone(source);
  mutator(value);
  assert.throws(() => normalizeDungeonMasteryResponse(value), DungeonMasteryContractError);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

class MasteryTestElement extends EventTarget {
  constructor() {
    super();
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.classList = { contains: () => false };
    this.selectors = new Map();
    this.attributes = new Map();
  }

  querySelector(selector) {
    return this.selectors.get(selector) ?? null;
  }

  append(...children) {
    this.children.push(...children);
  }

  click() {
    if (this.hidden || this.disabled) return;
    this.dispatchEvent(new Event('click'));
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  get childElementCount() {
    return this.children.length;
  }
}

class MasteryTestDocument extends EventTarget {
  constructor(profileView, rootElement) {
    super();
    this.profileView = profileView;
    this.rootElement = rootElement;
  }

  querySelector(selector) {
    if (selector === '#profileView') return this.profileView;
    if (selector === '[data-dungeon-mastery-root]') return this.rootElement;
    return null;
  }

  querySelectorAll(selector) {
    return selector === '[data-dungeon-mastery-root]' ? [this.rootElement] : [];
  }

  createElement() {
    return new MasteryTestElement();
  }

  replaceRoot(profileView, rootElement) {
    this.profileView = profileView;
    this.rootElement = rootElement;
  }
}

class MasteryTestWindow extends EventTarget {
  constructor() {
    super();
    this.listenerCounts = new Map();
  }

  addEventListener(type, listener, options) {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) + 1);
    super.addEventListener(type, listener, options);
  }

  listenerCount(type) {
    return this.listenerCounts.get(type) ?? 0;
  }
}

class MasteryTestMutationObserver {
  observe() {}
  disconnect() {}
}

const masterySelectors = [
  '[data-dma-loading]',
  '[data-dma-login]',
  '[data-dma-error]',
  '[data-dma-body]',
  '[data-dma-retry]',
  '[data-dma-refresh]',
  '[data-dma-announcer]',
  '[data-dma-unlocks]',
  '[data-dma-grants]',
  '[data-dma-rank]',
  '[data-dma-progress]',
  '[data-dma-stars]',
  '[data-dma-unlock-count]',
  '[data-dma-rank-percent]',
  '[data-dma-rank-next]',
  '[data-dma-rank-remaining]',
  '[data-dma-legacy-percent]',
  '[data-dma-legacy-next]',
  '[data-dma-legacy-remaining]',
  '[data-dma-rank-progressbar]',
  '[data-dma-rank-fill]',
  '[data-dma-legacy-progressbar]',
  '[data-dma-legacy-fill]',
  '[data-dma-rank-active]',
  '[data-dma-rank-complete]',
  '[data-dma-legacy]',
  '[data-dma-unlocks-empty]',
  '[data-dma-grants-empty]',
  '[data-dma-error-message]',
];

let masteryHarnessSequence = 0;
let compiledMasteryClient;

function createMasteryTestRoot() {
  const rootElement = new MasteryTestElement();
  const profileView = new MasteryTestElement();
  const elements = new Map(masterySelectors.map((selector) => [selector, new MasteryTestElement()]));
  rootElement.selectors = elements;
  rootElement.dataset.apiBase = 'https://api.tnx6.xyz';
  rootElement.hidden = true;
  for (const selector of ['[data-dma-login]', '[data-dma-error]', '[data-dma-body]', '[data-dma-retry]']) {
    elements.get(selector).hidden = true;
  }
  elements.get('[data-dma-refresh]').disabled = true;
  elements.get('[data-dma-rank-complete]').hidden = true;
  elements.get('[data-dma-legacy]').hidden = true;
  elements.get('[data-dma-unlocks-empty]').hidden = true;
  elements.get('[data-dma-grants-empty]').hidden = true;
  return {
    rootElement,
    profileView,
    elements,
    node: (selector) => elements.get(selector),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function settleMasteryLifecycle() {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

async function executableMasteryClientSource() {
  if (compiledMasteryClient) return compiledMasteryClient;
  const [typescript, source] = await Promise.all([
    import('typescript'),
    readFile(new URL('../src/scripts/dungeon-mastery-client.ts', import.meta.url), 'utf8'),
  ]);
  const transpiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
  }).outputText;
  const modelUrl = new URL('../src/scripts/dungeon-mastery-model.ts', import.meta.url).href;
  compiledMasteryClient = transpiled.replace("'./dungeon-mastery-model'", `'${modelUrl}'`);
  return compiledMasteryClient;
}

async function createMasteryLifecycleHarness({ publicProfile = false } = {}) {
  const previousGlobals = new Map(
    ['window', 'document', 'MutationObserver', 'fetch'].map((name) => [
      name,
      { present: Object.hasOwn(globalThis, name), value: globalThis[name] },
    ])
  );
  let currentRoot = createMasteryTestRoot();
  const document = new MasteryTestDocument(currentRoot.profileView, currentRoot.rootElement);
  const window = new MasteryTestWindow();
  let currentLocation = new URL(
    publicProfile ? 'https://tnx6.xyz/profile-v2?user=public-user' : 'https://tnx6.xyz/profile-v2'
  );
  Object.defineProperty(window, 'location', { get: () => currentLocation });

  const requests = [];
  globalThis.window = window;
  globalThis.document = document;
  globalThis.MutationObserver = MasteryTestMutationObserver;
  globalThis.fetch = (input, init) => {
    const pending = deferred();
    requests.push({ input, init, ...pending });
    return pending.promise;
  };

  const clientSource = `${await executableMasteryClientSource()}\n// F04 harness ${++masteryHarnessSequence}`;
  const client = await import(`data:text/javascript;base64,${Buffer.from(clientSource).toString('base64')}`);
  client.installDungeonMasteryPanels();

  const transition = (url) => {
    currentLocation = new URL(url);
    window.dispatchEvent(new Event('tnx:profile-route-change'));
  };

  return {
    requests,
    get rootElement() {
      return currentRoot.rootElement;
    },
    node: (selector) => currentRoot.node(selector),
    setPublic: (user = 'public-user') => transition(`https://tnx6.xyz/profile-v2?user=${user}`),
    setSelf: () => transition('https://tnx6.xyz/profile-v2'),
    routeEvent: () => window.dispatchEvent(new Event('tnx:profile-route-change')),
    listenerCount: (type) => window.listenerCount(type),
    swapToNewRoot({ publicProfile: nextPublicProfile = false } = {}) {
      const previousRoot = currentRoot;
      currentLocation = new URL(
        nextPublicProfile ? 'https://tnx6.xyz/profile-v2?user=next-public-user' : 'https://tnx6.xyz/profile-v2'
      );
      currentRoot = createMasteryTestRoot();
      document.replaceRoot(currentRoot.profileView, currentRoot.rootElement);
      document.dispatchEvent(new Event('astro:after-swap'));
      document.dispatchEvent(new Event('astro:page-load'));
      return previousRoot;
    },
    async respond(index, body, status = 200) {
      requests[index].resolve(jsonResponse(body, status));
      await settleMasteryLifecycle();
    },
    async reject(index, error) {
      requests[index].reject(error);
      await settleMasteryLifecycle();
    },
    teardown() {
      document.dispatchEvent(new Event('astro:before-swap'));
    },
    cleanup() {
      document.dispatchEvent(new Event('astro:before-swap'));
      for (const [name, prior] of previousGlobals) {
        if (prior.present) globalThis[name] = prior.value;
        else delete globalThis[name];
      }
    },
  };
}

function assertPublicMasteryIsEmpty(harness) {
  assert.equal(harness.rootElement.hidden, true);
  assert.equal(harness.node('[data-dma-body]').hidden, true);
  assert.equal(harness.node('[data-dma-error]').hidden, true);
  assert.equal(harness.node('[data-dma-login]').hidden, true);
  assert.equal(harness.node('[data-dma-retry]').hidden, true);
  assert.equal(harness.node('[data-dma-refresh]').disabled, true);
  assert.equal(harness.node('[data-dma-announcer]').textContent, '');
  assert.equal(harness.node('[data-dma-error-message]').textContent, '');
  assert.equal(harness.node('[data-dma-unlocks]').childElementCount, 0);
  assert.equal(harness.node('[data-dma-grants]').childElementCount, 0);
  for (const selector of [
    '[data-dma-rank]',
    '[data-dma-progress]',
    '[data-dma-stars]',
    '[data-dma-unlock-count]',
    '[data-dma-rank-percent]',
    '[data-dma-rank-next]',
    '[data-dma-rank-remaining]',
    '[data-dma-legacy-percent]',
    '[data-dma-legacy-next]',
    '[data-dma-legacy-remaining]',
  ]) {
    assert.equal(harness.node(selector).textContent, '—');
  }
}

test('canonical backend fixture has the certified bytes and all seven cases normalize', () => {
  assert.equal(
    createHash('sha256').update(fixtureBytes).digest('hex'),
    'c672b4de461c309f2634edb2db61228c3d46105fba4f21e991a77f812dfe1a06'
  );
  assert.equal(fixture.fixtureVersion, 'dungeon-mastery-overview-v1');
  assert.deepEqual(Object.keys(fixture.cases), [
    'zero',
    'midRank',
    'multiUnlock',
    'rank10ZeroStars',
    'rank10BeforeBoundary',
    'rank10AtBoundary',
    'rank10AfterBoundary',
  ]);
  for (const value of Object.values(fixture.cases)) assert.equal(normalizeDungeonMasteryResponse(value).ok, true);
});

test('normalizes canonical zero state without inventing unlocks, grants, or Legacy progress', () => {
  const { mastery } = normalizeDungeonMasteryResponse(fixture.cases.zero);
  assert.deepEqual(
    {
      progress: mastery.progress,
      rank: mastery.rank,
      stars: mastery.legacyStars,
      nextRank: mastery.rankProgress.nextRank,
      percent: mastery.rankProgress.percent,
      legacy: mastery.legacyProgress,
      unlocks: mastery.unlocks.length,
      grants: mastery.recentGrants.length,
    },
    { progress: 0, rank: 0, stars: 0, nextRank: 1, percent: 0, legacy: null, unlocks: 0, grants: 0 }
  );
});

test('accepts backend-supplied Rank 1 and representative intermediate Rank 3 progress', () => {
  const rankOne = clone(fixture.cases.zero);
  Object.assign(rankOne.mastery, { progress: 20, rank: 1 });
  Object.assign(rankOne.mastery.rankProgress, {
    currentRankThreshold: 20,
    nextRank: 2,
    nextRankThreshold: 60,
    progressIntoRank: 0,
    progressRequired: 40,
    remaining: 40,
  });
  assert.equal(normalizeDungeonMasteryResponse(rankOne).mastery.rank, 1);

  const { mastery } = normalizeDungeonMasteryResponse(fixture.cases.midRank);
  assert.deepEqual(
    [mastery.rank, mastery.progress, mastery.rankProgress.nextRank, mastery.rankProgress.percent],
    [3, 150, 4, 37]
  );
});

test('accepts certified just-before and exact Legacy boundary states only as supplied', () => {
  const before = normalizeDungeonMasteryResponse(fixture.cases.rank10BeforeBoundary).mastery;
  const boundary = normalizeDungeonMasteryResponse(fixture.cases.rank10AtBoundary).mastery;
  assert.deepEqual(
    [before.progress, before.legacyStars, before.legacyProgress.remaining, before.legacyProgress.percent],
    [1349, 0, 1, 99]
  );
  assert.deepEqual(
    [boundary.progress, boundary.legacyStars, boundary.legacyProgress.nextStar, boundary.legacyProgress.percent],
    [1350, 1, 2, 0]
  );
});

test('Rank 10 is terminal with no Rank 11 and Legacy remains a separate supplied interval', () => {
  const zeroStars = normalizeDungeonMasteryResponse(fixture.cases.rank10ZeroStars).mastery;
  const after = normalizeDungeonMasteryResponse(fixture.cases.rank10AfterBoundary).mastery;
  assert.deepEqual(
    [zeroStars.rank, zeroStars.rankProgress.complete, zeroStars.rankProgress.nextRank],
    [10, true, null]
  );
  assert.deepEqual(
    [after.legacyStars, after.legacyProgress.nextStar, after.legacyProgress.progressIntoInterval],
    [1, 2, 60]
  );
});

test('preserves all 13 cumulative semantic unlocks and their bilingual backend order', () => {
  const { unlocks } = normalizeDungeonMasteryResponse(fixture.cases.rank10ZeroStars).mastery;
  assert.equal(unlocks.length, 13);
  assert.deepEqual(
    unlocks.map(({ key }) => key),
    fixture.cases.rank10ZeroStars.mastery.unlocks.map(({ key }) => key)
  );
  assert.equal(
    unlocks.every(({ label }) => label.ar.length > 0 && label.en.length > 0),
    true
  );
});

test('preserves empty and populated recent grants in supplied order up to ten entries', () => {
  assert.equal(normalizeDungeonMasteryResponse(fixture.cases.zero).mastery.recentGrants.length, 0);
  const value = clone(fixture.cases.rank10AtBoundary);
  const template = value.mastery.recentGrants[0];
  value.mastery.recentGrants = Array.from({ length: 10 }, (_, index) => ({
    ...clone(template),
    createdAt: `2026-07-${String(20 - index).padStart(2, '0')}T12:00:00.000Z`,
  }));
  const grants = normalizeDungeonMasteryResponse(value).mastery.recentGrants;
  assert.equal(grants.length, 10);
  assert.deepEqual(
    grants.map(({ createdAt }) => createdAt),
    value.mastery.recentGrants.map(({ createdAt }) => createdAt)
  );
});

test('preserves authoritative recent-grant array order without imposing timestamp order', () => {
  const value = clone(fixture.cases.rank10AtBoundary);
  const older = clone(value.mastery.recentGrants[0]);
  const newer = clone(value.mastery.recentGrants[0]);
  older.createdAt = '2026-07-19T12:00:00.000Z';
  newer.createdAt = '2026-07-20T12:00:00.000Z';
  value.mastery.recentGrants = [older, newer];

  const grants = normalizeDungeonMasteryResponse(value).mastery.recentGrants;
  assert.deepEqual(
    grants.map(({ createdAt }) => createdAt),
    value.mastery.recentGrants.map(({ createdAt }) => createdAt)
  );
});

test('F12-R01 recent-grant input-order preservation matrix', async (t) => {
  const responseWithGrants = (timestamps) => {
    const value = clone(fixture.cases.rank10AtBoundary);
    const template = value.mastery.recentGrants[0];
    value.mastery.recentGrants = timestamps.map((createdAt, index) => ({
      ...clone(template),
      createdAt,
      progressDelta: index + 1,
      progressAfter: 900 + index,
      rankAfter: Math.min(index + 1, 10),
      semanticUnlockKeys: index % 2 === 0 ? [value.mastery.unlocks[index % value.mastery.unlocks.length].key] : [],
    }));
    return value;
  };
  const signatures = (grants) =>
    grants.map(({ createdAt, progressDelta, progressAfter, rankAfter, semanticUnlockKeys }) => ({
      createdAt,
      progressDelta,
      progressAfter,
      rankAfter,
      semanticUnlockKeys,
    }));
  const assertModelOrder = (value) => {
    const normalized = normalizeDungeonMasteryResponse(value);
    assert.deepEqual(signatures(normalized.mastery.recentGrants), signatures(value.mastery.recentGrants));
    return normalized;
  };
  const descending = ['2026-07-22T12:00:00.000Z', '2026-07-21T12:00:00.000Z', '2026-07-20T12:00:00.000Z'];
  const ascending = [...descending].reverse();
  const nonMonotonic = [descending[0], descending[2], descending[1]];

  await t.test('1. descending timestamps are accepted in exact input order', () => {
    assertModelOrder(responseWithGrants(descending));
  });

  await t.test('2. ascending timestamps are accepted in exact input order', () => {
    assertModelOrder(responseWithGrants(ascending));
  });

  await t.test('3. non-monotonic timestamps are accepted in exact input order', () => {
    assertModelOrder(responseWithGrants(nonMonotonic));
  });

  await t.test('4. identical timestamps are accepted in exact input order', () => {
    assertModelOrder(responseWithGrants(Array(3).fill(descending[0])));
  });

  await t.test('5. timestamp order does not override another supplied field order', () => {
    const value = responseWithGrants(nonMonotonic);
    value.mastery.recentGrants[0].progressDelta = 30;
    value.mastery.recentGrants[1].progressDelta = 10;
    value.mastery.recentGrants[2].progressDelta = 20;
    assert.deepEqual(
      assertModelOrder(value).mastery.recentGrants.map(({ progressDelta }) => progressDelta),
      [30, 10, 20]
    );
  });

  await t.test('6. out-of-order progressAfter values do not cause sorting', () => {
    const value = responseWithGrants(nonMonotonic);
    [value.mastery.recentGrants[0].progressAfter, value.mastery.recentGrants[1].progressAfter] = [
      value.mastery.recentGrants[1].progressAfter,
      value.mastery.recentGrants[0].progressAfter,
    ];
    assert.deepEqual(
      assertModelOrder(value).mastery.recentGrants.map(({ progressAfter }) => progressAfter),
      [901, 900, 902]
    );
  });

  await t.test('7. out-of-order rankAfter values do not cause sorting', () => {
    const value = responseWithGrants(nonMonotonic);
    [value.mastery.recentGrants[0].rankAfter, value.mastery.recentGrants[1].rankAfter] = [3, 1];
    value.mastery.recentGrants[2].rankAfter = 2;
    assert.deepEqual(
      assertModelOrder(value).mastery.recentGrants.map(({ rankAfter }) => rankAfter),
      [3, 1, 2]
    );
  });

  await t.test('8. semanticUnlockKeys differences do not cause sorting', () => {
    const value = responseWithGrants(nonMonotonic);
    const keys = value.mastery.unlocks.slice(0, 2).map(({ key }) => key);
    value.mastery.recentGrants[0].semanticUnlockKeys = [keys[1]];
    value.mastery.recentGrants[1].semanticUnlockKeys = [];
    value.mastery.recentGrants[2].semanticUnlockKeys = [keys[0]];
    assert.deepEqual(
      assertModelOrder(value).mastery.recentGrants.map(({ semanticUnlockKeys }) => semanticUnlockKeys),
      [[keys[1]], [], [keys[0]]]
    );
  });

  await t.test('9. one grant is accepted', () => {
    assert.equal(assertModelOrder(responseWithGrants(descending.slice(0, 1))).mastery.recentGrants.length, 1);
  });

  await t.test('10. zero grants are accepted', () => {
    assert.equal(normalizeDungeonMasteryResponse(fixture.cases.zero).mastery.recentGrants.length, 0);
  });

  await t.test('11. exactly ten grants are accepted in exact input order', () => {
    const timestamps = Array.from(
      { length: 10 },
      (_, index) => `2026-07-${String(10 + ((index * 7) % 10)).padStart(2, '0')}T12:00:00.000Z`
    );
    assert.equal(assertModelOrder(responseWithGrants(timestamps)).mastery.recentGrants.length, 10);
  });

  await t.test('12. eleven grants retain the canonical maximum-bound rejection', () => {
    const value = responseWithGrants(Array(11).fill(descending[0]));
    assert.throws(() => normalizeDungeonMasteryResponse(value), DungeonMasteryContractError);
  });

  await t.test('13. malformed or empty createdAt remains rejected', () => {
    const value = responseWithGrants(descending.slice(0, 1));
    value.mastery.recentGrants[0].createdAt = 'yesterday';
    assert.throws(() => normalizeDungeonMasteryResponse(value), DungeonMasteryContractError);
    value.mastery.recentGrants[0].createdAt = '';
    assert.throws(() => normalizeDungeonMasteryResponse(value), DungeonMasteryContractError);
  });

  await t.test('14. non-string createdAt remains rejected', () => {
    const value = responseWithGrants(descending.slice(0, 1));
    value.mastery.recentGrants[0].createdAt = 1_721_649_600_000;
    assert.throws(() => normalizeDungeonMasteryResponse(value), DungeonMasteryContractError);
  });

  await t.test('15. model output preserves every supplied row signature', () => {
    assertModelOrder(responseWithGrants(nonMonotonic));
  });

  await t.test('16. rendered DOM order exactly matches DTO array order', async (t) => {
    const value = responseWithGrants(nonMonotonic);
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, value);
    assert.deepEqual(
      harness.node('[data-dma-grants]').children.map((item) => item.children[0].children[1].dateTime),
      nonMonotonic
    );
  });

  await t.test('17. Refresh replaces old rendered order with new server order', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, responseWithGrants(descending));
    harness.node('[data-dma-refresh]').click();
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, responseWithGrants(nonMonotonic));
    assert.deepEqual(
      harness.node('[data-dma-grants]').children.map((item) => item.children[0].children[1].dateTime),
      nonMonotonic
    );
  });

  await t.test('18. implementation contains no recent-grant sorting or chronology comparison', async () => {
    const [model, client, component] = await Promise.all([
      readFile(new URL('src/scripts/dungeon-mastery-model.ts', root), 'utf8'),
      readFile(new URL('src/scripts/dungeon-mastery-client.ts', root), 'utf8'),
      readFile(new URL('src/components/profile/DungeonMasteryPanel.astro', root), 'utf8'),
    ]);
    const implementation = `${model}\n${client}\n${component}`;
    assert.doesNotMatch(implementation, /\.sort\s*\(|\.toSorted\s*\(|\.reverse\s*\(/);
    assert.doesNotMatch(model, /recentGrants\.order|Date\.parse\s*\(recentGrants/);
  });
});

test('rejects unknown or missing keys and unsafe integer values', () => {
  invalid((value) => (value.mastery.extra = true));
  invalid((value) => delete value.mastery.progress);
  invalid((value) => (value.mastery.progress = Number.MAX_SAFE_INTEGER + 1));
  invalid((value) => (value.mastery.progress = '150'));
});

test('rejects invalid rank, percent, Legacy nullability, and timestamps', () => {
  invalid((value) => (value.mastery.rank = 11));
  invalid((value) => (value.mastery.rankProgress.percent = 101));
  invalid((value) => (value.mastery.legacyProgress = {}));
  invalid((value) => (value.mastery.recentGrants[0].createdAt = 'yesterday'));
});

test('rejects duplicate keys, over-bound arrays, and broken references', () => {
  invalid((value) => value.mastery.unlocks.push(clone(value.mastery.unlocks[0])));
  invalid((value) => (value.mastery.unlocks = Array.from({ length: 14 }, () => clone(value.mastery.unlocks[0]))));
  invalid((value) => (value.mastery.recentGrants[0].semanticUnlockKeys = ['unknown.unlock']));
});

test('issues one exact credentialed no-store GET with signal and no query, body, or headers', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const api = new DungeonMasteryApi('https://api.tnx6.xyz/', async (input, init) => {
    calls.push({ input, init });
    return jsonResponse(fixture.cases.zero);
  });
  await api.getOverview(signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].input, 'https://api.tnx6.xyz/api/dungeon/mastery');
  assert.deepEqual(calls[0].init, {
    method: 'GET',
    credentials: 'include',
    cache: 'no-store',
    signal,
  });
  assert.equal(new URL(calls[0].input).search, '');
  assert.equal('body' in calls[0].init, false);
  assert.equal('headers' in calls[0].init, false);
});

test('classifies 401, 404, 400, 405, and 500 without exposing backend text', async () => {
  const cases = [
    [401, 'MASTERY_UNAUTHENTICATED', isDungeonMasteryUnauthenticated, true],
    [404, 'NOT_FOUND', isDungeonMasteryFeatureUnavailable, true],
    [400, 'MASTERY_VALIDATION_ERROR', () => false, false],
    [405, 'MASTERY_METHOD_NOT_ALLOWED', () => false, false],
    [500, 'MASTERY_READ_UNAVAILABLE', isDungeonMasteryRetryable, true],
  ];
  for (const [status, code, predicate, expectedPredicate] of cases) {
    const api = new DungeonMasteryApi('https://api.tnx6.xyz', async () =>
      jsonResponse({ ok: false, error: { code, message: 'SECRET D1 INTERNAL DETAIL' } }, status)
    );
    await assert.rejects(api.getOverview(), (error) => {
      assert.equal(error instanceof DungeonMasteryHttpError, true);
      assert.equal(error.code, code);
      assert.equal(predicate(error), expectedPredicate);
      assert.doesNotMatch(dungeonMasteryErrorMessage(error), /SECRET|D1|INTERNAL/i);
      return true;
    });
  }
});

test('classifies network, invalid JSON, and unexpected success DTO as retryable safe errors', async () => {
  const fetchers = [
    async () => {
      throw new Error('private network detail');
    },
    async () => new Response('{', { status: 200 }),
    async () => jsonResponse({ ok: true, mastery: { raw: 'private database detail' } }),
  ];
  for (const fetcher of fetchers) {
    const api = new DungeonMasteryApi('https://api.tnx6.xyz', fetcher);
    await assert.rejects(api.getOverview(), (error) => {
      assert.equal(error instanceof DungeonMasteryHttpError, true);
      assert.equal(error.retryable, true);
      assert.doesNotMatch(dungeonMasteryErrorMessage(error), /private|database|network detail/i);
      return true;
    });
  }
});

test('component exposes hidden, accessible loading, auth, failure, retry, content, and progress states', async () => {
  const source = await readFile(new URL('src/components/profile/DungeonMasteryPanel.astro', root), 'utf8');
  assert.match(source, /data-dungeon-mastery-root[\s\S]*hidden/);
  for (const hook of ['data-dma-loading', 'data-dma-login', 'data-dma-error', 'data-dma-retry', 'data-dma-body']) {
    assert.match(source, new RegExp(hook));
  }
  assert.match(source, /aria-live="polite"/);
  assert.equal((source.match(/role="progressbar"/g) || []).length, 2);
  assert.match(source, /<button[^>]+type="button"/);
  assert.match(source, /<a data-dma-login-link/);
});

test('profile mounts Mastery directly after Equipment in the primary stack before the side stack', async () => {
  const source = await readFile(new URL('src/pages/profile-v2.astro', root), 'utf8');
  assert.match(
    source,
    /<div class="v2-main-stack">[\s\S]*<DungeonEquipmentPanel \/>\s*<DungeonMasteryPanel \/>\s*<\/div>\s*<aside class="v2-side-stack">/
  );
});

test('client guards public profiles before API construction and clears stale data before every request', async () => {
  const source = await readFile(new URL('src/scripts/dungeon-mastery-client.ts', root), 'utf8');
  const loadStart = source.indexOf('private readonly load');
  const publicGuard = source.indexOf('isPublicProfile()', loadStart);
  const apiConstruction = source.indexOf('new DungeonMasteryApi', loadStart);
  assert.ok(publicGuard > loadStart && publicGuard < apiConstruction);
  assert.match(source, /prepareForRequest\(\)[\s\S]*clearOverview\(\)/);
  assert.match(source, /prepareForRequest\(\);[\s\S]*await api\.getOverview/);
  assert.match(source, /isDungeonMasteryFeatureUnavailable\(error\)[\s\S]*this\.clearForDormancy\(\)/);
});

test('pending Mastery load keeps its skeleton and polite status in the accessibility tree', async (t) => {
  const harness = await createMasteryLifecycleHarness();
  t.after(() => harness.cleanup());
  assert.equal(harness.requests.length, 1);
  assert.equal(harness.rootElement.hidden, false);
  assert.equal(harness.node('[data-dma-loading]').hidden, false);
  assert.equal(harness.node('[data-dma-body]').hidden, true);
  assert.notEqual(harness.node('[data-dma-announcer]').textContent, '');
});

test('F09-R01 pending loading and accessibility matrix', async (t) => {
  const retryableBody = {
    ok: false,
    error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private backend detail' },
  };

  await t.test('1. initial eligible pending request keeps the root visible', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.rootElement.hidden, false);
  });

  await t.test('2. initial pending request exposes the loading skeleton', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.node('[data-dma-loading]').hidden, false);
    assert.equal(harness.node('[data-dma-body]').hidden, true);
  });

  await t.test('3. initial pending request keeps a meaningful polite status accessible', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.rootElement.hidden, false);
    assert.notEqual(harness.node('[data-dma-announcer]').textContent, '');
  });

  await t.test('4. initial pending to success hides loading and shows content', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.midRank);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-body]').hidden, false);
  });

  await t.test('5. initial pending to 500 shows the bounded retryable state', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryableBody, 500);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-error]').hidden, false);
    assert.equal(harness.node('[data-dma-retry]').hidden, false);
  });

  await t.test('6. initial pending to 400 shows a terminal error without controls', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(
      0,
      { ok: false, error: { code: 'MASTERY_VALIDATION_ERROR', message: 'private backend detail' } },
      400
    );
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-error]').hidden, false);
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
    assert.equal(harness.node('[data-dma-refresh]').hidden, true);
  });

  await t.test('7. initial pending to 401 shows only the auth action', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(
      0,
      { ok: false, error: { code: 'MASTERY_UNAUTHENTICATED', message: 'private backend detail' } },
      401
    );
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-login]').hidden, false);
    assert.equal(harness.node('[data-dma-error]').hidden, true);
  });

  await t.test('8. initial pending to 404 hides the entire panel', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-refresh]').hidden, true);
    assert.equal(harness.node('[data-dma-announcer]').textContent, '');
  });

  await t.test('9. initial pending to public hides immediately and aborts', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.setPublic();
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.requests[0].init.signal.aborted, true);
    assert.equal(harness.requests.length, 1);
  });

  await t.test('10. initial pending to disposal becomes hidden and inert', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.requests[0].init.signal.aborted, true);
  });

  await t.test('11. valid state to Refresh pending exposes only loading-safe UI', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    harness.node('[data-dma-refresh]').click();
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.rootElement.hidden, false);
    assert.equal(harness.node('[data-dma-loading]').hidden, false);
    assert.equal(harness.node('[data-dma-body]').hidden, true);
  });

  await t.test('12. retryable error to Retry pending exposes only loading-safe UI', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryableBody, 500);
    harness.node('[data-dma-retry]').click();
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.rootElement.hidden, false);
    assert.equal(harness.node('[data-dma-loading]').hidden, false);
    assert.equal(harness.node('[data-dma-error]').hidden, true);
  });

  await t.test('13. Refresh pending to success renders only fresh content', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, fixture.cases.midRank);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-body]').hidden, false);
    assert.equal(
      harness.node('[data-dma-grants]').childElementCount,
      fixture.cases.midRank.mastery.recentGrants.length
    );
  });

  await t.test('14. Retry pending to success renders fresh content', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryableBody, 500);
    harness.node('[data-dma-retry]').click();
    await harness.respond(1, fixture.cases.midRank);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-error]').hidden, true);
    assert.equal(harness.node('[data-dma-body]').hidden, false);
  });

  await t.test('15. replaced pending request cannot overwrite the replacement result', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.zero);
    const refresh = harness.node('[data-dma-refresh]');
    refresh.dispatchEvent(new Event('click'));
    refresh.dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 3);
    assert.equal(harness.requests[1].init.signal.aborted, true);
    await harness.respond(2, fixture.cases.midRank);
    const rankFromReplacement = harness.node('[data-dma-rank]').textContent;
    await harness.respond(1, fixture.cases.rank10AtBoundary);
    assert.equal(harness.node('[data-dma-rank]').textContent, rankFromReplacement);
  });

  await t.test('16. public transition suppresses a late response from abort-ignoring transport', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.setPublic();
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('17. pending controls are hidden and disabled by approved policy', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
    assert.equal(harness.node('[data-dma-refresh]').hidden, true);
    assert.equal(harness.node('[data-dma-refresh]').disabled, true);
    assert.equal(harness.node('[data-dma-login]').hidden, true);
  });

  await t.test('18. Refresh pending clears all stale overview content', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.ok(harness.node('[data-dma-grants]').childElementCount > 0);
    harness.node('[data-dma-refresh]').click();
    assert.equal(harness.node('[data-dma-body]').hidden, true);
    assert.equal(harness.node('[data-dma-unlocks]').childElementCount, 0);
    assert.equal(harness.node('[data-dma-grants]').childElementCount, 0);
    assert.equal(harness.node('[data-dma-legacy]').hidden, true);
  });

  await t.test('19. loading uses one meaningful polite live region without duplication', async (t) => {
    const [component, harness] = await Promise.all([
      readFile(new URL('src/components/profile/DungeonMasteryPanel.astro', root), 'utf8'),
      createMasteryLifecycleHarness(),
    ]);
    t.after(() => harness.cleanup());
    assert.equal((component.match(/data-dma-announcer/g) || []).length, 1);
    assert.equal((component.match(/role="status"/g) || []).length, 1);
    assert.equal((component.match(/aria-live="polite"/g) || []).length, 1);
    assert.equal(harness.rootElement.hidden, false);
    assert.notEqual(harness.node('[data-dma-announcer]').textContent, '');
  });

  await t.test('20. repeated Refresh cycles do not multiply rendered rows or requests', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    const expectedRows = fixture.cases.rank10AtBoundary.mastery.recentGrants.length;
    for (let index = 1; index <= 3; index += 1) {
      harness.node('[data-dma-refresh]').click();
      assert.equal(harness.requests.length, index + 1);
      assert.equal(harness.node('[data-dma-grants]').childElementCount, 0);
      await harness.respond(index, fixture.cases.rank10AtBoundary);
      assert.equal(harness.node('[data-dma-grants]').childElementCount, expectedRows);
    }
  });
});

test('F09-R02 dormant announcer cleanup matrix', async (t) => {
  const loadingAnnouncement = 'جاري تحميل تقدم الإتقان.';
  const retryableBody = {
    ok: false,
    error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private backend detail' },
  };
  const notFoundBody = { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } };
  const assertDormant = (harness) => {
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-loading]').hidden, true);
    assert.equal(harness.node('[data-dma-body]').hidden, true);
    assert.equal(harness.node('[data-dma-error]').hidden, true);
    assert.equal(harness.node('[data-dma-login]').hidden, true);
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
    assert.equal(harness.node('[data-dma-refresh]').hidden, true);
    assert.equal(harness.node('[data-dma-refresh]').disabled, true);
    assert.equal(harness.node('[data-dma-announcer]').textContent, '');
    assert.equal(harness.node('[data-dma-unlocks]').childElementCount, 0);
    assert.equal(harness.node('[data-dma-grants]').childElementCount, 0);
  };

  await t.test('1. initial pending retains the loading announcement', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.rootElement.hidden, false);
    assert.equal(harness.node('[data-dma-loading]').hidden, false);
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
  });

  await t.test('2. pending to success replaces the loading announcement', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.zero);
    assert.equal(harness.node('[data-dma-announcer]').textContent, 'تم تحميل تقدم إتقان الدنجن.');
  });

  for (const [number, label, status, body, expected] of [
    [3, 'pending to 500', 500, retryableBody, 'تعذر تحميل تقدم الإتقان.'],
    [
      4,
      'pending to 400',
      400,
      { ok: false, error: { code: 'MASTERY_VALIDATION_ERROR', message: 'private' } },
      'تعذر تحميل تقدم الإتقان.',
    ],
    [
      5,
      'pending to 401',
      401,
      { ok: false, error: { code: 'MASTERY_UNAUTHENTICATED', message: 'private' } },
      'تسجيل الدخول مطلوب لعرض تقدم الإتقان.',
    ],
  ]) {
    await t.test(`${number}. ${label} replaces the loading announcement`, async (t) => {
      const harness = await createMasteryLifecycleHarness();
      t.after(() => harness.cleanup());
      await harness.respond(0, body, status);
      assert.equal(harness.node('[data-dma-announcer]').textContent, expected);
      assert.notEqual(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
    });
  }

  await t.test('6. pending to 404 becomes silent and dormant', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, notFoundBody, 404);
    assertDormant(harness);
  });

  await t.test('7. valid success to 404 becomes silent and dormant', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, notFoundBody, 404);
    assertDormant(harness);
  });

  await t.test('8. Retry pending to 404 becomes silent and dormant', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryableBody, 500);
    harness.node('[data-dma-retry]').click();
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
    await harness.respond(1, notFoundBody, 404);
    assertDormant(harness);
  });

  await t.test('9. Refresh pending to 404 becomes silent and dormant', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.midRank);
    harness.node('[data-dma-refresh]').click();
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
    await harness.respond(1, notFoundBody, 404);
    assertDormant(harness);
  });

  await t.test('10. late stale completion cannot repopulate after 404', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.zero);
    const refresh = harness.node('[data-dma-refresh]');
    refresh.dispatchEvent(new Event('click'));
    refresh.dispatchEvent(new Event('click'));
    await harness.respond(2, notFoundBody, 404);
    assertDormant(harness);
    await harness.respond(1, fixture.cases.rank10AtBoundary);
    assertDormant(harness);
  });

  await t.test('11. 404 remains silent across public and self route interaction', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, notFoundBody, 404);
    harness.setPublic('after-404');
    harness.setSelf();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assertDormant(harness);
  });

  await t.test('12. repeated internal route events cannot resurrect 404 status', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, notFoundBody, 404);
    for (let index = 0; index < 4; index += 1) harness.routeEvent();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assertDormant(harness);
  });

  await t.test('13. public transition clears the announcer', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
    harness.setPublic('public-user');
    assertDormant(harness);
  });

  await t.test('14. before-swap disposal clears the announcer', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
    harness.teardown();
    assertDormant(harness);
  });

  await t.test('15. retired-root late event and completion remain silent', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    harness.routeEvent();
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.equal(harness.requests.length, 1);
    assertDormant(harness);
  });

  await t.test('16. new eligible root announces its own fresh pending request', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    const retiredRoot = harness.swapToNewRoot();
    assert.equal(retiredRoot.node('[data-dma-announcer]').textContent, '');
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.rootElement.hidden, false);
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
  });

  await t.test('17. repeated A to B to C roots keep retired announcers empty', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    const rootA = harness.swapToNewRoot();
    harness.teardown();
    const rootB = harness.swapToNewRoot();
    assert.equal(rootA.node('[data-dma-announcer]').textContent, '');
    assert.equal(rootB.node('[data-dma-announcer]').textContent, '');
    assert.equal(harness.requests.length, 3);
    assert.equal(harness.node('[data-dma-announcer]').textContent, loadingAnnouncement);
  });

  await t.test('18. repeated lifecycle changes create no duplicate live or status nodes', async (t) => {
    const [component, harness] = await Promise.all([
      readFile(new URL('src/components/profile/DungeonMasteryPanel.astro', root), 'utf8'),
      createMasteryLifecycleHarness(),
    ]);
    t.after(() => harness.cleanup());
    harness.setPublic('public-user');
    harness.setSelf();
    harness.teardown();
    harness.swapToNewRoot();
    assert.equal((component.match(/data-dma-announcer/g) || []).length, 1);
    assert.equal((component.match(/role="status"/g) || []).length, 1);
    assert.equal((component.match(/aria-live="polite"/g) || []).length, 1);
  });
});

test('in-place public-profile replaceState notifies Mastery before the selected user renders', async () => {
  const [profile, client] = await Promise.all([
    readFile(new URL('src/pages/profile-v2.astro', root), 'utf8'),
    readFile(new URL('src/scripts/dungeon-mastery-client.ts', root), 'utf8'),
  ]);
  const transition = profile.indexOf("history.replaceState(null, '', profileLink(user))");
  assert.ok(transition >= 0, 'profile-v2 must retain its existing in-place public-profile transition');
  const transitionBlock = profile.slice(transition, transition + 500);
  const routeSignals = ['tnx:profile-route-change', 'popstate'];
  assert.equal(
    routeSignals.some(
      (signal) =>
        transitionBlock.includes('dispatchEvent') && transitionBlock.includes(signal) && client.includes(signal)
    ),
    true,
    'the replaceState transition must synchronously notify Mastery so it aborts and clears self-only state'
  );
});

test('F04-R01 lifecycle and privacy matrix', async (t) => {
  await t.test('1. initial self starts one canonical request', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.requests.length, 1);
    await harness.respond(0, fixture.cases.midRank);
    assert.equal(harness.rootElement.hidden, false);
    assert.equal(harness.node('[data-dma-body]').hidden, false);
  });

  await t.test('2. initial public profile starts zero requests', async (t) => {
    const harness = await createMasteryLifecycleHarness({ publicProfile: true });
    t.after(() => harness.cleanup());
    assert.equal(harness.requests.length, 0);
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('3. rendered self state is cleared synchronously before public rendering', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.multiUnlock);
    assert.ok(harness.node('[data-dma-unlocks]').childElementCount > 0);
    harness.setPublic();
    assertPublicMasteryIsEmpty(harness);
    assert.equal(harness.requests.length, 1);
  });

  await t.test('4. an aborted in-flight self request cannot render in public mode', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.setPublic();
    assert.equal(harness.requests[0].init.signal.aborted, true);
    await harness.reject(0, new DOMException('Aborted', 'AbortError'));
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('5. generation invalidation rejects a late success even when transport ignores abort', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.setPublic();
    assert.equal(harness.requests[0].init.signal.aborted, true);
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('6. request A cannot overwrite request B after public then self', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.setPublic();
    harness.setSelf();
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, fixture.cases.midRank);
    const rankFromB = harness.node('[data-dma-rank]').textContent;
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.equal(harness.node('[data-dma-rank]').textContent, rankFromB);
    assert.equal(harness.rootElement.hidden, false);
  });

  await t.test('7. same-context request B wins over late request A', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.node('[data-dma-refresh]').dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.requests[0].init.signal.aborted, true);
    await harness.respond(1, fixture.cases.midRank);
    const rankFromB = harness.node('[data-dma-rank]').textContent;
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.equal(harness.node('[data-dma-rank]').textContent, rankFromB);
  });

  await t.test('8. public mode suppresses retry and refresh request paths', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(
      0,
      { ok: false, error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private backend detail' } },
      500
    );
    assert.equal(harness.node('[data-dma-error]').hidden, false);
    harness.setPublic();
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    harness.node('[data-dma-refresh]').dispatchEvent(new Event('click'));
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('9. public to self starts exactly one fresh request', async (t) => {
    const harness = await createMasteryLifecycleHarness({ publicProfile: true });
    t.after(() => harness.cleanup());
    harness.setSelf();
    assert.equal(harness.requests.length, 1);
    await harness.respond(0, fixture.cases.zero);
    assert.equal(harness.rootElement.hidden, false);
  });

  await t.test('10. repeated transitions do not multiply listeners or requests', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.zero);
    for (let index = 1; index <= 3; index += 1) {
      harness.setPublic(`public-${index}`);
      assert.equal(harness.requests.length, index);
      harness.setSelf();
      assert.equal(harness.requests.length, index + 1);
      await harness.respond(index, fixture.cases.zero);
    }
    assert.equal(harness.requests.length, 4);
  });

  await t.test('11. teardown invalidates a request before its late response', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    assert.equal(harness.requests[0].init.signal.aborted, true);
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-rank]').textContent, '—');
  });

  await t.test('12. public transition removes all rendered self DOM and controls', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.ok(harness.node('[data-dma-grants]').childElementCount > 0);
    harness.setPublic();
    assertPublicMasteryIsEmpty(harness);
    assert.equal(harness.node('[data-dma-rank-progressbar]').attributes.get('aria-valuenow'), '0');
    assert.equal(harness.node('[data-dma-legacy-progressbar]').attributes.get('aria-valuenow'), '0');
  });

  await t.test('13. 404 dormancy remains hidden across public and self transitions', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, { ok: false, error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    assert.equal(harness.rootElement.hidden, true);
    harness.setPublic();
    harness.setSelf();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.rootElement.hidden, true);
  });

  await t.test('14. error and retry state cannot leak into public context', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.reject(0, new Error('private network detail'));
    assert.equal(harness.node('[data-dma-error]').hidden, false);
    assert.notEqual(harness.node('[data-dma-error-message]').textContent, '');
    harness.setPublic();
    assertPublicMasteryIsEmpty(harness);
    assert.equal(harness.requests.length, 1);
  });

  await t.test('15. public identity never reaches the Mastery API request', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    const request = harness.requests[0];
    assert.equal(request.input, 'https://api.tnx6.xyz/api/dungeon/mastery');
    assert.equal(new URL(request.input).search, '');
    assert.equal('headers' in request.init, false);
    assert.equal('body' in request.init, false);
    harness.setPublic('sensitive-public-name');
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assert.doesNotMatch(JSON.stringify({ input: request.input, init: request.init }), /sensitive-public-name/);
  });
});

test('disposed Mastery lifecycle ignores a subsequent profile route event', async (t) => {
  const harness = await createMasteryLifecycleHarness();
  t.after(() => harness.cleanup());
  assert.equal(harness.requests.length, 1);
  harness.teardown();
  assert.equal(harness.requests[0].init.signal.aborted, true);
  harness.setSelf();
  await settleMasteryLifecycle();
  assert.equal(harness.requests.length, 1, 'a disposed page lifecycle must not be reconstructed by a route event');
});

test('F04-R02 retired lifecycle matrix', async (t) => {
  await t.test('1. normal initial self page starts exactly one request', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.requests.length, 1);
  });

  await t.test('2. before-swap disposes the active request and controller DOM', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    assert.equal(harness.requests[0].init.signal.aborted, true);
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-rank]').textContent, '—');
  });

  await t.test('3. route event after before-swap cannot reconstruct the old root', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    harness.routeEvent();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
  });

  await t.test('4. multiple post-disposal route events start no new requests', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    for (let index = 0; index < 5; index += 1) harness.routeEvent();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
  });

  await t.test('5. synchronous route event immediately after before-swap cannot reconstruct', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    harness.routeEvent();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.rootElement.hidden, true);
  });

  await t.test('6. public and self URL changes cannot revive a retired root', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    harness.setPublic('after-disposal');
    harness.setSelf();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.rootElement.hidden, true);
  });

  await t.test('7. retired retry and refresh controls cannot restart work', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    const retry = harness.node('[data-dma-retry]');
    const refresh = harness.node('[data-dma-refresh]');
    harness.teardown();
    retry.dispatchEvent(new Event('click'));
    refresh.dispatchEvent(new Event('click'));
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
  });

  await t.test('8. late completion after disposal cannot resurrect DOM', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-rank]').textContent, '—');
    assert.equal(harness.node('[data-dma-unlocks]').childElementCount, 0);
  });

  await t.test('9. new root B initializes after retired root A', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    const oldRoot = harness.swapToNewRoot();
    assert.equal(oldRoot.rootElement.hidden, true);
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, fixture.cases.zero);
    assert.equal(harness.rootElement.hidden, false);
  });

  await t.test('10. late event after B exists cannot affect retired A or duplicate B', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    const oldRoot = harness.swapToNewRoot();
    harness.routeEvent();
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, fixture.cases.midRank);
    const rankFromB = harness.node('[data-dma-rank]').textContent;
    await harness.respond(0, fixture.cases.rank10AtBoundary);
    assert.equal(harness.node('[data-dma-rank]').textContent, rankFromB);
    assert.equal(oldRoot.rootElement.hidden, true);
    assert.equal(oldRoot.node('[data-dma-rank]').textContent, '—');
  });

  await t.test('11. A to B to C swaps keep retired roots terminal and current root singular', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    const rootA = harness.swapToNewRoot();
    harness.teardown();
    const rootB = harness.swapToNewRoot();
    harness.routeEvent();
    assert.equal(harness.requests.length, 3);
    assert.equal(harness.requests[0].init.signal.aborted, true);
    assert.equal(harness.requests[1].init.signal.aborted, true);
    assert.equal(rootA.rootElement.hidden, true);
    assert.equal(rootB.rootElement.hidden, true);
  });

  await t.test('12. duplicate route events on active root do not create a request storm', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    for (let index = 0; index < 5; index += 1) harness.routeEvent();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
  });

  await t.test('13. route events on an active public root start zero requests', async (t) => {
    const harness = await createMasteryLifecycleHarness({ publicProfile: true });
    t.after(() => harness.cleanup());
    harness.routeEvent();
    harness.routeEvent();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 0);
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('14. public to self on a new active root starts one fresh request', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    harness.teardown();
    harness.swapToNewRoot({ publicProfile: true });
    assert.equal(harness.requests.length, 1);
    harness.setSelf();
    assert.equal(harness.requests.length, 2);
  });

  await t.test('15. module-level route listener remains singular across swaps', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    assert.equal(harness.listenerCount('tnx:profile-route-change'), 1);
    harness.teardown();
    harness.swapToNewRoot();
    harness.teardown();
    harness.swapToNewRoot();
    assert.equal(harness.listenerCount('tnx:profile-route-change'), 1);
  });
});

test('retry button is exposed only for retryable safe failures', async () => {
  const cases = [
    {
      status: 500,
      body: { ok: false, error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private retryable detail' } },
      expected: { retryHidden: false, refreshDisabled: false },
    },
    {
      status: 400,
      body: { ok: false, error: { code: 'MASTERY_VALIDATION_ERROR', message: 'private terminal detail' } },
      expected: { retryHidden: true, refreshDisabled: true },
    },
  ];
  const observed = [];
  for (const testCase of cases) {
    const harness = await createMasteryLifecycleHarness();
    try {
      await harness.respond(0, testCase.body, testCase.status);
      observed.push({
        retryHidden: harness.node('[data-dma-retry]').hidden,
        refreshDisabled: harness.node('[data-dma-refresh]').disabled,
      });
    } finally {
      harness.cleanup();
    }
  }
  assert.deepEqual(
    observed,
    cases.map(({ expected }) => expected)
  );
});

test('F07-R01 retry policy matrix', async (t) => {
  const retryable500 = {
    ok: false,
    error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private retryable detail' },
  };
  const terminal400 = {
    ok: false,
    error: { code: 'MASTERY_VALIDATION_ERROR', message: 'private terminal detail' },
  };
  const terminal405 = {
    ok: false,
    error: { code: 'MASTERY_METHOD_NOT_ALLOWED', message: 'private terminal detail' },
  };

  function assertRetryState(harness, { retryHidden, refreshDisabled }) {
    assert.equal(harness.node('[data-dma-retry]').hidden, retryHidden);
    assert.equal(harness.node('[data-dma-refresh]').disabled, refreshDisabled);
  }

  await t.test('1. 500 exposes Retry and enables Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    assertRetryState(harness, { retryHidden: false, refreshDisabled: false });
  });

  await t.test('2. network failure exposes Retry and enables Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.reject(0, new TypeError('private network detail'));
    assertRetryState(harness, { retryHidden: false, refreshDisabled: false });
  });

  await t.test('3. 400 hides Retry and disables Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal400, 400);
    assertRetryState(harness, { retryHidden: true, refreshDisabled: true });
  });

  await t.test('4. 405 hides Retry and disables Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal405, 405);
    assertRetryState(harness, { retryHidden: true, refreshDisabled: true });
  });

  await t.test('5. malformed success DTO exposes Retry and enables Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, { ok: true, mastery: { raw: 'private malformed detail' } });
    assertRetryState(harness, { retryHidden: false, refreshDisabled: false });
  });

  await t.test('6. 401 exposes Login only and keeps Retry hidden', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(
      0,
      { ok: false, error: { code: 'MASTERY_UNAUTHENTICATED', message: 'private auth detail' } },
      401
    );
    assert.equal(harness.node('[data-dma-login]').hidden, false);
    assertRetryState(harness, { retryHidden: true, refreshDisabled: true });
  });

  await t.test('7. 404 hides the entire panel and Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    await harness.respond(1, { ok: false, error: { code: 'NOT_FOUND', message: 'private unavailable detail' } }, 404);
    assert.equal(harness.rootElement.hidden, true);
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
  });

  await t.test('8. retryable to terminal transition clears Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, terminal400, 400);
    assertRetryState(harness, { retryHidden: true, refreshDisabled: true });
  });

  await t.test('9. terminal to retryable transition exposes Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal400, 400);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, retryable500, 500);
    assertRetryState(harness, { retryHidden: false, refreshDisabled: false });
  });

  await t.test('10. retryable to success transition clears all error controls', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    await harness.respond(1, fixture.cases.midRank);
    assert.equal(harness.node('[data-dma-error]').hidden, true);
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
    assert.equal(harness.node('[data-dma-body]').hidden, false);
  });

  await t.test('11. retryable to public transition clears Retry without a request', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.setPublic();
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assertPublicMasteryIsEmpty(harness);
  });

  await t.test('12. before-swap prevents Retry resurrection', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.teardown();
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.rootElement.hidden, true);
  });

  await t.test('13. repeated Retry actions create one bounded replacement each', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 2);
    await harness.respond(1, retryable500, 500);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 3);
    await harness.respond(2, retryable500, 500);
    assertRetryState(harness, { retryHidden: false, refreshDisabled: false });
  });

  await t.test('14. Retry after a completed failure issues one canonical GET', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.reject(0, new TypeError('private network detail'));
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    assert.equal(harness.requests.length, 2);
    assert.equal(harness.requests[1].input, 'https://api.tnx6.xyz/api/dungeon/mastery');
    assert.equal(harness.requests[1].init.method, 'GET');
  });

  await t.test('15. Retry preserves the exact credentialed no-store request contract', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-retry]').dispatchEvent(new Event('click'));
    const request = harness.requests[1];
    assert.equal(request.input, 'https://api.tnx6.xyz/api/dungeon/mastery');
    assert.equal(new URL(request.input).search, '');
    assert.equal(request.init.method, 'GET');
    assert.equal(request.init.credentials, 'include');
    assert.equal(request.init.cache, 'no-store');
    assert.equal(request.init.signal instanceof AbortSignal, true);
    assert.equal('body' in request.init, false);
    assert.equal('headers' in request.init, false);
  });

  await t.test('16. valid to retryable transition clears prior content', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.multiUnlock);
    assert.ok(harness.node('[data-dma-unlocks]').childElementCount > 0);
    harness.node('[data-dma-refresh]').dispatchEvent(new Event('click'));
    await harness.respond(1, retryable500, 500);
    assert.equal(harness.node('[data-dma-body]').hidden, true);
    assert.equal(harness.node('[data-dma-unlocks]').childElementCount, 0);
    assert.equal(harness.node('[data-dma-rank]').textContent, '—');
    assertRetryState(harness, { retryHidden: false, refreshDisabled: false });
  });
});

test('Refresh is visible only after success or a temporary retryable error', async () => {
  const cases = [
    {
      body: fixture.cases.zero,
      status: 200,
      expectedHidden: false,
    },
    {
      body: { ok: false, error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private retryable detail' } },
      status: 500,
      expectedHidden: false,
    },
    {
      body: { ok: false, error: { code: 'MASTERY_VALIDATION_ERROR', message: 'private terminal detail' } },
      status: 400,
      expectedHidden: true,
    },
    {
      body: { ok: false, error: { code: 'MASTERY_UNAUTHENTICATED', message: 'private auth detail' } },
      status: 401,
      expectedHidden: true,
    },
  ];
  const observed = [];
  for (const testCase of cases) {
    const harness = await createMasteryLifecycleHarness();
    try {
      await harness.respond(0, testCase.body, testCase.status);
      observed.push(harness.node('[data-dma-refresh]').hidden);
    } finally {
      harness.cleanup();
    }
  }
  assert.deepEqual(
    observed,
    cases.map(({ expectedHidden }) => expectedHidden)
  );
});

test('F07-R02 Refresh control matrix', async (t) => {
  const retryable500 = {
    ok: false,
    error: { code: 'MASTERY_READ_UNAVAILABLE', message: 'private retryable detail' },
  };
  const terminal400 = {
    ok: false,
    error: { code: 'MASTERY_VALIDATION_ERROR', message: 'private terminal detail' },
  };
  const terminal405 = {
    ok: false,
    error: { code: 'MASTERY_METHOD_NOT_ALLOWED', message: 'private terminal detail' },
  };
  const unauthenticated401 = {
    ok: false,
    error: { code: 'MASTERY_UNAUTHENTICATED', message: 'private auth detail' },
  };
  const unavailable404 = {
    ok: false,
    error: { code: 'NOT_FOUND', message: 'private unavailable detail' },
  };

  function assertRefresh(harness, { hidden, disabled }) {
    assert.equal(harness.node('[data-dma-refresh]').hidden, hidden);
    assert.equal(harness.node('[data-dma-refresh]').disabled, disabled);
  }

  await t.test('1. success exposes enabled Refresh through the canonical request path', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.zero);
    assertRefresh(harness, { hidden: false, disabled: false });
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
    harness.node('[data-dma-refresh]').click();
    assert.equal(harness.requests.length, 2);
    const request = harness.requests[1];
    assert.equal(request.input, 'https://api.tnx6.xyz/api/dungeon/mastery');
    assert.equal(new URL(request.input).search, '');
    assert.equal(request.init.method, 'GET');
    assert.equal(request.init.credentials, 'include');
    assert.equal(request.init.cache, 'no-store');
    assert.equal('body' in request.init, false);
    assert.equal('headers' in request.init, false);
  });

  await t.test('2. 500 exposes enabled Refresh and visible Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    assertRefresh(harness, { hidden: false, disabled: false });
    assert.equal(harness.node('[data-dma-retry]').hidden, false);
  });

  await t.test('3. network failure exposes enabled Refresh and visible Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.reject(0, new TypeError('private network detail'));
    assertRefresh(harness, { hidden: false, disabled: false });
    assert.equal(harness.node('[data-dma-retry]').hidden, false);
  });

  await t.test('4. 400 hides and disables Refresh and hides Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal400, 400);
    assertRefresh(harness, { hidden: true, disabled: true });
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
  });

  await t.test('5. 405 hides and disables Refresh and hides Retry', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal405, 405);
    assertRefresh(harness, { hidden: true, disabled: true });
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
  });

  await t.test('6. 401 hides Refresh and Retry and exposes Login', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, unauthenticated401, 401);
    assertRefresh(harness, { hidden: true, disabled: true });
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
    assert.equal(harness.node('[data-dma-login]').hidden, false);
  });

  await t.test('7. 404 hides the panel and both controls', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, unavailable404, 404);
    assert.equal(harness.rootElement.hidden, true);
    assertRefresh(harness, { hidden: true, disabled: true });
    assert.equal(harness.node('[data-dma-retry]').hidden, true);
  });

  await t.test('8. malformed success is a temporary retryable state', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, { ok: true, mastery: { raw: 'private malformed detail' } });
    assertRefresh(harness, { hidden: false, disabled: false });
    assert.equal(harness.node('[data-dma-retry]').hidden, false);
  });

  await t.test('9. success to terminal hides Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.midRank);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, terminal400, 400);
    assertRefresh(harness, { hidden: true, disabled: true });
  });

  await t.test('10. terminal to fresh success exposes Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal400, 400);
    harness.teardown();
    harness.swapToNewRoot();
    await harness.respond(1, fixture.cases.midRank);
    assertRefresh(harness, { hidden: false, disabled: false });
  });

  await t.test('11. retryable to terminal hides Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, terminal405, 405);
    assertRefresh(harness, { hidden: true, disabled: true });
  });

  await t.test('12. terminal to fresh retryable state exposes Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal400, 400);
    harness.teardown();
    harness.swapToNewRoot();
    await harness.respond(1, retryable500, 500);
    assertRefresh(harness, { hidden: false, disabled: false });
  });

  await t.test('13. success to 401 hides Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.zero);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, unauthenticated401, 401);
    assertRefresh(harness, { hidden: true, disabled: true });
    assert.equal(harness.node('[data-dma-login]').hidden, false);
  });

  await t.test('14. retryable to 404 hides the panel and Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, unavailable404, 404);
    assert.equal(harness.rootElement.hidden, true);
    assertRefresh(harness, { hidden: true, disabled: true });
  });

  await t.test('15. public-profile transition clears and hides Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.midRank);
    harness.setPublic();
    assert.equal(harness.rootElement.hidden, true);
    assertRefresh(harness, { hidden: true, disabled: true });
    assert.equal(harness.requests.length, 1);
  });

  await t.test('16. before-swap disposal clears and hides Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, fixture.cases.midRank);
    harness.teardown();
    assert.equal(harness.rootElement.hidden, true);
    assertRefresh(harness, { hidden: true, disabled: true });
  });

  await t.test('17. retired-root late event cannot re-expose Refresh', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, retryable500, 500);
    harness.teardown();
    harness.routeEvent();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
    assertRefresh(harness, { hidden: true, disabled: true });
  });

  await t.test('18. public to self exposes Refresh only after fresh success', async (t) => {
    const harness = await createMasteryLifecycleHarness({ publicProfile: true });
    t.after(() => harness.cleanup());
    assertRefresh(harness, { hidden: true, disabled: true });
    harness.setSelf();
    assert.equal(harness.requests.length, 1);
    assertRefresh(harness, { hidden: true, disabled: true });
    await harness.respond(0, fixture.cases.zero);
    assertRefresh(harness, { hidden: false, disabled: false });
  });

  await t.test('19. repeated transitions do not retain stale Refresh visibility', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    const observed = [];
    await harness.respond(0, fixture.cases.zero);
    observed.push(harness.node('[data-dma-refresh]').hidden);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(1, retryable500, 500);
    observed.push(harness.node('[data-dma-refresh]').hidden);
    harness.node('[data-dma-refresh]').click();
    await harness.respond(2, terminal400, 400);
    observed.push(harness.node('[data-dma-refresh]').hidden);
    harness.teardown();
    harness.swapToNewRoot();
    await harness.respond(3, fixture.cases.midRank);
    observed.push(harness.node('[data-dma-refresh]').hidden);
    assert.deepEqual(observed, [false, false, true, false]);
  });

  await t.test('20. hidden Refresh is disabled and cannot receive native click activation', async (t) => {
    const harness = await createMasteryLifecycleHarness();
    t.after(() => harness.cleanup());
    await harness.respond(0, terminal400, 400);
    assertRefresh(harness, { hidden: true, disabled: true });
    harness.node('[data-dma-refresh]').click();
    await settleMasteryLifecycle();
    assert.equal(harness.requests.length, 1);
  });
});

test('client lifecycle aborts and cleans observers without storage, unsafe HTML, polling, identity, or mutations', async () => {
  const source = await readFile(new URL('src/scripts/dungeon-mastery-client.ts', root), 'utf8');
  assert.match(source, /AbortController/);
  assert.match(source, /MutationObserver/);
  assert.match(source, /astro:page-load/);
  assert.match(source, /astro:before-swap/);
  assert.match(source, /pagehide/);
  assert.doesNotMatch(
    source,
    /setInterval|localStorage|sessionStorage|innerHTML|set:html|userId|user_id|POST|PUT|PATCH|DELETE/
  );
});

test('source contains no frontend Mastery formulas, fake Rank 11, locked catalog, or backend message rendering', async () => {
  const [model, client, component] = await Promise.all([
    readFile(new URL('src/scripts/dungeon-mastery-model.ts', root), 'utf8'),
    readFile(new URL('src/scripts/dungeon-mastery-client.ts', root), 'utf8'),
    readFile(new URL('src/components/profile/DungeonMasteryPanel.astro', root), 'utf8'),
  ]);
  assert.doesNotMatch(`${client}\n${component}`, /Rank 11|الرتبة ١١|locked|nextRankThreshold\s*[-+*/]/i);
  assert.doesNotMatch(client, /legacyStars\s*=|Math\.(floor|ceil|round)|\.message\b|response\.text/);
  assert.doesNotMatch(model, /thresholds\s*=\s*\[/i);
});

test('styles provide responsive wrapping, visible focus, RTL/LTR isolation, and reduced motion', async () => {
  const [styles, client] = await Promise.all([
    readFile(new URL('src/assets/styles/dungeon-mastery.css', root), 'utf8'),
    readFile(new URL('src/scripts/dungeon-mastery-client.ts', root), 'utf8'),
  ]);
  assert.match(styles, /@media \(max-width: 720px\)/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(styles, /unicode-bidi: isolate/);
  assert.match(client, /english\.dir = 'ltr'/);
});
