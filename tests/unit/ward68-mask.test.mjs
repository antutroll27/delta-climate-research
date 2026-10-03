/**
 * Ballygunge IS KMC Ward 68 (founder, 2026-10-02): the boundary artefact, and every
 * ward statistic taken inside it.
 *
 * Two halves. The MODULE half runs ward-mask.ts on synthetic and on the shipped
 * artefact; the ARTEFACT half checks that what the page prints for Ballygunge —
 * the solar headline, the DC-URS inputs, the building count — is the polygon's and
 * not the 1800 m square's. The source-level guard over heat-map-app.ts is in
 * ward68-stats-guard.test.mjs.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  asWardMask, buildingInWard, decodeRle, densifyRing, fieldHistogram, fieldStats, wardRows,
} from '../../src/scripts/climate-engine/ward-mask.ts';
import { wardMaskPath, paths } from '../../src/scripts/climate-engine/scope/paths.ts';
import { prefetchPlan } from '../../src/scripts/climate-engine/ward-prefetch.ts';
import { wardRoi } from '../../src/scripts/climate-engine/solar-roi.ts';

const json = async (rel) => JSON.parse(await readFile(new URL(`../../${rel}`, import.meta.url), 'utf8'));
const MASK = await json('public/heat-map/data/ballygunge-ward.json');
const WARD = await json('public/heat-map/data/ballygunge.json');
const PV = await json('public/heat-map/data/pv-ballygunge.json');
const EXPECT = { area: 'ballygunge', sizeM: 1800, n: 247, buildings: WARD.b.length };
const quiet = (fn) => { const w = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = w; } };

/* ── the module ─────────────────────────────────────────────────────────────── */

test('run lengths decode from an OUTSIDE run first, and refuse runs that do not tile the grid', () => {
  assert.deepEqual([...decodeRle([0, 2, 1, 1], 4)], [1, 1, 0, 1]);
  assert.deepEqual([...decodeRle([2, 2], 4)], [0, 0, 1, 1]);
  assert.throws(() => decodeRle([2, 3], 4), /overruns/);
  assert.throws(() => decodeRle([1, 1], 4), /cover 2 of 4/);
});

test('the shipped boundary is accepted for Ballygunge and decodes to its declared counts', () => {
  const m = asWardMask(MASK, EXPECT);
  assert.ok(m, 'the shipped artefact was refused');
  assert.equal(m.name, 'KMC Ward 68');
  assert.equal(m.cellCount, 17_442);
  assert.equal(m.inWardCount, 2_207);
  assert.equal(m.cells.length, 247 * 247);
  assert.equal(m.inWard.length, 7_931);
});

test('a boundary for another domain, grid or building table is refused, never misread', () => {
  const refused = (raw, expect = EXPECT) => quiet(() => asWardMask(raw, expect)) === null;
  assert.ok(refused(MASK, { ...EXPECT, area: 'barrackpore' }), 'wrong ward accepted');
  assert.ok(refused(MASK, { ...EXPECT, sizeM: 1400 }), 'wrong domain accepted');
  assert.ok(refused(MASK, { ...EXPECT, n: 192 }), 'wrong grid accepted');
  assert.ok(refused(MASK, { ...EXPECT, buildings: 7_930 }), 'a building table of another length accepted');
  assert.ok(refused({ ...MASK, inWardCount: 2_206 }), 'a declared count the flags do not add up to was accepted');
  assert.ok(refused({ ...MASK, grid: { ...MASK.grid, cells: 17_441 } }), 'a declared cell count the runs do not add up to was accepted');
  assert.ok(refused({ ...MASK, grid: { ...MASK.grid, rows: 'north-up' } }), 'a north-up grid accepted as the solver grid');
  assert.ok(refused({ ...MASK, ring: [0, 0, 1] }), 'a non-polygon ring accepted');
  assert.ok(refused(null));
});

/** Even-odd point in polygon, ring flat [x, y, …]. */
function inside(ring, x, y) {
  let c = false;
  for (let i = 0, j = ring.length / 2 - 1; i < ring.length / 2; j = i++) {
    const xi = ring[i * 2], yi = ring[i * 2 + 1], xj = ring[j * 2], yj = ring[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

test('the solver mask is the ring\'s cells, SOUTH-up — the field\'s own layout, never its mirror', () => {
  /* Settled by numbers, not by eye (the project has shipped a mirror once). Every
     cell centre is tested against the ring in the solver's layout: index gy*n+gx,
     gy = 0 the SOUTHERN row. A north–south flip of the same mask must disagree. */
  const m = asWardMask(MASK, EXPECT);
  const n = 247, cell = 1800 / n;
  let agree = 0, mirrorAgree = 0;
  for (let gy = 0; gy < n; gy++) for (let gx = 0; gx < n; gx++) {
    const truth = inside(MASK.ring, -900 + (gx + 0.5) * cell, -900 + (gy + 0.5) * cell) ? 1 : 0;
    if (m.cells[gy * n + gx] === truth) agree++;
    if (m.cells[(n - 1 - gy) * n + gx] === truth) mirrorAgree++;
  }
  assert.ok(n * n - agree <= 2, `${n * n - agree} cells disagree with the ring`);
  assert.ok(n * n - mirrorAgree > 1_000, 'a north-south mirror of the mask agrees with the ring — the test cannot see orientation');
});

test('field statistics are the polygon\'s with a mask, and the whole field\'s without one', () => {
  const m = asWardMask(MASK, EXPECT);
  const field = new Float32Array(247 * 247);
  for (let i = 0; i < field.length; i++) field[i] = m.cells[i] ? 45 : 30;
  const ward = fieldStats(field, m, 40);
  assert.equal(ward.meanC, 45);
  assert.equal(ward.peakC, 45);
  assert.equal(ward.fracAbove, 1);
  assert.equal(ward.cells, 17_442);
  const square = fieldStats(field, null, 40);
  assert.ok(Math.abs(square.meanC - (45 * 17_442 + 30 * (field.length - 17_442)) / field.length) < 1e-9);
  assert.ok(Math.abs(square.fracAbove - 17_442 / field.length) < 1e-12);
  const bins = fieldHistogram(field, m, 26, 48, 12);
  assert.equal(bins.reduce((a, b) => a + b, 0), 17_442, 'the histogram counts cells outside the ward');
  assert.equal(bins[Math.floor((45 - 26) / 22 * 12)], 17_442);
  assert.equal(fieldHistogram(field, null, 26, 48, 12).reduce((a, b) => a + b, 0), field.length);
  assert.throws(() => fieldStats(new Float32Array(10), m, 40), /cells over a 10-cell field/);
});

test('the ward\'s buildings are the ones whose footprint touches the polygon, row for row', async () => {
  const m = asWardMask(MASK, EXPECT);
  const foot = await json('data/geometry/ballygunge-footprints.json');
  assert.equal(foot.b.length, m.inWard.length);
  foot.b.forEach((row, i) => assert.equal(buildingInWard(m, i), row.inWard, `row ${i}`));
  assert.equal(wardRows(m, m.inWard.length).length, 2_207);
  assert.equal(wardRows(null, 5).length, 5, 'without a polygon every row is the area\'s');
});

test('the outline ring densifies to a closed line with no step longer than asked', () => {
  const pts = densifyRing(MASK.ring, 8);
  assert.deepEqual(pts.slice(0, 2), pts.slice(-2));
  for (let i = 2; i < pts.length; i += 2) {
    assert.ok(Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]) <= 8 + 1e-9);
  }
});

/* ── where the boundary is declared, and only there ─────────────────────────── */

test('only Ballygunge declares a boundary; its file ships and is warmed with its siblings', async () => {
  assert.equal(wardMaskPath('in/kolkata/ballygunge'), '/heat-map/data/ballygunge-ward.json');
  for (const k of ['in/kolkata/barrackpore', 'in/kolkata/baruipur', 'in/bengaluru/mg-road']) assert.equal(wardMaskPath(k), null, k);
  assert.ok(!Object.keys(paths('in/kolkata/ballygunge')).includes('mask'), 'the boundary must not become an AreaPaths key every area must ship');
  assert.ok(prefetchPlan('in/kolkata/barrackpore').flat().includes('/heat-map/data/ballygunge-ward.json'));
  assert.ok(!prefetchPlan('in/kolkata/ballygunge').flat().some((u) => u.endsWith('-ward.json')));
});

/* ── the shipped artefacts: Ballygunge's ward figures are the polygon's ───────── */

test('the served solar headline is the polygon\'s roofs, recomputed from the per-roof arrays', () => {
  const m = asWardMask(MASK, EXPECT);
  const rows = wardRows(m, PV.kwp.length);
  const t = PV.totals_in_ward, s = PV.stratum_in_ward;
  assert.ok(t && s, 'pv-ballygunge.json ships no ward totals, so the panel would print the square');
  assert.equal(t.buildings, m.inWardCount);
  const kwp = rows.reduce((a, i) => a + PV.kwp[i], 0) / 1000;
  const gwh = rows.reduce((a, i) => a + PV.kwh[i], 0) / 1e6;
  /* Per-roof arrays are rounded to 0.01 kWp and 1 kWh, so the sums carry that rounding. */
  assert.ok(Math.abs(kwp - t.capacity_mwp) < 0.01, `ward capacity ${t.capacity_mwp} vs recomputed ${kwp}`);
  assert.ok(Math.abs(gwh - t.generation_gwh_yr) < 0.002, `ward generation ${t.generation_gwh_yr} vs recomputed ${gwh}`);
  /* The stratum is cut on UNROUNDED kWp; a served 3.00 may have been 2.995–3.005. */
  const lo = rows.filter((i) => PV.kwp[i] >= 3.005).length, hi = rows.filter((i) => PV.kwp[i] >= 2.995).length;
  assert.ok(s.n >= lo && s.n <= hi, `ward stratum ${s.n} outside the rounding bounds ${lo}–${hi}`);
  assert.ok(s.n < PV.stratum.n / 2, 'the ward stratum is the square\'s');
  /* And it is NOT the square: the two differ by more than three times. */
  assert.ok(PV.totals.capacity_mwp > 3 * t.capacity_mwp);
});

test('the whole-ward payback case is taken over the ward\'s roofs only', () => {
  const m = asWardMask(MASK, EXPECT);
  const basis = { costPerKw: { value: [40_000, 55_000] }, horizonYears: { value: 25 }, surplusCreditPerKwh: { value: 0 },
    inverter: { value: { year: 12, perKw: 8_000 } }, upkeepPerYear: { value: 0.01 },
    degradation: { value: { firstYear: 0.02, perYear: 0.005 } }, subsidy: { home: { value: {} }, society: { value: {} } } };
  const ward = wardRoi(PV, basis, 8, wardRows(m, PV.kwp.length));
  const square = wardRoi(PV, basis, 8);
  assert.ok(ward.slow.upfront < square.slow.upfront / 2, 'the ward case is sized like the square');
});

test('Ballygunge\'s DC-URS inputs are the polygon\'s values, not the square\'s', async () => {
  const inputs = (await json('public/heat-map/data/dc-urs-inputs.json')).wards.ballygunge;
  const sentinel = (await json('data/dc-urs/sentinel.json')).wards.ballygunge;
  const far = (await json('data/dc-urs/far.json')).wards.ballygunge;
  const pop = (await json('data/dc-urs/worldpop.json')).wards.ballygunge;
  const tra = (await json('data/dc-urs/tra.json')).wards.ballygunge;
  for (const [name, src] of [['sentinel', sentinel], ['far', far], ['worldpop', pop], ['tra', tra]]) {
    assert.match(src.domain, /KMC Ward 68 polygon/, `${name} is not taken over the polygon`);
  }
  assert.equal(Number(inputs.fvc.value), sentinel.fvc);
  assert.notEqual(sentinel.fvc, sentinel.square.fvc);
  assert.equal(Number(inputs.far.value), far.far);
  assert.equal(Number(inputs.popDensity.value), pop.density);
  assert.equal(Number(inputs.distCoolM.value), tra.median_dist_m);
});
