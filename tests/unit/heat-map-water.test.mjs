import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'baruipur', 'barrackpore'];

/** Mirrors CLIP_M in scripts/fetch-water.py — vertices may not escape the box. */
const CLIP_M = 760;

test('every ward ships a water artefact honouring the roads-family contract', async () => {
  for (const ward of WARDS) {
    const d = JSON.parse(await readFile(
      join(ROOT, `public/heat-map/data/${ward}-water.json`), 'utf8'));
    assert.equal(d.ward, ward);
    assert.equal(d.source, 'OpenStreetMap via Overpass (ODbL)',
      'attribution travels with the data, not just the UI');
    assert.equal(d.count, d.polys.length);
    assert.ok(d.polys.length > 0, `${ward} has OSM water in frame — a zero here means the fetch regressed`);
    for (const poly of d.polys) {
      assert.ok(['water', 'river', 'pool'].includes(poly.k));
      assert.ok(poly.p.length >= 6 && poly.p.length % 2 === 0,
        'flat [x,y,...] pairs, at least a triangle');
      for (const v of poly.p) {
        assert.ok(Math.abs(v) <= CLIP_M + 0.1,
          `vertex ${v} escapes the ±${CLIP_M} m clip box`);
      }
    }
  }
});

/** Ward-mean open-water fraction on the canonical grid, through the shipped rasteriser. */
async function waterFraction(ward, n = 192) {
  const { rasterizeWardWater } = await import('../../src/scripts/climate-engine/ward-raster.ts');
  const water = JSON.parse(await readFile(
    join(ROOT, `public/heat-map/data/${ward}-water.json`), 'utf8'));
  const { sizeM } = JSON.parse(await readFile(
    join(ROOT, `public/heat-map/data/${ward}.json`), 'utf8'));
  const cov = rasterizeWardWater(water, sizeM, n);
  return { cov, mean: cov.reduce((s, v) => s + v, 0) / cov.length };
}

test('the sim water layer carries real coverage, as a fraction of cell area', async () => {
  // THIS TEST USED TO ASSERT THE OPPOSITE, and the inversion is the record of a
  // decision. Until 2026-08-13 it matched `const water = new Float32Array(count);` in
  // ward-raster.ts and existed as a tripwire: the solver had always READ layers.water
  // (sim-ts.ts ventilation and relaxation) while the layer shipped zeros, so both terms
  // collapsed to the identity and every pond in three wards was solved as warm land.
  // Filling it moves the published ward mean, so the tripwire's job was to send whoever
  // filled it to the calibration protocol rather than let a texture drift the numbers.
  //
  // The protocol ran — see docs/heat-map-water-layer.md for the before/after against
  // ECOSTRESS — so the tripwire is spent, and this is what replaces it: the layer is
  // real, and it is a FRACTION rather than a mask. The fraction is the part the physics
  // depends on, since the solver multiplies by this number in both water terms.
  for (const ward of WARDS) {
    const { cov } = await waterFraction(ward);
    let wet = 0, partial = 0, full = 0;
    for (const v of cov) {
      assert.ok(v >= 0 && v <= 1, `coverage ${v} is not a fraction`);
      if (v > 0) wet++;
      if (v > 0 && v < 1) partial++;
      if (v === 1) full++;
    }
    assert.ok(wet > 0, `${ward} ships water polygons, so some cell must be wet`);
    // Both must exist, and the PAIR is the point. All-1 would mean a mask had been
    // substituted for the fraction; no full cell at all would mean the rasteriser is
    // losing area, which is false for the Hooghly edge and for the larger tanks.
    assert.ok(partial > 0, `${ward} has no partially-wet cell — this is a mask, not a fraction`);
    assert.ok(full > 0, `${ward} has no fully-wet cell — the rasteriser is losing area`);
  }

  // Barrackpore holds the Hooghly edge, Ballygunge a handful of tanks. That contrast is
  // what let the accuracy result be read as a mechanism rather than as noise, so an
  // inversion here invalidates the reading, not just the test.
  const river = (await waterFraction('barrackpore')).mean;
  const tanks = (await waterFraction('ballygunge')).mean;
  assert.ok(river > 3 * tanks,
    `the river ward must out-water the tank ward by a wide margin, got ${river} vs ${tanks}`);
});

test('WATER_LAYER_ENABLED is what decides whether the solver sees water', async () => {
  // The gate is the whole decision, so it gets an assertion rather than a comment. What
  // is pinned is the WIRING, not the value: `rasterWardBase` must agree with the
  // constant in both directions, so flipping it is a real change and cannot be a no-op
  // that silently leaves the layer dead the way the unwritten allocation did.
  const { WATER_LAYER_ENABLED } = await import('../../src/scripts/climate-engine/types.ts');
  const { rasterWardBase, rasterizeWardWater } =
    await import('../../src/scripts/climate-engine/ward-raster.ts');

  const ward = JSON.parse(await readFile(join(ROOT, 'public/heat-map/data/barrackpore.json'), 'utf8'));
  const water = JSON.parse(await readFile(join(ROOT, 'public/heat-map/data/barrackpore-water.json'), 'utf8'));
  const base = rasterWardBase(ward, { fvc: 0.2, albedo: 0.2 }, null, null, water);
  const wet = rasterizeWardWater(water, ward.sizeM, 192).reduce((s, v) => s + v, 0);
  const inSolve = base.water.reduce((s, v) => s + v, 0);

  assert.ok(wet > 0, 'barrackpore has 67 rings, so the rasteriser must find water');
  if (WATER_LAYER_ENABLED) {
    assert.equal(inSolve, wet, 'the gate is on, so the solver must get the full coverage');
  } else {
    // Zero BY DECISION, not by omission. types.ts carries the measurement that put it
    // here — turning it on cost 0.049 r against ECOSTRESS and made an already over-drawn
    // spatial amplitude worse. Re-enabling means re-running that measurement.
    assert.equal(inSolve, 0, 'the gate is off, so the solver must get the zero layer');
  }
  assert.equal(base.water.length, base.built.length, 'every layer is one grid');
});

test('a ward with no water artefact solves as dry rather than refusing to solve', async () => {
  // Both loaders swallow a failed water fetch to `{ polys: [] }` (ward-loader.ts for
  // Compare, heat-map-app.ts for the map), so the rasteriser must accept that and a
  // bare null. A throw here would take a whole ward down over an optional artefact.
  const { rasterizeWardWater } = await import('../../src/scripts/climate-engine/ward-raster.ts');
  for (const input of [null, { polys: [] }]) {
    const cov = rasterizeWardWater(input, 1400, 32);
    assert.equal(cov.length, 32 * 32);
    assert.equal(cov.reduce((s, v) => s + v, 0), 0);
  }
});

test('shore distance is the depth proxy, and it scales with the body', async () => {
  // The look is derived from geometry alone — no bathymetry exists for these
  // wards and the pond census that might have carried depth covers one of the
  // three. Distance from the nearest shore is what stands in, because
  // shorelines shelve: a river reads deep, a rooftop tank reads shallow, with
  // nothing invented and no per-feature tuning.
  const { buildDepthField, assertWaterDepthLogic } =
    await import('../../src/scripts/climate-engine/water-depth.ts');
  assertWaterDepthLogic();

  const depths = {};
  for (const ward of WARDS) {
    const d = JSON.parse(await readFile(
      join(ROOT, `public/heat-map/data/${ward}-water.json`), 'utf8'));
    const field = buildDepthField(d.polys, 1520);
    assert.ok(field.maxDistM > 0, `${ward} has water, so something must be off-shore`);
    assert.ok(field.data.some(v => v === 255), `${ward} must have a deepest point`);
    assert.ok(field.data.some(v => v === 0), `${ward} must have land`);
    depths[ward] = field.maxDistM;
  }
  // Barrackpore holds the Hooghly edge; Ballygunge holds tanks. If that ever
  // inverts, either the fetch or the field has gone wrong.
  assert.ok(depths.barrackpore > depths.ballygunge,
    `the river ward should out-deep the tank ward, got ${JSON.stringify(depths)}`);
});
