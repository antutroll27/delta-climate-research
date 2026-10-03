/**
 * COMPARE PLANS, PRICES AND COUNTS INSIDE THE WARD (pre-ship audit 2026-10-03).
 *
 * Before this, Compare took Ballygunge's RESPONSE inside KMC Ward 68 but planted,
 * priced and counted the plan over the whole 1800 m square (3.24 km², against
 * Baruipur's 1.96). ward-plan.ts restricts the plan to the polygon; these tests run
 * it on the shipped Ballygunge artefacts and on synthetic grids, and drive the real
 * `runPairedScenarioCore` with a stub solver to see what reaches the solve and the
 * bill. The byte-equality of the areas WITHOUT a boundary is proved end to end in
 * the rebuild report (every field, cost and quantity hashed before and after).
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildSpatial, computeCost } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { asWardMask } from '../../src/scripts/climate-engine/ward-mask.ts';
import { rasterWardBase } from '../../src/scripts/climate-engine/ward-raster.ts';
import { requireGrid } from '../../src/scripts/climate-engine/types.ts';
import { resolve, requireCosts } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { coverageToInterventions, deliveredQuantities } from '../../src/scripts/climate-engine/scenario/coverage.ts';
import { DEFAULT_PAIRED_SCENARIO } from '../../src/scripts/climate-engine/scenario/scenario-state.ts';
import { confineToWard, roadKmInWard, wardSpatial } from '../../src/scripts/climate-engine/compare/ward-plan.ts';
import { runPairedScenarioCore } from '../../src/scripts/climate-engine/compare/paired-core.ts';
import { statsOverLabel } from '../../src/scripts/climate-engine/compare/paired-protocol.ts';

const json = async (rel) => JSON.parse(await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const WARD = await json('public/heat-map/data/ballygunge.json');
const ROADS = await json('public/heat-map/data/ballygunge-roads.json');
const N = requireGrid(WARD.sizeM).n;
const MASK = asWardMask(await json('public/heat-map/data/ballygunge-ward.json'), { area: 'ballygunge', sizeM: WARD.sizeM, n: N, buildings: WARD.b.length });
const BASE = rasterWardBase(WARD, { fvc: 0.22, albedo: 0.123 });
const SQUARE = buildSpatial(WARD, BASE, ROADS);
const PARK_R = resolve('in/kolkata/ballygunge').climate.parkRadiusM;
const PLAN = wardSpatial(SQUARE, MASK, WARD, ROADS, BASE, PARK_R);

test('no boundary: the square\'s own objects come back untouched', () => {
  assert.equal(wardSpatial(SQUARE, null, WARD, ROADS, BASE, PARK_R), SQUARE);
  const planned = { ...BASE, albedo: BASE.albedo.map((v) => v + 0.1) };
  assert.equal(confineToWard(BASE, planned, null), planned);
});

test('Ballygunge\'s plan targets only cells inside KMC Ward 68, in the model\'s own priority order', () => {
  assert.ok(PLAN.corridorSorted.length > 0 && PLAN.corridorSorted.length < SQUARE.corridorSorted.length);
  for (const i of PLAN.corridorSorted) assert.equal(MASK.cells[i], 1, `corridor cell ${i} is outside the ward`);
  const inWardOrder = SQUARE.corridorSorted.filter((i) => MASK.cells[i] === 1);
  assert.deepEqual([...PLAN.corridorSorted], [...inWardOrder], 'the priority order changed');
  const r = Math.round(PARK_R / SQUARE.cellM);
  for (const [cx, cy] of PLAN.parkCenters) {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) assert.equal(MASK.cells[y * N + x], 1, 'a park disc reaches outside the ward');
    }
  }
});

test('the plan\'s quantities are the ward\'s: roofs over in-ward cells, facades of in-ward buildings, roads inside', () => {
  let roof = 0;
  for (let j = 0; j < N * N; j++) if (MASK.cells[j]) roof += BASE.built[j] * SQUARE.cellArea;
  assert.ok(Math.abs(PLAN.roofM2 - roof) < 1e-6 * roof);
  const facades = buildSpatial({ ...WARD, b: WARD.b.filter((_, i) => MASK.inWard[i] === 1) }, BASE, null).facadeM2;
  assert.equal(PLAN.facadeM2, facades);
  /* each of these is the ward's share of the square, not the square */
  for (const k of ['roofM2', 'facadeM2', 'corridorKm']) {
    const share = PLAN[k] / SQUARE[k];
    assert.ok(share > 0.15 && share < 0.45, `${k}: the ward holds ${(share * 100).toFixed(1)} % of the square's`);
  }
});

test('road length inside the ward is measured, not scaled: a synthetic road through half a mask is half its length', () => {
  const ward = { center: [0, 0], sizeM: 1400, count: 0, b: [] };
  const n = requireGrid(1400).n;
  const east = { name: 't', licence: 'x', attribution: 'x', areaM2: 1, ring: [0, 0, 1, 0, 1, 1], n, cells: new Uint8Array(n * n), cellCount: 0, inWard: new Uint8Array(0), inWardCount: 0 };
  for (let gy = 0; gy < n; gy++) for (let gx = n / 2; gx < n; gx++) east.cells[gy * n + gx] = 1;
  const road = { ways: [{ w: 2, p: [-500, 10, 500, 10] }] };
  assert.ok(Math.abs(roadKmInWard(ward, road, east) - 0.5) < 0.01);
  const all = { ...east, cells: new Uint8Array(n * n).fill(1) };
  assert.ok(Math.abs(roadKmInWard(ward, road, all) - 1.0) < 1e-9);
  /* north is +y: a road on the south half is outside a NORTH-half mask */
  const north = { ...east, cells: new Uint8Array(n * n) };
  for (let gy = n / 2; gy < n; gy++) for (let gx = 0; gx < n; gx++) north.cells[gy * n + gx] = 1;
  assert.equal(roadKmInWard(ward, { ways: [{ w: 1, p: [-500, -300, 500, -300] }] }, north), 0);
  assert.ok(Math.abs(roadKmInWard(ward, { ways: [{ w: 1, p: [-500, 300, 500, 300] }] }, north) - 1) < 1e-9);
});

test('nothing the plan does lands on a context cell', () => {
  const planned = { ...BASE, albedo: BASE.albedo.map((v) => v + 0.2), veg: BASE.veg.map((v) => v + 0.3) };
  const out = confineToWard(BASE, planned, MASK);
  for (let i = 0; i < N * N; i++) {
    if (MASK.cells[i]) { assert.equal(out.albedo[i], planned.albedo[i]); assert.equal(out.veg[i], planned.veg[i]); }
    else { assert.equal(out.albedo[i], BASE.albedo[i]); assert.equal(out.veg[i], BASE.veg[i]); }
  }
});

test('runPairedScenarioCore: Ballygunge\'s scenario changes only in-ward cells, and its bill and quantities are the ward plan\'s', async () => {
  const prepared = { wardData: WARD, roads: ROADS, base: BASE, spatial: SQUARE, planSpatial: PLAN, boundary: MASK };
  const nB = requireGrid(1400).n;
  const other = { wardData: { center: [0, 0], sizeM: 1400, count: 0, b: [] }, roads: { ways: [] },
    base: { albedo: new Float32Array(nB * nB).fill(0.12), veg: new Float32Array(nB * nB), built: new Float32Array(nB * nB), water: new Float32Array(nB * nB) },
    spatial: null, planSpatial: null, boundary: null };
  other.spatial = buildSpatial(other.wardData, other.base, null); other.planSpatial = other.spatial;
  const cache = {
    ward: async (id) => (id === 'in/kolkata/ballygunge' ? prepared : other),
    baseline: (_key, create) => create().then(({ stats }) => ({ stats })),
    clear() {},
  };
  const seen = [];
  const runField = async (request) => {
    seen.push(request.layers);
    const n = request.grid.n;
    return { field: new Float32Array(n * n).fill(40), stats: { meanC: 40, peakC: 40, fracAbove: 0, thresholdC: 40 } };
  };
  const state = { ...DEFAULT_PAIRED_SCENARIO, coverage: { trees: 60, roofs: 70, parks: 0, facades: 40 } };
  const result = await runPairedScenarioCore(state, cache, { backendVersion: 'ts-main-cooperative-v1', runField, nowIso: () => 't' });
  const scenario = seen.find((layers) => layers.albedo.length === N * N && layers !== BASE);
  assert.ok(scenario, 'no Ballygunge scenario reached the solver');
  let changedIn = 0;
  for (let i = 0; i < N * N; i++) {
    const moved = scenario.albedo[i] !== BASE.albedo[i] || scenario.veg[i] !== BASE.veg[i];
    if (!MASK.cells[i]) assert.ok(!moved, `context cell ${i} was planted`);
    else if (moved) changedIn++;
  }
  assert.ok(changedIn > 1000, `only ${changedIn} in-ward cells changed`);
  const iv = coverageToInterventions(state.coverage);
  const costs = requireCosts(resolve('in/kolkata/ballygunge'));
  assert.equal(result.a.capitalCost, computeCost(iv, PLAN, costs));
  assert.ok(result.a.capitalCost < 0.45 * computeCost(iv, SQUARE, costs), 'the bill is still the square\'s');
  assert.deepEqual(result.a.delivered, deliveredQuantities(state.coverage, PLAN));
  assert.deepEqual(result.a.statsOver, { name: 'KMC Ward 68', areaM2: MASK.areaM2 });
  assert.equal(result.a.boundaryRing, MASK.ring);
  assert.equal(result.b.statsOver, null);
  assert.equal(result.b.boundaryRing, null);
  assert.equal(statsOverLabel(result.a), 'inside KMC Ward 68 (0.93 km²)');
  assert.equal(statsOverLabel(result.b), '1.4 km study window');
});
