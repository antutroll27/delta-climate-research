import assert from 'node:assert/strict';
import test from 'node:test';

import { createHaloSimHost, isSheetRequest } from '../../src/scripts/climate-engine/streaming/halo-sim-host.ts';
import { expandLayers, haloAssetBytes, neighboursOf, quantiseLayers } from '../../src/scripts/climate-engine/streaming/halo-asset.ts';
import { SHEET_HALO, assembleHaloLayers, haloN } from '../../src/scripts/climate-engine/streaming/halo-solve.ts';
import { TsHeatSim } from '../../src/scripts/climate-engine/sim-ts.ts';
import { DEFAULT_PARAMS, gridFor } from '../../src/scripts/climate-engine/types.ts';

const N = 384, COUNT = N * N;
const flat = (a, v, b, w) => ({ albedo: new Float32Array(COUNT).fill(a), veg: new Float32Array(COUNT).fill(v), built: new Float32Array(COUNT).fill(b), water: new Float32Array(COUNT).fill(w) });
const request = (layers) => ({ generation: 7, grid: { n: N, cellMeters: 2800 / N }, sizeM: 2800, layers, params: { ...DEFAULT_PARAMS, tAir: 20, tSky: 10, wind: 0.5 }, settleSteps: 10, thresholdC: 30 });

/** A host whose field is a ramp over the 504 grid, so the crop is checkable cell by cell. */
function rampHost() {
  const seen = [];
  const N2 = haloN(SHEET_HALO);
  const field = Float32Array.from({ length: N2 * N2 }, (_, i) => Math.floor(i / N2) * 1000 + (i % N2));
  return {
    seen,
    host: {
      backend: 'ts-main',
      async reset(r) { seen.push(r); return { generation: r.generation, backend: 'ts-main', field, stats: { meanC: -1, peakC: -1, fracAbove: -1, thresholdC: r.thresholdC }, gridVersion: gridFor(r.sizeM).version }; },
      async advance(g) { return { generation: g, backend: 'ts-main', field, stats: { meanC: -1, peakC: -1, fracAbove: -1, thresholdC: 30 }, gridVersion: gridFor(3675).version }; },
      dispose() { seen.push('disposed'); },
    },
  };
}

test('a sheet request is solved on 504 cells over 3,675 m and answered on its own 384-cell grid', async () => {
  const { host: inner, seen } = rampHost();
  const host = createHaloSimHost(inner, () => ({ n: flat(0.3, 0.1, 0.8, 0) }));
  const snapshot = await host.reset(request(flat(0.2, 0.2, 0.2, 0)));
  const sent = seen[0];
  assert.equal(sent.grid.n, 504); assert.equal(sent.sizeM, 3675); assert.equal(sent.layers.albedo.length, 504 * 504);
  assert.equal(snapshot.field.length, COUNT);
  assert.equal(snapshot.gridVersion, gridFor(2800).version);
  assert.equal(snapshot.generation, 7);
  assert.equal(snapshot.field[0], 60 * 1000 + 60, 'core cell (0,0) is halo-grid cell (60,60)');
  assert.equal(snapshot.field[COUNT - 1], (60 + 383) * 1000 + (60 + 383));
  // the neighbour's ground sits where the north neighbour is: rows >= 60 + 384
  assert.ok(Math.abs(sent.layers.albedo[(60 + 384 + 5) * 504 + 100] - 0.3) < 1e-6);
  assert.ok(Math.abs(sent.layers.albedo[100 * 504 + 100] - 0.2) < 1e-6, 'the core');
});

test('statistics are over the core only, with the request\'s threshold', async () => {
  const { host: inner } = rampHost();
  const host = createHaloSimHost(inner, () => null);
  const s = await host.reset(request(flat(0.2, 0.2, 0.2, 0)));
  assert.notEqual(s.stats.meanC, -1);
  assert.equal(s.stats.thresholdC, 30);
  let sum = 0; for (const v of s.field) sum += v;
  assert.ok(Math.abs(s.stats.meanC - sum / COUNT) < 1e-3);
  const next = await host.advance(7, 5);
  assert.equal(next.field.length, COUNT);
  assert.equal(next.stats.thresholdC, 30);
});

test('a request that is not a sheet\'s passes through untouched, and so does dispose', async () => {
  const { host: inner, seen } = rampHost();
  const host = createHaloSimHost(inner, () => null);
  const kolkata = { ...request(flat(0, 0, 0, 0)), grid: { n: 192, cellMeters: 1400 / 192 }, sizeM: 1400, layers: { albedo: new Float32Array(192 * 192), veg: new Float32Array(192 * 192), built: new Float32Array(192 * 192), water: new Float32Array(192 * 192) } };
  assert.equal(isSheetRequest(kolkata), false);
  await host.reset(kolkata);
  assert.equal(seen[0], kolkata);
  host.dispose();
  assert.equal(seen[1], 'disposed');
});

test('the real CPU solver behind the adapter: uniform ground gives a uniform core, with or without neighbours', async () => {
  const sim = new TsHeatSim();
  const inner = {
    backend: 'ts-main',
    async reset(r) { sim.reset(r.grid, r.layers, r.params); sim.step(0.2, r.settleSteps); return { generation: r.generation, backend: 'ts-main', field: sim.temperature(), stats: sim.stats(r.thresholdC), gridVersion: gridFor(r.sizeM).version }; },
    async advance(g, steps) { sim.step(0.2, steps); return { generation: g, backend: 'ts-main', field: sim.temperature(), stats: sim.stats(30), gridVersion: gridFor(3675).version }; },
    dispose() {},
  };
  const host = createHaloSimHost(inner, () => null);
  const s = await host.reset({ ...request(flat(0.2, 0.2, 0.2, 0)), settleSteps: 40 });
  let lo = Infinity, hi = -Infinity; for (const v of s.field) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(hi - lo < 1e-3, `uniform ground should solve uniform (${lo}..${hi})`);
});

test('quantised halo layers round-trip within one 1/255 step and weigh a quarter of the floats', () => {
  const layers = flat(0.2, 0.37, 0.81, 0);
  const q = quantiseLayers(layers), back = expandLayers(q);
  for (const k of ['albedo', 'veg', 'built', 'water']) assert.ok(Math.abs(back[k][17] - layers[k][17]) <= 0.5 / 255 + 1e-6, k);
  assert.equal(haloAssetBytes({ n: q }), 4 * COUNT);
  assert.equal(Object.keys(neighboursOf({ n: q, e: q })).sort().join(), 'e,n');
});

test('assembling from a quantised asset equals assembling from its expanded floats, bit for bit', () => {
  const rnd = (seed) => { let s = seed; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); };
  const r = rnd(5);
  const noisy = () => { const l = flat(0, 0, 0, 0); for (const k of Object.keys(l)) for (let i = 0; i < COUNT; i++) l[k][i] = r(); return l; };
  const core = noisy(), q = { n: quantiseLayers(noisy()), se: quantiseLayers(noisy()) };
  const viaBytes = assembleHaloLayers(SHEET_HALO, core, neighboursOf(q));
  const viaFloats = assembleHaloLayers(SHEET_HALO, core, { n: expandLayers(q.n), se: expandLayers(q.se) });
  for (const k of ['albedo', 'veg', 'built', 'water']) assert.deepEqual(viaBytes.layers[k], viaFloats.layers[k], k);
  assert.deepEqual(viaBytes.missing, viaFloats.missing);
});
