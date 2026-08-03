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

test('the water feature is render-only: nothing writes the sim water layer', async () => {
  // The simulation ALREADY reads layers.water (sim-ts.ts ventilation and
  // relaxation terms) — the layer ships zeros, so those terms collapse to
  // identity. Filling it changes the published ward mean, which makes it a
  // calibration-gated change, not a visual one. This assertion is the gate's
  // tripwire: the day someone writes water cells, this fails and points at the
  // protocol instead of letting the mean drift in silently with a texture.
  for (const file of [
    'src/scripts/climate-engine/heat-map-app.ts',
    'src/scripts/climate-engine/water-layer.ts',
    'src/scripts/climate-engine/ward-raster.ts',
  ]) {
    const src = await readFile(join(ROOT, file), 'utf8');
    assert.ok(!/\bwater\[[^\]]+\]\s*=/.test(src),
      `${file} assigns into a water array — that is the calibration-gated step (4B), not render`);
  }
  // ward-raster's zero-fill is the single sanctioned producer.
  const raster = await readFile(join(ROOT, 'src/scripts/climate-engine/ward-raster.ts'), 'utf8');
  assert.match(raster, /const water = new Float32Array\(count\);/,
    'the zero water layer must remain explicit, not vanish silently');
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
