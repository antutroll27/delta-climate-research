import assert from 'node:assert/strict';
import test from 'node:test';

import { runTsFieldCooperatively } from '../../src/scripts/climate-engine/sim-cooperative.ts';
import { TsHeatSim } from '../../src/scripts/climate-engine/sim-ts.ts';
import { CANONICAL_GRID_N, DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';

const count = CANONICAL_GRID_N * CANONICAL_GRID_N;
const layers = () => ({
  albedo: new Float32Array(count).fill(0.2),
  veg: new Float32Array(count).fill(0.25),
  built: new Float32Array(count).fill(0.45),
  water: new Float32Array(count),
});

test('cooperative TypeScript execution preserves the canonical settled field', async () => {
  const grid = { n: CANONICAL_GRID_N, cellMeters: 1400 / CANONICAL_GRID_N };
  const direct = new TsHeatSim();
  const source = layers();
  direct.reset(grid, source, DEFAULT_PARAMS);
  direct.step(1, 600);
  const expected = direct.temperature().slice();
  const expectedStats = direct.stats(40);
  direct.dispose();

  let yields = 0;
  const actual = await runTsFieldCooperatively({
    grid,
    layers: source,
    params: DEFAULT_PARAMS,
    steps: 600,
    thresholdC: 40,
    maxStepsPerSlice: 24,
    now: () => 0,
    yieldControl: async () => { yields += 1; },
  });
  assert.ok(yields > 0);
  assert.deepEqual(actual.field, expected);
  assert.equal(actual.stats.meanC, expectedStats.meanC);
  assert.equal(actual.stats.peakC, expectedStats.peakC);
});

test('cooperative execution observes cancellation between slices', async () => {
  const controller = new AbortController();
  let yields = 0;
  await assert.rejects(
    runTsFieldCooperatively({
      grid: { n: CANONICAL_GRID_N, cellMeters: 1400 / CANONICAL_GRID_N },
      layers: layers(),
      params: DEFAULT_PARAMS,
      steps: 600,
      thresholdC: 40,
      maxStepsPerSlice: 8,
      now: () => 0,
      signal: controller.signal,
      yieldControl: async () => {
        yields += 1;
        controller.abort();
      },
    }),
    { name: 'AbortError' },
  );
  assert.equal(yields, 1);
});
