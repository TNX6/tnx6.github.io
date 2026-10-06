import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/pages/profile.astro', import.meta.url), 'utf8');
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const parser = between('      function parseProfileInventory(', '      async function readProfileInventory(');
const reader = between('      async function readProfileInventory(', '      async function refreshProfileInventory(');
const refresher = between('      async function refreshProfileInventory(', '      function catalogItem(');
const payload = (quantity = 4) => ({ ok: true, user: { twitchId: '900000001', login: 'synthetic' }, items: [
  { itemKey: 'food.fish', name: 'Fixture', quantity, totalQuantity: quantity, availableQuantity: quantity - 1, reservedQuantity: 1 },
] });
function context(extra = {}) {
  const sandbox = vm.createContext({ TextDecoder, Uint8Array, AbortController, Set, URL, ...extra });
  vm.runInContext(parser + reader, sandbox);
  return sandbox;
}

test('page removes all legacy exported balance sources without changing LPC assets', () => {
  assert.ok(!source.includes('user_inventory.json'));
  assert.ok(!source.includes('state.inventories'));
  const merge = between('      function mergeUser(', '      function itemName(');
  assert.match(merge, /merged.inventory = \[\]/);
  assert.ok(!merge.includes('profile.inventory'));
  const qty = between('      function itemQty(', '      function parseProfileInventory(');
  assert.match(qty, /Number.isSafeInteger/);
  assert.ok(!qty.includes('Math.max(1'));
});
test('strict reader accepts exact identity and preserves quantity, rejects fabricated quantities', () => {
  const c = context();
  assert.equal(c.parseProfileInventory(payload(), 'synthetic')[0].quantity, 4);
  for (const quantity of [undefined, null, '4', 0, -1, 1.5, 1000000]) {
    const p = payload(); p.items[0].quantity = quantity;
    assert.throws(() => c.parseProfileInventory(p, 'synthetic'));
  }
  const missing = payload(); delete missing.items[0].quantity;
  assert.throws(() => c.parseProfileInventory(missing, 'synthetic'));
});
test('malformed, ambiguous, duplicate and over-reserved responses fail closed', () => {
  const c = context();
  for (const alter of [p => { p.ok = false; }, p => { p.user.login = 'different'; },
    p => { p.user.twitchId = 'internal-account'; }, p => { p.items.push(p.items[0]); },
    p => { p.items[0].availableQuantity = 5; }, p => { p.items[0].name = ''; },
    p => { p.items = new Array(513).fill(p.items[0]); }]) {
    const p = payload(); alter(p); assert.throws(() => c.parseProfileInventory(p, 'synthetic'));
  }
  assert.equal(c.parseProfileInventory({ ...payload(), items: [] }, 'synthetic').length, 0);
});
test('network read is public, no-store, bounded, with no static fallback', async () => {
  let calls = 0;
  const c = context({ fetch: async (url, options) => {
    calls++; assert.equal(url, 'https://api.tnx6.xyz/api/profile/inventory?login=synthetic');
    assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
    return new Response(JSON.stringify(payload()));
  } });
  assert.equal((await c.readProfileInventory('synthetic', new AbortController().signal))[0].quantity, 4);
  assert.equal(calls, 1);
});
test('HTTP errors, oversized body and malformed JSON are unavailable, not empty', async () => {
  for (const response of [new Response('{}', { status: 503 }), new Response('x'.repeat(131073)), new Response('{')]) {
    let calls = 0;
    const c = context({ fetch: async () => { calls++; return response; } });
    await assert.rejects(c.readProfileInventory('synthetic', new AbortController().signal));
    assert.equal(calls, 1);
  }
});
test('actual signal cancellation is respected; no automatic retry', async () => {
  let calls = 0;
  const c = context({ fetch: (_, { signal }) => new Promise((resolve, reject) => {
    calls++; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  const controller = new AbortController(); const promise = c.readProfileInventory('synthetic', controller.signal);
  controller.abort(); await assert.rejects(promise); assert.equal(calls, 1);
});
function ui() {
  const nodes = { inventory: { innerHTML: '' }, inventoryCount: {} };
  const pending = [], rendered = [], state = { activeUser: null };
  const c = vm.createContext({ AbortController, state,
    window: { setTimeout: () => 1, clearTimeout() {} },
    $: key => nodes[key], setText: (key, value) => { nodes[key].text = value; }, userLogin: user => user.login,
    readProfileInventory: (login, signal) => new Promise((resolve, reject) => pending.push({ login, signal, resolve, reject })),
    inventoryItems: user => user.inventory, renderInventory: items => rendered.push(items), chipsFor: () => [], renderChips() {},
  });
  vm.runInContext('let inventorySequence=0; let inventoryRequest=null;\n' + refresher, c);
  return { c, pending, nodes, rendered, state };
}
test('late previous-account response cannot replace the current account inventory', async () => {
  const h = ui(), first = { login: 'first' }, second = { login: 'second' };
  h.state.activeUser = first; const a = h.c.refreshProfileInventory(first, 1, []);
  h.state.activeUser = second; const b = h.c.refreshProfileInventory(second, 1, []);
  assert.equal(h.pending[0].signal.aborted, true);
  h.pending[1].resolve([{ name: 'Second fixture', quantity: 2 }]); await b;
  h.pending[0].resolve([{ name: 'Old fixture', quantity: 99 }]); await a;
  assert.equal(h.rendered.length, 1); assert.equal(h.rendered[0][0].quantity, 2);
});
test('failure renders unavailable and never legacy/empty inventory', async () => {
  const h = ui(), user = { login: 'synthetic', inventory: [] }; h.state.activeUser = user;
  const p = h.c.refreshProfileInventory(user, 1, []); h.pending[0].reject(new Error('offline')); await p;
  assert.equal(h.rendered.length, 0); assert.equal(h.nodes.inventoryCount.text, 'غير متاح مؤقتًا');
  assert.ok(!h.nodes.inventory.innerHTML.includes('الحقيبة فاضية'));
});
test('page cleanup invalidates pending inventory work as well as aborting transport', () => {
  const cleanup = between('      window[cleanupKey] = () => {', '      const state = {');
  assert.match(cleanup, /inventorySequence\+\+/); assert.match(cleanup, /inventoryRequest\?\.abort\(\)/);
});
