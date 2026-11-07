import assert from 'node:assert/strict';
import test from 'node:test';

import { ResidencyCache, lruVictims, releasable } from '../../src/scripts/climate-engine/streaming/sheet-cache.ts';

/* THE POINT OF A BOUNDED CACHE IS THAT EVICTION GIVES MEMORY BACK. Every test here counts `release()` calls, because an
   entry that left the map without being released is exactly the leak the per-ward caches have today. */

function item(bytes, log, name) {
  return releasable(bytes, () => log.push(`release ${name}`));
}

test('lruVictims takes the least recently used first, skips pins, and stops when the caps hold', () => {
  const e = (key, usedSeq, bytes = 1, pinned = false) => ({ key, usedSeq, bytes, pinned });
  assert.deepEqual(lruVictims([e('a', 1), e('b', 2), e('c', 3)], { maxEntries: 2, maxBytes: 99 }), ['a']);
  assert.deepEqual(lruVictims([e('a', 1), e('b', 2), e('c', 3)], { maxEntries: 1, maxBytes: 99 }), ['a', 'b']);
  assert.deepEqual(lruVictims([e('a', 1, 1, true), e('b', 2), e('c', 3)], { maxEntries: 1, maxBytes: 99 }), ['b', 'c'], 'the pin stays even over the cap');
  assert.deepEqual(lruVictims([e('a', 1, 40), e('b', 2, 40), e('c', 3, 40)], { maxEntries: 9, maxBytes: 100 }), ['a']);
  assert.deepEqual(lruVictims([e('a', 1)], { maxEntries: 1, maxBytes: 99 }), []);
  assert.deepEqual(lruVictims([], { maxEntries: 1, maxBytes: 1 }), []);
});

test('set evicts the oldest and RELEASES it, exactly once', () => {
  const log = [];
  const seen = [];
  const cache = new ResidencyCache({ maxEntries: 2, maxBytes: 1000 }, (key) => seen.push(key));
  cache.set('E4', item(10, log, 'E4'));
  cache.set('F4', item(10, log, 'F4'));
  cache.get('E4');                                      // E4 is now newer than F4
  assert.deepEqual(cache.set('G4', item(10, log, 'G4')), ['F4']);
  assert.deepEqual(log, ['release F4']);
  assert.deepEqual(seen, ['F4']);
  assert.deepEqual(cache.keys().sort(), ['E4', 'G4']);
  assert.equal(cache.has('F4'), false);
});

test('the byte cap evicts too; an entry too big for the cap on its own is released at once', () => {
  const log = [];
  const cache = new ResidencyCache({ maxEntries: 10, maxBytes: 100 });
  cache.set('a', item(60, log, 'a'));
  assert.deepEqual(cache.set('b', item(60, log, 'b')), ['a']);
  assert.equal(cache.bytes, 60);
  assert.deepEqual(cache.set('huge', item(500, log, 'huge')), ['b', 'huge'], 'the oversize entry does not push the others out and stay');
  assert.equal(cache.size, 0);
  assert.deepEqual(log, ['release a', 'release b', 'release huge']);
});

test('pinned entries are never victims; the cache says it is over budget instead, and unpin settles it', () => {
  const log = [];
  const cache = new ResidencyCache({ maxEntries: 1, maxBytes: 1000 });
  cache.set('current', item(10, log, 'current'), { pinned: true });
  assert.deepEqual(cache.set('next', item(10, log, 'next'), { pinned: true }), []);
  assert.equal(cache.size, 2);
  assert.equal(cache.overBudget, true);
  assert.deepEqual(cache.unpin('current'), ['current']);
  assert.deepEqual(log, ['release current']);
  assert.equal(cache.overBudget, false);
});

test('replacing a key releases the old value; the same value is not released', () => {
  const log = [];
  const cache = new ResidencyCache({ maxEntries: 3, maxBytes: 1000 });
  const first = item(5, log, 'first');
  cache.set('k', first);
  cache.set('k', first);
  assert.deepEqual(log, []);
  cache.set('k', item(5, log, 'second'));
  assert.deepEqual(log, ['release first']);
  assert.equal(cache.size, 1);
});

test('resize (a tier change) evicts to fit; delete and clear release what they remove', () => {
  const log = [];
  const cache = new ResidencyCache({ maxEntries: 3, maxBytes: 1000 });
  for (const k of ['a', 'b', 'c']) cache.set(k, item(1, log, k));
  assert.deepEqual(cache.resize({ maxEntries: 1, maxBytes: 1000 }), ['a', 'b']);
  assert.equal(cache.delete('c'), true);
  assert.equal(cache.delete('c'), false);
  cache.set('d', item(1, log, 'd'));
  cache.clear();
  assert.deepEqual(log, ['release a', 'release b', 'release c', 'release d']);
  assert.equal(cache.size, 0);
});

test('peek does not count as a use; get does', () => {
  const log = [];
  const cache = new ResidencyCache({ maxEntries: 2, maxBytes: 1000 });
  cache.set('a', item(1, log, 'a'));
  cache.set('b', item(1, log, 'b'));
  cache.peek('a');
  assert.deepEqual(cache.set('c', item(1, log, 'c')), ['a']);
});

test('a release that throws does not stop the others being freed; the failure is rethrown afterwards', () => {
  const log = [];
  const bad = { byteSize: 1, release() { log.push('bad'); throw new Error('dispose failed'); } };
  const cache = new ResidencyCache({ maxEntries: 5, maxBytes: 1000 });
  cache.set('bad', bad);
  cache.set('ok', item(1, log, 'ok'));
  assert.throws(() => cache.clear(), /dispose failed/);
  assert.deepEqual(log.sort(), ['bad', 'release ok']);
  assert.equal(cache.size, 0, 'both were removed from the cache despite the failure');

  const cache2 = new ResidencyCache({ maxEntries: 5, maxBytes: 1000 });
  const bad2 = { byteSize: 1, release() { throw new Error('x'); } };
  cache2.set('a', bad2); cache2.set('b', { ...bad2 });
  assert.throws(() => cache2.clear(), (e) => e instanceof AggregateError && e.errors.length === 2);
});

test('releasable runs its steps once however often it is released', () => {
  const log = [];
  const r = releasable(7, () => log.push('geometry.dispose'), () => log.push('array = null'));
  r.release(); r.release();
  assert.deepEqual(log, ['geometry.dispose', 'array = null']);
  assert.equal(r.byteSize, 7);
});

test('a cache must have room for at least one entry', () => {
  assert.throws(() => new ResidencyCache({ maxEntries: 0, maxBytes: 10 }), RangeError);
  assert.throws(() => new ResidencyCache({ maxEntries: 1, maxBytes: 0 }), RangeError);
  assert.throws(() => new ResidencyCache({ maxEntries: 1, maxBytes: 10 }).resize({ maxEntries: 0, maxBytes: 1 }), RangeError);
});
