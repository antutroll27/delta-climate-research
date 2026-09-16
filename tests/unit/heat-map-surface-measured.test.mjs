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
 * A REAL SURFACE RASTER MUST REACH THE SOLVER, IN EVERY CITY.
 *
 * For one commit it did not. `loadAreaSurface` gated the texture on a record in
 * dc-urs-inputs.json:
 *
 *     const record = inputs?.[ward];
 *     if (!surface || !record) return { means, surface: null };
 *
 * That file held Kolkata's three wards and nothing else THEN. So for a
 * Bengaluru ward the measured Sentinel-2 texture was fetched over the network,
 * decoded into two Float32Arrays, and then DROPPED — and `rasterWardBase`
 * filled `veg` with `means.fvc`, which on that path is 0.
 *
 * WHY THAT WAS THE WORST SHAPE OF FAILURE THIS PROJECT HAS HAD. `eqCell`
 * carries `- p.L * veg`, so zero vegetation is a HOT bias, not a neutral one.
 * The ward would render, look entirely plausible, run warm, and be fabricated
 * — with nothing thrown, nothing logged and no missing file to notice. The
 * measured ward means (0.401 / 0.388 / 0.370 FVC) would never have reached a
 * pixel.
 *
 * BENGALURU NOW HAS ITS OWN DC-URS FILE (Task 6), so `record` is truthy for
 * every Bengaluru ward and the per-ward tests below exercise the SCALAR path,
 * not the `measuredMeans` fallback the bug above was about. That is not a loss
 * of coverage: bengaluru-dc-urs-inputs.json's fvc/albedo are copied verbatim
 * from these same surface-meta.json means at export time (the parity a test
 * below pins), so the scalar path reads the identical numbers the fallback
 * would. A separate test past the per-ward loop exercises `measuredMeans`
 * directly, with the DC-URS file stubbed absent, so that branch still fails
 * loudly if it breaks.
 *
 * WHY THIS TEST IS SHAPED THE WAY IT IS. "A surface came back" PASSES AGAINST
 * THE BUG — `loadAreaSurface` always returns an object, and `loadSurfaceRaster`
 * decodes the PNG successfully before the gate throws it away. So the assertions
 * below are on the two properties the bug actually destroys, measured on the
 * array the SOLVER receives rather than on the loader's return value:
 *
 *   · NOT `fvc: 0`     — the hot-biased fallback level
 *   · NOT UNIFORM      — a flat field is what a discarded texture leaves behind
 *
 * It drives the real `loadAreaSurface` against the real committed artefacts, so
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

const { loadAreaSurface } = await import('../../src/scripts/climate-engine/surface-raster.ts');
const { rasterWardBase } = await import('../../src/scripts/climate-engine/ward-raster.ts');

/* Ward id -> AreaKey. The loader takes a hierarchical key now; the artefacts on
   disk, and dc-urs-inputs.json, are still keyed by bare stem — which is exactly
   what `splitKey(key).area` inside the loader indexes with. */
const CITY_OF = { ballygunge: 'kolkata', baruipur: 'kolkata', barrackpore: 'kolkata',
  indiranagar: 'bengaluru', 'mg-road': 'bengaluru', whitefield: 'bengaluru' };
const key = (id) => `in/${CITY_OF[id]}/${id}`;

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

/* `bengaluru-dc-urs-inputs.json` -- read once here so the per-ward loop below
   can check its actual premise (this ward has a DC-URS record, so it takes the
   SCALAR path) rather than surface-meta.json's `level`, which no longer tracks
   which branch `loadAreaSurface` runs for a Bengaluru ward. */
const blrInputs = JSON.parse(await readFile(join(DATA, 'bengaluru-dc-urs-inputs.json'), 'utf8')).wards;

for (const ward of ['indiranagar', 'mg-road', 'whitefield']) {
  test(`${ward}: the real surface reaches the solver via its DC-URS record, not the hot fallback`, async () => {
    const entry = meta[ward];
    assert.ok(blrInputs[ward],
      `${ward} must carry a DC-URS record for this test to exercise the scalar path it claims to`);

    const { means, surface } = await loadAreaSurface(key(ward));

    assert.ok(surface, `${ward}: the texture was fetched and decoded, then discarded. That is `
      + 'the inert-raster bug — see the gate in loadAreaSurface.');

    /* NOT fvc: 0. The fallback level, and a hot one. */
    assert.ok(means.fvc > 0,
      `${ward}: means.fvc is ${means.fvc}. Zero vegetation is the hot-biased fallback, not a `
      + 'measurement — the ward would render warm and entirely invented.');
    /* The scalar and surface-meta's measured mean are the SAME NUMBER by
       construction (see the parity test below), so this equality does not by
       itself prove which branch ran -- only that the level reaching the solver
       matches the real measurement either way. The dedicated fallback test
       further down is what actually exercises `measuredMeans`. */
    assert.equal(means.fvc, entry.fvc_mean,
      `${ward}: the scalar's fvc must equal surface-meta.json's measured mean`);
    assert.equal(means.albedo, entry.albedo_mean,
      `${ward}: the scalar's albedo must equal surface-meta.json's measured mean`);

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

/* THE INVARIANT THE PRECEDENCE RESTS ON, PINNED — FOR KOLKATA'S OWN FILE.

   `loadAreaSurface` checks the DC-URS scalar FIRST and only then the measured
   level. Inverting that order passes every other test in this file that reads
   dc-urs-inputs.json — not because those tests are weak, but because no
   Kolkata artefact can tell the two orderings apart: `export-surface-rasters.py`
   writes MUTUALLY EXCLUSIVE entries for Kolkata's wards, a pinned one getting
   `level: "dc-urs-scalar"` + `fvc_target`, an unpinned one `level: "measured"`
   + `fvc_mean`.

   So the ordering was safe, for Kolkata, because of a branch in a Python
   script that nothing asserted. This asserts it — SCOPED to dc-urs-inputs.json,
   which is Kolkata's file and reads nothing from bengaluru-dc-urs-inputs.json.
   If a future exporter ever writes both a scalar record and a measured level
   for one KOLKATA ward, the precedence stops being academic for that city and
   this fails here rather than silently changing which number Kolkata renders.

   BENGALURU ALREADY HAS BOTH, ON PURPOSE, and this test says nothing about it
   — `pinned` is built from dc-urs-inputs.json alone, so a Bengaluru ward never
   enters the loop below. That is not a hole this test should have caught: the
   ordering only matters where the two values could DISAGREE, and Bengaluru's
   cannot, by construction — its scalar's fvc/albedo ARE its surface-meta.json
   means, copied verbatim at export time (see "Bengaluru's DC-URS vegetation
   and albedo…" below), so whichever branch ran would read the identical
   number. The dedicated fallback test after that one exercises the OTHER
   branch directly, with Bengaluru's file stubbed absent, which is the only way
   to tell the two orderings apart there. */
test('no Kolkata ward carries both a DC-URS scalar and a measured level', async () => {
  const inputs = JSON.parse(await readFile(join(DATA, 'dc-urs-inputs.json'), 'utf8')).wards;
  const pinned = Object.keys(inputs);
  assert.ok(pinned.length > 0, 'dc-urs-inputs.json listed no wards, so this test pins nothing');
  for (const ward of pinned) {
    assert.notEqual(meta[ward]?.level, 'measured',
      `${ward} has a DC-URS record AND level "measured". The two are meant to be mutually `
      + 'exclusive, so loadAreaSurface\'s scalar-first ordering now decides which number the '
      + 'ward renders — decide it deliberately rather than by line order.');
  }
});

/* BENGALURU HAS BOTH, DELIBERATELY. loadAreaSurface takes a DC-URS record first,
   so Bengaluru's record carries its measured surface means VERBATIM: the map and
   the score then read one measurement, and the texture's pinned means still hold. */
test("Bengaluru's DC-URS vegetation and albedo are its measured surface means, exactly", async () => {
  const blr = JSON.parse(await readFile(join(DATA, 'bengaluru-dc-urs-inputs.json'), 'utf8')).wards;
  for (const ward of ['indiranagar', 'mg-road', 'whitefield']) {
    assert.equal(blr[ward].fvc.value, meta[ward].fvc_mean, `${ward}: fvc`);
    assert.equal(blr[ward].albedo.value, meta[ward].albedo_mean, `${ward}: albedo`);
  }
});

/* THE MEASURED FALLBACK ITSELF, STILL GUARDED. Every per-ward test above takes
   the scalar path — Bengaluru's scalar and its measured mean are the identical
   number (the test just above pins why), so no assertion up there can tell
   `measuredMeans` (surface-raster.ts) apart from a stub that always threw or
   always returned null. `measuredMeans` and the `record ? null : measured`
   branch in `loadAreaSurface` would be unreachable code with no test noticing.
   This test forces the OTHER branch.
   A FRESH MODULE INSTANCE, not a fetch override on the one already imported
   above: `inputsCache` and `surfaceMetaPromise` in surface-raster.ts are
   module-level, keyed (or singleton) for the process's lifetime, and every
   test above has already resolved and cached bengaluru-dc-urs-inputs.json for
   THIS file's module instance — stubbing 404 now would not undo that cache.
   `import()` keys its module cache on the resolved specifier, so a distinct
   query suffix gets Node/tsx to instantiate a second copy of the module with
   its own, empty caches. */
test('mg-road still reaches the solver at its measured means when Bengaluru ships no DC-URS file', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('bengaluru-dc-urs-inputs.json')) return { ok: false, status: 404 };
    return realFetch(url);
  };
  try {
    const { loadAreaSurface: loadWithNoBlrScalar } =
      await import('../../src/scripts/climate-engine/surface-raster.ts?no-blr-scalar');
    const { means, surface } = await loadWithNoBlrScalar(key('mg-road'));
    assert.ok(surface, 'mg-road: the texture must still load through the measured fallback');
    assert.equal(means.fvc, meta['mg-road'].fvc_mean,
      'mg-road: fvc must come from measuredMeans / surface-meta.json when there is no DC-URS file');
    assert.equal(means.albedo, meta['mg-road'].albedo_mean,
      'mg-road: albedo must come from measuredMeans / surface-meta.json when there is no DC-URS file');
  } finally {
    globalThis.fetch = realFetch;
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
    const { means, surface } = await loadAreaSurface(key(ward));
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
/* DUBAI, deliberately. This case needs an area that is REGISTERED — so it
   resolves — but ships no evidence of either kind: no dc-urs-inputs record and no
   `level: "measured"` in surface-meta.json. Every Kolkata ward has a scalar, and
   every Bengaluru ward now has BOTH a scalar and a measurement (deliberately —
   see the tests above) — so neither city can stand in for "neither". Dubai is
   registered precisely to be named while shipping nothing. */
test('a ward with no scalar AND no measured level still gets no surface', async () => {
  const { means, surface } = await loadAreaSurface('ae/dubai/creek');
  assert.equal(surface, null);
  assert.equal(means.fvc, 0, 'the fallback level is unchanged — it is just no longer reachable '
    + 'by a ward that HAS a measurement');
});
