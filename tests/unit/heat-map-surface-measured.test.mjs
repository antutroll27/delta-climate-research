import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { decodePng, toRgba } from './_png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(ROOT, 'public', 'heat-map', 'data');

/**
 * A MEASURED SURFACE RASTER MUST REACH THE SOLVER, IN EVERY CITY.
 *
 * For one commit it did not. `loadWardSurface` gated the texture on a record in
 * dc-urs-inputs.json:
 *
 *     const record = inputs?.[ward];
 *     if (!surface || !record) return { means, surface: null };
 *
 * That file holds Kolkata's three wards and nothing else. So for a Bengaluru
 * ward the measured Sentinel-2 texture was fetched over the network, decoded
 * into two Float32Arrays, and then DROPPED — and `rasterWardBase` filled `veg`
 * with `means.fvc`, which on that path is 0.
 *
 * WHY THAT IS THE WORST SHAPE OF FAILURE THIS PROJECT HAS. `eqCell` carries
 * `- p.L * veg`, so zero vegetation is a HOT bias, not a neutral one. The ward
 * would render, look entirely plausible, run warm, and be fabricated — with
 * nothing thrown, nothing logged and no missing file to notice. The measured
 * ward means (0.401 / 0.388 / 0.370 FVC) would never have reached a pixel.
 *
 * WHY THIS TEST IS SHAPED THE WAY IT IS. "A surface came back" PASSES AGAINST
 * THE BUG — `loadWardSurface` always returns an object, and `loadSurfaceRaster`
 * decodes the PNG successfully before the gate throws it away. So the assertions
 * below are on the two properties the bug actually destroys, measured on the
 * array the SOLVER receives rather than on the loader's return value:
 *
 *   · NOT `fvc: 0`     — the hot-biased fallback level
 *   · NOT UNIFORM      — a flat field is what a discarded texture leaves behind
 *
 * It drives the real `loadWardSurface` against the real committed artefacts, so
 * it also transitively covers the decode, the north-up/south-up row flip and
 * `assertSurfaceMatches` — any of which failing would null the surface and fail
 * these same assertions.
 */

/* ── the browser, stubbed ────────────────────────────────────────────────────
   Node has none of the three APIs the loader reaches for. These stubs are
   deliberately thin and serve the REAL bytes off disk: a fixture would let this
   test keep passing while the shipped PNGs rotted. */

globalThis.fetch = async (url) => {
  const name = String(url).replace('/heat-map/data/', '');
  const path = join(DATA, name);
  if (!existsSync(path)) return { ok: false, status: 404 };
  if (name.endsWith('.png')) {
    const png = await decodePng(path);
    // `blob()` is opaque to the loader — it only ever hands it to
    // createImageBitmap — so the decoded image travels inside it.
    return { ok: true, status: 200, blob: async () => ({ png }) };
  }
  return { ok: true, status: 200, json: async () => JSON.parse(await readFile(path, 'utf8')) };
};

globalThis.createImageBitmap = async (blob) => ({
  width: blob.png.width, height: blob.png.height, png: blob.png, close() {},
});

globalThis.OffscreenCanvas = class {
  constructor(width, height) { this.width = width; this.height = height; }
  getContext() {
    let drawn = null;
    return {
      drawImage(bitmap) { drawn = bitmap.png; },
      /* RGBA, because that is what a real 2D context returns regardless of the
         source PNG's colour type — the loader strides by 4. */
      getImageData: () => ({ data: toRgba(drawn) }),
    };
  }
};

const { loadWardSurface } = await import('../../src/scripts/climate-engine/surface-raster.ts');
const { rasterWardBase } = await import('../../src/scripts/climate-engine/ward-raster.ts');

const wardData = async (id) => JSON.parse(await readFile(join(DATA, `${id}.json`), 'utf8'));

function spread(field) {
  let lo = Infinity, hi = -Infinity, sum = 0;
  for (const v of field) { if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
  const mean = sum / field.length;
  let varSum = 0;
  for (const v of field) varSum += (v - mean) * (v - mean);
  return { lo, hi, mean, sd: Math.sqrt(varSum / field.length) };
}

/* The measured means the exporter recorded beside each raster. Read from the
   artefact rather than typed in, so this test compares the loader against the
   file it is supposed to be reading — not against a number I copied once. */
const meta = JSON.parse(await readFile(join(DATA, 'surface-meta.json'), 'utf8')).wards;

for (const ward of ['indiranagar', 'mg-road', 'whitefield']) {
  test(`${ward}: the measured surface reaches the solver, not the hot fallback`, async () => {
    const entry = meta[ward];
    assert.equal(entry?.level, 'measured',
      `${ward} must be an unpinned, measured-level ward for this test to mean anything`);

    const { means, surface } = await loadWardSurface(ward);

    assert.ok(surface, `${ward}: the texture was fetched and decoded, then discarded. That is `
      + 'the inert-raster bug — see the gate in loadWardSurface.');

    /* NOT fvc: 0. The fallback level, and a hot one. */
    assert.ok(means.fvc > 0,
      `${ward}: means.fvc is ${means.fvc}. Zero vegetation is the hot-biased fallback, not a `
      + 'measurement — the ward would render warm and entirely invented.');
    assert.equal(means.fvc, entry.fvc_mean,
      `${ward}: the loaded level must be the measured one surface-meta.json records`);
    assert.equal(means.albedo, entry.albedo_mean, `${ward}: albedo level must be the measured one`);

    /* NOT UNIFORM — measured on what rasterWardBase hands the solver, which is
       the array the bug actually flattened. `surface` being non-null is not
       enough on its own: this is the property a discarded texture destroys. */
    const layers = rasterWardBase(await wardData(ward), means, surface);
    const veg = spread(layers.veg);
    assert.ok(veg.sd > 0.05,
      `${ward}: the solver's vegetation field has sd ${veg.sd.toFixed(4)} — that is a flat field, `
      + 'which is what a dropped texture leaves behind.');
    assert.ok(veg.hi - veg.lo > 0.3,
      `${ward}: vegetation spans only ${(veg.hi - veg.lo).toFixed(3)}; a real ward has parks and roofs`);
    assert.ok(veg.lo < veg.mean && veg.mean < veg.hi, `${ward}: vegetation is constant at ${veg.mean}`);

    const albedo = spread(layers.albedo);
    assert.ok(albedo.sd > 0.005,
      `${ward}: the solver's albedo field is flat (sd ${albedo.sd.toFixed(5)})`);
  });
}

/* THE INVARIANT THE PRECEDENCE RESTS ON, PINNED.

   `loadWardSurface` checks the DC-URS scalar FIRST and only then the measured
   level. Inverting that order passes every other test in this file — not
   because the tests are weak, but because no artefact in this repo can tell the
   two orderings apart: `export-surface-rasters.py` writes MUTUALLY EXCLUSIVE
   entries, a pinned ward getting `level: "dc-urs-scalar"` + `fvc_target`, an
   unpinned one `level: "measured"` + `fvc_mean`.

   So the ordering is safe because of a branch in a Python script that nothing
   asserted. This asserts it. If a future exporter ever writes both a scalar
   record and a measured level for one ward, the precedence stops being
   academic — and this fails here rather than silently changing which number
   Kolkata renders. */
test('no ward carries both a DC-URS scalar and a measured level', async () => {
  const inputs = JSON.parse(await readFile(join(DATA, 'dc-urs-inputs.json'), 'utf8')).wards;
  const pinned = Object.keys(inputs);
  assert.ok(pinned.length > 0, 'dc-urs-inputs.json listed no wards, so this test pins nothing');
  for (const ward of pinned) {
    assert.notEqual(meta[ward]?.level, 'measured',
      `${ward} has a DC-URS record AND level "measured". The two are meant to be mutually `
      + 'exclusive, so loadWardSurface\'s scalar-first ordering now decides which number the '
      + 'ward renders — decide it deliberately rather than by line order.');
  }
});

/* The other half of the fix, and the reason it is an ORDERING rather than a
   replacement: Kolkata's level still comes from the scalar DC-URS scores on, and
   surface-meta.json is never consulted for it. If that inverted, the map and the
   score would be drawn from two different vintages of the same measurement —
   which is the drift assertSurfaceMatches was written to catch. */
test('Kolkata still takes its level from the DC-URS scalar, unchanged', async () => {
  const inputs = JSON.parse(await readFile(join(DATA, 'dc-urs-inputs.json'), 'utf8')).wards;
  for (const ward of ['ballygunge', 'baruipur', 'barrackpore']) {
    const { means, surface } = await loadWardSurface(ward);
    assert.ok(surface, `${ward}: Kolkata's texture must still load`);
    assert.equal(means.fvc, inputs[ward].fvc.value,
      `${ward}: fvc must come from dc-urs-inputs.json, not from surface-meta.json`);
    assert.equal(means.albedo, inputs[ward].albedo.value,
      `${ward}: albedo must come from dc-urs-inputs.json, not from surface-meta.json`);
  }
});

/* The refusal still exists. The fix widened what counts as evidence of a level;
   it did not remove the requirement for one. A ward with neither a scalar nor a
   measured entry keeps getting the honest nothing — because a texture whose
   level nothing confirms is the exact case assertSurfaceMatches guards. */
test('a ward with no scalar AND no measured level still gets no surface', async () => {
  const { means, surface } = await loadWardSurface('a-ward-that-does-not-exist');
  assert.equal(surface, null);
  assert.equal(means.fvc, 0, 'the fallback level is unchanged — it is just no longer reachable '
    + 'by a ward that HAS a measurement');
});
