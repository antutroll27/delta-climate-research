import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STAGE_WEIGHTS, STAGE_ORDER, SKIP_FAST_MS,
  createProgress, shouldSkipLoader, assertLoaderProgressLogic,
} from '../../src/scripts/climate-engine/loader-progress.ts';

test('the module self-checks', () => { assertLoaderProgressLogic(); });

test('weights sum to exactly 1 — a drifting sum silently rescales the wave', () => {
  const sum = STAGE_ORDER.reduce((t, s) => t + STAGE_WEIGHTS[s], 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, not 1`);
});

test('progress only ever moves forward', () => {
  // The wave radius is drawn from this. A number that dips would suck the city
  // back into the ground mid-rise, which reads as a bug even when loading is fine.
  const p = createProgress();
  const seen = [p.value()];
  for (const s of ['ward', 'shell', 'surface', 'vector', 'sim']) {   // deliberately out of order
    p.complete(s);
    seen.push(p.value());
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], `progress went backwards: ${seen[i-1]} -> ${seen[i]}`);
  }
  assert.equal(seen.at(-1), 1);
});

test('an unknown or repeated stage changes nothing', () => {
  const p = createProgress();
  p.complete('ward');
  const after = p.value();
  p.complete('ward');            // repeat
  p.complete('nonsense');        // typo'd event name
  assert.equal(p.value(), after);
});

test('skip-fast: a warm cache never gets a performance', () => {
  // Under this threshold the overlay must not mount at all — an animation that
  // flashes for 200 ms is worse than no animation.
  assert.equal(SKIP_FAST_MS, 400);
  assert.equal(shouldSkipLoader(399), true);
  assert.equal(shouldSkipLoader(400), false, '400 is the threshold, not below it');
  assert.equal(shouldSkipLoader(401), false);
});

test('every stage is reachable and named once', () => {
  assert.deepEqual([...new Set(STAGE_ORDER)], [...STAGE_ORDER]);
  for (const s of STAGE_ORDER) assert.ok(STAGE_WEIGHTS[s] > 0, `${s} has no weight`);
});
