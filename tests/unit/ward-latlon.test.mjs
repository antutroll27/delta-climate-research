import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { WARD_MAP, wardLatLon, formatLatLon } from '../../src/data/wards.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The constants in scripts/_types.m_per_deg — the forward transform we invert. */
const M_PER_DEG_LAT = 110_540;
const mPerDegLon = (lat) => 111_320 * Math.cos((lat * Math.PI) / 180);

test('the ward origin maps to itself', () => {
  for (const id of Object.keys(WARD_MAP)) {
    const w = WARD_MAP[id];
    const { lat, lon } = wardLatLon(w, 0, 0);
    assert.equal(lat, w.lat, `${id} centre latitude must be the origin exactly`);
    assert.equal(lon, w.lon, `${id} centre longitude must be the origin exactly`);
  }
});

test('y is NORTHWARD, x is EASTWARD — the house convention', () => {
  const w = WARD_MAP.ballygunge;
  assert.ok(wardLatLon(w, 0, 500).lat > w.lat,
    'a positive y must move NORTH. This is the ward frame\'s ground truth and it has '
    + 'always held — it is what PROVED the render was mirrored (2026-08-05), rather '
    + 'than the data. The earlier wording here said a flip would mean "the buildings '
    + 'are drawn mirrored too": right about the consequence, wrong about the '
    + 'direction. The buildings WERE drawn mirrored, while this stayed correct. See '
    + 'heat-map-frame.test.mjs, which pins the render side.');
  assert.ok(wardLatLon(w, 500, 0).lon > w.lon, 'a positive x must move EAST');
});

test('it inverts scripts/_types.m_per_deg exactly, not approximately', () => {
  const w = WARD_MAP.barrackpore;
  // Forward: the transform scripts/fetch-buildings.py applied to build the frame.
  const lat = 22.7700, lon = 88.3800;
  const x = (lon - w.lon) * mPerDegLon(w.lat);
  const y = (lat - w.lat) * M_PER_DEG_LAT;
  const back = wardLatLon(w, x, y);
  assert.ok(Math.abs(back.lat - lat) < 1e-12, `round trip lost latitude: ${back.lat} vs ${lat}`);
  assert.ok(Math.abs(back.lon - lon) < 1e-12, `round trip lost longitude: ${back.lon} vs ${lon}`);
});

test('every shipped building lands inside its ward window', async () => {
  // The frame is a 1400 m box, clipped a little wider. A coordinate outside
  // roughly ±0.01° of the centre means the inverse is reading the wrong axis
  // or the wrong scale — the failure mode that would put a Ballygunge building
  // in the Bay of Bengal on a client's GIS.
  for (const id of Object.keys(WARD_MAP)) {
    const w = WARD_MAP[id];
    const { b } = JSON.parse(await readFile(
      join(ROOT, `public/heat-map/data/${id}.json`), 'utf8'));
    let worstLat = 0, worstLon = 0;
    for (const row of b) {
      const n = (row.length - 1) >> 1;
      let cx = 0, cy = 0;
      for (let i = 0; i < n; i++) { cx += row[1 + i * 2]; cy += row[2 + i * 2]; }
      const { lat, lon } = wardLatLon(w, cx / n, cy / n);
      worstLat = Math.max(worstLat, Math.abs(lat - w.lat));
      worstLon = Math.max(worstLon, Math.abs(lon - w.lon));
    }
    assert.ok(worstLat < 0.01, `${id}: a building is ${worstLat.toFixed(4)}° off in latitude`);
    assert.ok(worstLon < 0.01, `${id}: a building is ${worstLon.toFixed(4)}° off in longitude`);
    assert.ok(worstLat > 0.003,
      `${id}: no building is further than ${worstLat.toFixed(4)}° from the centre — `
      + 'the window is 1400 m, so something has collapsed the y axis');
  }
});

test('five decimals, and the hemisphere is stated', () => {
  assert.equal(formatLatLon(22.528123, 88.365987), '22.52812° N, 88.36599° E');
  assert.equal(formatLatLon(-33.8688, 151.2093), '33.86880° S, 151.20930° E');
  assert.equal(formatLatLon(22.5, 88.3, '<br>'), '22.50000° N<br>88.30000° E');
  assert.doesNotMatch(formatLatLon(22.528123456, 88.365987654), /\d\.\d{6}/,
    'a sixth decimal claims 11 cm of siting accuracy that a traced footprint '
    + 'centroid does not have, however exact the arithmetic is');
});

test('the card asks for the coordinate row it now populates', async () => {
  const markup = await readFile(
    join(ROOT, 'src/components/ClimateEngine/HeatMapStage.astro'), 'utf8');
  assert.match(markup, /id="bcLL"/,
    'the building card lost its coordinate row; paintCard still writes to it');
  const app = await readFile(
    join(ROOT, 'src/scripts/climate-engine/heat-map-app.ts'), 'utf8');
  assert.match(app, /wardLatLon\(WARDS\[state\.ward\], b\.cx, b\.cz\)/,
    'the coordinate must come from the building centroid and the CURRENT ward — '
    + 'a hardcoded origin was how the loader telemetry shipped a Ballygunge '
    + 'coordinate for every ward');
});
