import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireGrid,
  gridVersion,
  DEFAULT_PARAMS,
} from '../../src/scripts/climate-engine/types.ts';
import { assertHeatRequest, isCurrentSnapshot } from '../../src/scripts/climate-engine/sim-protocol.ts';

/* Kolkata's admitted pair — 192 cells over a 1400 m ward. */
const GRID_N = requireGrid(1400).n;

const count = GRID_N * GRID_N;
const request = () => ({
  generation: 2,
  grid: { n: GRID_N, cellMeters: 1400 / GRID_N },
  layers: {
    albedo: new Float32Array(count), veg: new Float32Array(count),
    built: new Float32Array(count), water: new Float32Array(count),
  },
  params: DEFAULT_PARAMS, settleSteps: 0, thresholdC: 40,
});

test('heat protocol accepts only canonical complete requests', () => {
  assert.doesNotThrow(() => assertHeatRequest(request()));
  const bad = request(); bad.grid.n = 64;
  assert.throws(() => assertHeatRequest(bad), /canonical grid/);
});

test('only a current canonical snapshot may update Explore', () => {
  const snapshot = {
    generation: 2, backend: 'ts-worker', field: new Float32Array(count),
    stats: { meanC: 31, peakC: 35, fracAbove: 0, thresholdC: 40 }, gridVersion: gridVersion(1400),
  };
  assert.equal(isCurrentSnapshot(snapshot, 2), true);
  assert.equal(isCurrentSnapshot(snapshot, 3), false);
});
