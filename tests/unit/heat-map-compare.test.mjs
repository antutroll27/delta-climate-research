import assert from 'node:assert/strict';
import test from 'node:test';

import { assertCapsLogic, resolveHeatCaps } from '../../src/scripts/climate-engine/caps.ts';
import { applyInterventions, SIM_N } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { coverageToInterventions, deliveredQuantities } from '../../src/scripts/climate-engine/scenario/coverage.ts';
import { parsePairedScenario, serializePairedScenario } from '../../src/scripts/climate-engine/scenario/scenario-url.ts';
import { normalizeCoverage } from '../../src/scripts/climate-engine/scenario/scenario-state.ts';
import { TsHeatSim } from '../../src/scripts/climate-engine/sim-ts.ts';
import { DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';
import { rasterizeWardBuilt, rasterWardBase } from '../../src/scripts/climate-engine/ward-raster.ts';

test('coverage controls convert once into the existing model units', () => {
  const coverage = normalizeCoverage({ trees: 55, roofs: 65, facades: 35 });
  const interventions = coverageToInterventions(coverage);
  assert.ok(Math.abs(interventions.trees - 27.5) < 1e-9);
  assert.equal(interventions.roof, 65);
  assert.ok(Math.abs(interventions.facades - 5.25) < 1e-9);
});

test('parks is retired from Compare and can never be applied from input', () => {
  // The lever has no control, so no request — URL, default, or otherwise — may
  // reintroduce it. A non-zero value here would be an invisible intervention.
  assert.equal(normalizeCoverage({ parks: 3 }).parks, 0);
  assert.equal(normalizeCoverage({}).parks, 0);
  assert.equal(coverageToInterventions(normalizeCoverage({ parks: 4 })).parks, 0);
  const legacy = parsePairedScenario('?a=ballygunge&b=baruipur&parks=3.5');
  assert.equal(legacy.coverage.parks, 0);
  assert.ok(!serializePairedScenario(legacy).includes('parks'));
});

test('park coverage retains a fractional final patch rather than rounding upward', () => {
  const count = SIM_N * SIM_N;
  const base = {
    albedo: new Float32Array(count).fill(0.12),
    veg: new Float32Array(count),
    built: new Float32Array(count),
    water: new Float32Array(count),
  };
  const spatial = {
    corridorSorted: new Int32Array(), corridorKm: 0,
    parkCenters: [[40, 40], [120, 120]], roofM2: 0, facadeM2: 0,
    cellArea: 53.1, cellM: 7.29,
  };
  /* The park radius is the CITY's, read from the registry — the blob centre this
     asserts on is radius-independent, but the argument must still be the real one. */
  const layers = applyInterventions(base, { trees: 0, roof: 0, parks: 1.5, facades: 0 }, spatial,
    resolve('in/kolkata/ballygunge').climate.parkRadiusM);
  const first = 40 * SIM_N + 40;
  const second = 120 * SIM_N + 120;
  assert.ok(Math.abs(layers.veg[first] - 0.9) < 1e-6);
  assert.ok(Math.abs(layers.veg[second] - 0.45) < 1e-6);
  assert.ok(Math.abs(layers.albedo[second] - 0.16) < 1e-6);
});

// parks is retired from the Compare UI, but its delivered-quantity maths is kept
// for the day the control returns — exercise it directly so it cannot rot.
test('delivered park area reports the requested fractional area', () => {
  const quantities = deliveredQuantities({ trees: 55, roofs: 0, parks: 3, facades: 0 }, {
    corridorSorted: new Int32Array(100), corridorKm: 0,
    parkCenters: Array.from({ length: 10 }, (_, index) => [index * 10, index * 10]),
    roofM2: 500_000, facadeM2: 0, cellArea: 53.1, cellM: 7.29,
  });
  assert.equal(quantities.requestedParkHa, 5.88);
  assert.equal(quantities.appliedParkHa, 5.88);
  assert.equal(quantities.treeCorridorCells, 55);
});

test('all device tiers retain the canonical analytical grid', () => {
  const unavailable = { webgpu: false, floatRenderTargets: false };
  assert.equal(resolveHeatCaps(2, true, unavailable, '').grid, 192);
  assert.equal(resolveHeatCaps(1, true, unavailable, '').grid, 192);
  assert.equal(resolveHeatCaps(0, true, unavailable, '').grid, 192);
});

test('WebGPU alone does not select the WebGL2-only GPU solver', () => {
  const webGpuOnly = { webgpu: true, floatRenderTargets: false };
  assert.equal(resolveHeatCaps(2, true, webGpuOnly, '').backend, 'ts');
  assert.equal(resolveHeatCaps(2, true, { webgpu: true, floatRenderTargets: true }, '').backend, 'gpu');
});

/* caps.ts carries its own runnable self-check. Nothing executed it, so when the
   backend rule was narrowed to WebGL2 float render targets the check kept
   asserting the old rule and failed against the module it lives in — silently,
   because `npm run verify` never ran it. Executing it here is what makes the
   invariant a gate rather than a comment. */
test('the capability module satisfies its own backend invariants', () => {
  assert.doesNotThrow(() => assertCapsLogic());
});

test('footprint rasterisation is deterministic and unions subcell coverage', () => {
  const ward = {
    center: [0, 0],
    sizeM: 4,
    count: 3,
    b: [
      [8, -1, -1, 1, -1, 1, 1, -1, 1],
      [5, -2, -2, -1.5, -2, -1.5, -1.5, -2, -1.5],
      [5, -2, -2, -1.5, -2, -1.5, -1.5, -2, -1.5],
    ],
  };
  const built = rasterizeWardBuilt(ward, 4);
  assert.equal(built.reduce((sum, value) => sum + value, 0), 4.25);
  assert.equal(built[0], 0.25);
  assert.equal(built[5], 1);
  assert.equal(built[6], 1);
  assert.equal(built[9], 1);
  assert.equal(built[10], 1);
  assert.deepEqual(rasterWardBase(ward, 0.2).built, rasterWardBase(ward, 0.2).built);
});

test('scenario URLs normalize duplicate wards and preserve reproducible state', () => {
  const state = parsePairedScenario('?a=ballygunge&b=ballygunge&trees=55.4&roof=63&facades=35.04&phase=retained');
  assert.equal(state.a, 'ballygunge');
  assert.notEqual(state.a, state.b);
  assert.deepEqual(state.coverage, { trees: 55, roofs: 65, parks: 0, facades: 35 });
  const roundTrip = parsePairedScenario(`?${serializePairedScenario(state)}`);
  assert.deepEqual(roundTrip, state);
});

test('TypeScript HeatSim produces stable finite statistics on the canonical grid', () => {
  const count = SIM_N * SIM_N;
  const layers = {
    albedo: new Float32Array(count).fill(0.25),
    veg: new Float32Array(count).fill(0.15),
    built: new Float32Array(count).fill(0.5),
    water: new Float32Array(count),
  };
  const sim = new TsHeatSim();
  sim.reset({ n: SIM_N, cellMeters: 1400 / SIM_N }, layers, DEFAULT_PARAMS);
  sim.step(1, 20);
  const stats = sim.stats();
  assert.ok(Number.isFinite(stats.meanC));
  assert.ok(stats.meanC > 20 && stats.meanC < 60);
  sim.dispose();
});
