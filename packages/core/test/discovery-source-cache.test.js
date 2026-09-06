const test = require('node:test');
const assert = require('node:assert/strict');
const { DiscoverySourceCache } = require('../dist/services/discovery-source-cache.js');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('slow discovery survives the caller timeout and the next fleet refresh sees it', async () => {
  const cache = new DiscoverySourceCache(5, 1000);
  const gate = deferred(); let calls = 0;
  const load = () => { calls++; return gate.promise; };
  assert.deepEqual(await cache.read('codex', load), []);
  assert.deepEqual(await cache.read('codex', load), []);
  assert.equal(calls, 1, 'timed-out refreshes share the original scan');
  gate.resolve([{ root: '/work/current', count: 1 }]);
  await flush();
  const next = deferred();
  assert.deepEqual(await cache.read('codex', () => next.promise), [{ root: '/work/current', count: 1 }]);
  next.resolve([]);
  await flush();
  assert.deepEqual(await cache.read('codex', async () => []), [], 'successful empty results retire old evidence');
});

test('source failures cannot renew cached discovery indefinitely', async () => {
  let now = 0;
  const cache = new DiscoverySourceCache(5, 100, () => now);
  assert.deepEqual(await cache.read('codex', async () => ['current']), ['current']);
  now = 99;
  assert.deepEqual(await cache.read('codex', async () => { throw new Error('offline'); }), ['current']);
  await flush();
  now = 100;
  assert.deepEqual(await cache.read('codex', async () => { throw new Error('offline'); }), []);
  assert.deepEqual(await cache.read('codex', async () => ['recovered']), ['recovered']);
});

test('providers and query scopes keep independent cached results', async () => {
  const cache = new DiscoverySourceCache(5);
  const slow = deferred();
  assert.deepEqual(await cache.read('codex:200', () => slow.promise), []);
  assert.deepEqual(await cache.read('claude:200', async () => ['claude']), ['claude']);
  assert.deepEqual(await cache.read('codex:20', async () => ['small']), ['small']);
  slow.resolve(['large']); await flush();
  assert.deepEqual(await cache.read('codex:200', async () => ['large']), ['large']);
});

test('a hung scan can be superseded and its late result cannot replace recovery', async () => {
  let now = 0;
  const cache = new DiscoverySourceCache(5, 100, () => now, 200);
  const hung = deferred();
  let calls = 0;
  const recovery = deferred();
  assert.deepEqual(await cache.read('codex', () => hung.promise), []);
  now = 199;
  assert.deepEqual(await cache.read('codex', async () => { calls++; return ['early']; }), []);
  assert.equal(calls, 0);
  now = 200;
  assert.deepEqual(await cache.read('codex', () => { calls++; return recovery.promise; }), []);
  assert.equal(calls, 1);
  hung.resolve(['obsolete']);
  await flush();
  assert.deepEqual(await cache.read('codex', async () => { calls++; return ['unexpected']; }), []);
  assert.equal(calls, 1, 'superseded completion cannot clear the replacement scan');
  recovery.resolve(['recovered']);
  await flush();
  assert.deepEqual(await cache.read('codex', async () => ['recovered']), ['recovered']);
});
