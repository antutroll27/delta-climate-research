import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];
const read = (p) => readFile(join(ROOT, p), 'utf8').then(JSON.parse);

test('provenance rows stay PARALLEL to the buildings they describe', async () => {
  // Row-indexed against `b`. If the two ever diverge the card names the wrong
  // source for every building after the divergence, silently and plausibly.
  for (const w of WARDS) {
    const prov = await read(`public/heat-map/data/${w}-provenance.json`);
    const ward = await read(`public/heat-map/data/${w}.json`);
    const n = ward.b.length;
    assert.equal(prov.count, n, `${w}: provenance count`);
    assert.equal(prov.src.length, n, `${w}: src array length`);
    assert.equal(prov.confidence.length, n, `${w}: confidence array length`);
  }
});

test('every building has a KNOWN source — no silent "unknown" in the UI', async () => {
  const known = new Set(['osm', 'google', 'microsoft']);
  for (const w of WARDS) {
    const prov = await read(`public/heat-map/data/${w}-provenance.json`);
    assert.equal(prov.unknown, 0,
      `${w}: ${prov.unknown} buildings carry an unrecognised Overture dataset. Add it to `
      + 'DATASETS in scripts/build-footprint-provenance.py rather than letting the card '
      + 'show "unknown" to a reader.');
    for (const s of prov.src) assert.ok(known.has(s), `${w}: unexpected source key ${s}`);
  }
});

test('confidence is READ, never assumed from the source', async () => {
  /* The invariant is narrower than it first looks, and getting it wrong would have
     shipped a false statement on the card. Measured across the shipped set:
       google      100% carry a confidence in all three wards (median 0.73-0.83)
       microsoft     0% in ballygunge, 100% in barrackpore and baruipur (median 0.96)
       osm           never, correctly -- a hand trace has no model confidence
     So "Microsoft publishes none" is FALSE for 1,378 of 1,588 Microsoft buildings. */
  for (const w of WARDS) {
    const prov = await read(`public/heat-map/data/${w}-provenance.json`);
    for (let i = 0; i < prov.src.length; i++) {
      const c = prov.confidence[i];
      if (prov.src[i] === 'osm') {
        assert.equal(c, -1,
          `${w}[${i}]: an OpenStreetMap footprint was traced by a person and has no model `
          + 'confidence. A number here would be fabricated.');
      } else {
        assert.ok(c === -1 || (c > 0 && c <= 1),
          `${w}[${i}]: ${prov.src[i]} confidence ${c} is neither a probability nor the `
          + '-1 "none published" sentinel');
      }
    }
  }
});

test('Google always publishes confidence — if that stops, the card must not claim it', async () => {
  for (const w of WARDS) {
    const prov = await read(`public/heat-map/data/${w}-provenance.json`);
    const g = prov.src.map((s, i) => [s, prov.confidence[i]]).filter(([s]) => s === 'google');
    const missing = g.filter(([, c]) => c < 0).length;
    assert.equal(missing, 0,
      `${w}: ${missing} of ${g.length} Google rows lost their confidence. The card reads the `
      + 'value from the data so it will degrade gracefully, but this is worth knowing.');
  }
});

test('the wards are NOT equally hand-mapped, and the data says so', async () => {
  // This is the finding the artefact exists to surface: Baruipur is almost
  // entirely model output while the other two are majority hand-traced. If this
  // ever silently evens out, the source data changed and the caveat must be re-read.
  const share = {};
  for (const w of WARDS) {
    const p = await read(`public/heat-map/data/${w}-provenance.json`);
    share[w] = (p.counts.osm ?? 0) / p.count;
  }
  assert.ok(share.ballygunge > 0.5, `ballygunge should be majority OSM, got ${share.ballygunge}`);
  assert.ok(share.barrackpore > 0.5, `barrackpore should be majority OSM, got ${share.barrackpore}`);
  assert.ok(share.baruipur < 0.1,
    `baruipur is ${(share.baruipur * 100).toFixed(1)}% hand-traced — it was 1.1%, essentially `
    + 'all model output. If this has risen sharply, OSM coverage improved and the ward is '
    + 'now more trustworthy than the docs say.');
});

test('the card reads the array by building index, not by guessing', async () => {
  const app = await readFile(join(ROOT, 'src/scripts/climate-engine/heat-map-app.ts'), 'utf8');
  assert.match(app, /prov\?\.src\?\.\[b\.idx\]/,
    'the row index is the join key — b.idx indexes the ward `b` array, and any other '
    + 'lookup would name a different building\'s source');
  assert.match(app, /no confidence published/,
    'the card must distinguish "none published" from "low confidence"');
  const markup = await readFile(join(ROOT, 'src/components/ClimateEngine/HeatMapStage.astro'), 'utf8');
  assert.match(markup, /id="bcSrc"/, 'the card lost its provenance row while the app still writes it');
});
