import test from 'node:test';
import assert from 'node:assert/strict';

const { createPairedScenarioCache } = await import('../../src/scripts/climate-engine/compare/paired-core.ts');

const stats = (meanC) => ({ meanC, peakC: meanC + 4, fracAbove: 0, thresholdC: 40 });
const result = (meanC) => ({ field: new Float32Array(4), stats: stats(meanC) });

/*
 * A promise cache that keeps rejections is a cache that dies once and stays dead.
 *
 * Compare's baseline solve is cancellable, so the first seconds of a session are
 * exactly when a rejection is most likely: drag the coverage slider and the
 * in-flight run is superseded, which rejects. If that settled rejection stays in
 * the map, every later caller for the same ward/forcing/phase is handed it
 * without the solver ever being re-entered — the spinner clears, no error is
 * raised, the evidence cells sit at "—", and Retry is inert because it re-enters
 * the same poisoned key. The session is silently over.
 *
 * Counting invocations is the point: asserting only that the retry rejects (or
 * only that a later call resolves) passes against a cache that never re-runs the
 * work, which is the whole defect.
 */
test('a rejected baseline is evicted, and the next caller re-enters the solver', async () => {
  const cache = createPairedScenarioCache();
  let calls = 0;
  const create = () => {
    calls += 1;
    return calls === 1 ? Promise.reject(new Error('superseded')) : Promise.resolve(result(31.5));
  };

  await assert.rejects(cache.baseline('ward:forcing:peak', create), /superseded/);
  assert.equal(calls, 1);

  const retried = await cache.baseline('ward:forcing:peak', create);
  assert.equal(calls, 2, 'the poisoned key must not be served to the next caller');
  assert.equal(retried.stats.meanC, 31.5);

  // …and the recovered entry is still cached, so the dedup this Map exists for survives.
  assert.equal((await cache.baseline('ward:forcing:peak', create)).stats.meanC, 31.5);
  assert.equal(calls, 2);
});

test('concurrent callers still share one in-flight baseline solve', async () => {
  const cache = createPairedScenarioCache();
  let calls = 0;
  let settle;
  const create = () => { calls += 1; return new Promise((resolve) => { settle = resolve; }); };

  const first = cache.baseline('shared', create);
  const second = cache.baseline('shared', create);
  assert.equal(calls, 1);
  settle(result(29));
  assert.equal((await first).stats.meanC, 29);
  assert.equal((await second).stats.meanC, 29);
  assert.equal(calls, 1);
});

/*
 * The identity guard. Caches are cleared on an unrecoverable worker error, and a
 * fresh run can claim the same key before the abandoned attempt finishes failing.
 * Deleting by key alone would then evict the healthy new entry and lose the dedup
 * for everyone already awaiting it.
 */
test('a late rejection never evicts the entry that replaced it', async () => {
  const cache = createPairedScenarioCache();
  let failOld;
  const oldAttempt = cache.baseline('key', () => new Promise((_, reject) => { failOld = reject; }));
  const rejected = assert.rejects(oldAttempt, /abandoned/);

  cache.clear();
  let fresh = 0;
  const replacement = await cache.baseline('key', () => { fresh += 1; return Promise.resolve(result(33)); });
  assert.equal(replacement.stats.meanC, 33);

  failOld(new Error('abandoned'));
  await rejected;

  assert.equal((await cache.baseline('key', () => { fresh += 1; return Promise.resolve(result(99)); })).stats.meanC, 33);
  assert.equal(fresh, 1, 'the surviving entry must still be served from cache');
});
