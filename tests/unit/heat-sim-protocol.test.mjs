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
  /* The request carries its ward size: the protocol admits (grid, ward size) as
     a PAIR, and half a pair cannot be checked at all. */
  sizeM: 1400,
});

test('heat protocol accepts only complete requests on an admitted pair', () => {
  assert.doesNotThrow(() => assertHeatRequest(request()));
  const bad = request(); bad.grid.n = 64;
  assert.throws(() => assertHeatRequest(bad), /does not pair with a 1400 m ward/);
});

test("only a current snapshot, on THIS ward size's grid, may update Explore", () => {
  const snapshot = {
    generation: 2, backend: 'ts-worker', field: new Float32Array(count),
    stats: { meanC: 31, peakC: 35, fracAbove: 0, thresholdC: 40 }, gridVersion: gridVersion(1400),
  };
  assert.equal(isCurrentSnapshot(snapshot, 2, 1400), true);
  assert.equal(isCurrentSnapshot(snapshot, 3, 1400), false);

  /* THE CASE "IS IT ANY ADMITTED GRID" CANNOT SEE. Both versions are admitted,
     so that weaker form passed a 2800 m field as current for a 1400 m view —
     a field of 384² cells reaching a ward solved on 192², which this gate is
     the last place to refuse. Only equality against the REQUESTED size does. */
  assert.equal(isCurrentSnapshot({ ...snapshot, gridVersion: gridVersion(2800) }, 2, 1400), false,
    "a 2800 m ward's field is not current for a 1400 m ward");
  assert.equal(isCurrentSnapshot(snapshot, 2, 999), false,
    'an unadmitted ward size answers false rather than throwing out of a predicate');
});
