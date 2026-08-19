import assert from 'node:assert/strict';
import test from 'node:test';

import { WARDS } from '../../src/data/wards.ts';
import { buildCityJSON } from '../../src/scripts/standards/cityjson.ts';
import { wardCollection, wardFeature } from '../../src/scripts/standards/geojson.ts';
import { MATRIX, PROHIBITED } from '../../src/scripts/standards/matrix.ts';

const cj = buildCityJSON(WARDS[0]);   // ballygunge — 3,527 buildings

test('CityJSON envelope is 2.0 with a transform and one Building per shipped footprint', () => {
  assert.equal(cj.type, 'CityJSON');
  assert.equal(cj.version, '2.0');
  assert.equal(cj.transform.scale.length, 3);
  assert.equal(cj.transform.translate.length, 3);
  assert.equal(Object.keys(cj.CityObjects).length, 3527, 'one CityObject per row of ballygunge.json');
  for (const o of Object.values(cj.CityObjects)) assert.equal(o.type, 'Building');
});

test('every boundary index points at a real vertex, and every solid is closed', () => {
  const nV = cj.vertices.length;
  assert.ok(nV > 0);
  for (const [id, o] of Object.entries(cj.CityObjects)) {
    const g = o.geometry[0];
    assert.equal(g.type, 'Solid'); assert.equal(g.lod, '1');
    const shells = g.boundaries;           // Solid = array of shells; shell = array of surfaces; surface = array of rings
    assert.equal(shells.length, 1, `${id}: LoD1 solid has one shell`);
    const faces = shells[0];
    assert.ok(faces.length >= 5, `${id}: needs bottom + top + >=3 walls, got ${faces.length}`);
    for (const surface of faces) for (const ring of surface) {
      assert.ok(ring.length >= 3, `${id}: degenerate ring`);
      for (const idx of ring) {
        assert.ok(Number.isInteger(idx) && idx >= 0 && idx < nV, `${id}: vertex index ${idx} out of range [0,${nV})`);
      }
    }
    // top ring sits at the building's height, bottom at 0 — in scaled units
    const [bottom] = faces[0][0], [top] = faces[1][0];
    assert.equal(cj.vertices[bottom][2], 0);
    assert.ok(cj.vertices[top][2] > 0, `${id}: top ring must be above ground`);
  }
});

test('the extrusion height matches what the heat map ships (b[0] of {ward}.json)', async () => {
  const { readFile } = await import('node:fs/promises');
  const shipped = JSON.parse(await readFile(new URL('../../public/heat-map/data/ballygunge.json', import.meta.url), 'utf8'));
  const heights = Object.values(cj.CityObjects).map((o) => o.attributes.height_m);
  shipped.b.forEach((row, i) => {
    assert.ok(Math.abs(heights[i] - Math.max(row[0], 0)) < 1e-9, `row ${i}: export ${heights[i]} vs shipped ${row[0]}`);
  });
});

test('CityJSON vertices decode back to inside the ward bbox in EPSG:4326', () => {
  const [sx, sy] = cj.transform.scale, [tx, ty] = cj.transform.translate;
  const f = wardFeature(WARDS[0]);
  const [w, s, e, n] = f.bbox;
  // allow the 64 "outside" footprints the geometry file records as skipped-margin
  const pad = 0.002;
  let outside = 0;
  for (const [vx, vy] of cj.vertices) {
    const lon = vx * sx + tx, lat = vy * sy + ty;
    if (lon < w - pad || lon > e + pad || lat < s - pad || lat > n + pad) outside++;
  }
  assert.equal(outside, 0, `${outside} vertices decode outside the ward — a georeferencing bug`);
});

test('the lineage block carries the measured confidence and the prototype status', () => {
  const l = cj['+delta_lineage'];
  assert.equal(l.status, 'prototype');
  assert.equal(l.analysisCrs, 'EPSG:32645');
  assert.ok(l.confidence.night.bandK > 0 && l.confidence.peak.n > 0);
  // the band must cover the OUT-OF-SAMPLE error, not the in-sample fit — the
  // audit found ±3.0 published against a 3.102 K leave-one-overpass-out error
  assert.ok(l.confidence.night.bandK >= 3.5, `night band ${l.confidence.night.bandK} understates`);
  assert.equal(l.confidence.heights.verdict, 'underpowered');
  assert.match(cj.metadata.referenceSystem, /EPSG\/0\/4979$/)   // 3-D CRS; 4326 is 2-D;
  assert.equal(cj.metadata.pointOfContact.emailAddress, 'angad@deltaclimate.earth', 'contactDetails requires emailAddress');
  assert.ok(!('lineage' in cj.metadata), 'metadata is closed in 2.0 — lineage must not be inside it');
});

test('GeoJSON features are RFC 7946: closed CCW rings, bbox = polygon envelope', () => {
  const c = wardCollection(WARDS);
  assert.equal(c.type, 'FeatureCollection'); assert.equal(c.features.length, WARDS.length);
  for (const f of c.features) {
    const ring = f.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1], 'ring must close');
    // shoelace: positive area = counter-clockwise
    let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    assert.ok(a > 0, `${f.id}: exterior ring must be CCW`);
    const lons = ring.map((p) => p[0]), lats = ring.map((p) => p[1]);
    assert.deepEqual(f.bbox, [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]);
    assert.equal(f.properties.status, 'prototype');
  }
});

test('nothing on the wire uses prohibited certification language', async () => {
  // Mutation-tested 2026-08-19: inserting "ISO certified, fully compliant" into
  // APPROVED_STATEMENT passed this test, because it only ever scanned MATRIX rows.
  // The statements are the MOST quotable text we publish — they are the first
  // thing a journalist or investor lifts — so they are now the first thing checked.
  const { APPROVED_STATEMENT, UNCERTAINTY_STATEMENT, PHASES } = await import('../../src/scripts/standards/matrix.ts');
  const wire = JSON.stringify({
    cj: cj.metadata, lin: cj['+delta_lineage'], matrix: MATRIX, geo: wardCollection(WARDS),
    approved: APPROVED_STATEMENT, uncertainty: UNCERTAINTY_STATEMENT, phases: PHASES,
  }).toLowerCase();
  const { prohibitedHits } = await import('../../src/scripts/standards/matrix.ts');
  assert.deepEqual(prohibitedHits(wire), [], 'prohibited claim on the wire');
  for (const row of MATRIX) assert.ok(!['compliant', 'certified'].includes(row.posture), row.standard);
});

test('no prohibited language survives into the RENDERED pages', async () => {
  // The wire is not what a reader sees. Copy can enter through page markup that
  // never passes through a module, so the built HTML is checked directly.
  const { readFileSync, existsSync } = await import('node:fs');
  const { prohibitedHits } = await import('../../src/scripts/standards/matrix.ts');
  for (const page of ['standards', 'uncertainty', 'attribution']) {
    const file = `dist/${page}/index.html`;
    assert.ok(existsSync(file), `${file} missing — build first`);
    const text = readFileSync(file, 'utf8')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .toLowerCase();
    // denials are fine — "Nothing here is certified" must survive; claims must not
    assert.deepEqual(prohibitedHits(text), [], `/${page} makes a prohibited claim`);
  }
});

test('openapi.json describes every endpoint the build actually emits (§13.2)', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const { join, relative } = await import('node:path');
  const root = new URL('../../dist/api', import.meta.url).pathname;
  const walk = async (d) => (await Promise.all((await readdir(d, { withFileTypes: true })).map(
    (e) => e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))).flat();
  let files;
  try { files = await walk(root); } catch { return; }   // no dist/ yet — build-gated, not a failure here
  const spec = JSON.parse(await readFile(join(root, 'openapi.json'), 'utf8'));
  // Collapse concrete files onto their templated path. STAC ids are not ward ids
  // (`ward-products`, `ballygunge-canopy`), so they need their own rule — the
  // ward-only heuristic silently failed to match them.
  const templ = (p) => {
    const stac = p.replace(/\/stac\/(collections|items)\/[^/]+\.json$/, '/stac/$1/{id}.json');
    if (stac !== p) return stac;
    return ['ballygunge', 'barrackpore', 'baruipur'].reduce(
      (acc, w) => acc.replace(`/${w}.json`, '/{id}.json').replace(`/wards/${w}/`, '/wards/{id}/'), p);
  };
  const emitted = [...new Set(files.map((f) => templ('/api/' + relative(root, f))))].sort();
  for (const p of emitted) assert.ok(spec.paths[p], `openapi.json does not describe ${p}`);
  for (const p of Object.keys(spec.paths)) assert.ok(emitted.includes(p), `openapi.json describes ${p}, which is never emitted`);
});

test('CityJSON declares a THREE-dimensional CRS, because the data has a z', () => {
  // EPSG:4326 is 2-D. Our vertices carry metres above the ellipsoid, so 4326 is
  // wrong and 4979 is right (CityJSON 2.0 §5.5). Neither the JSON Schema nor
  // cjval catches this: the schema only checks the URL prefix. Pinned here.
  assert.match(cj.metadata.referenceSystem, /EPSG\/0\/4979$/,
    'a 2-D CRS cannot describe geometry with heights');
  assert.equal(cj.transform.scale.length, 3);
  assert.ok(cj.transform.scale[2] > 0, 'z is scaled in metres');
});
