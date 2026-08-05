import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { wardMercatorScale, wardToMercator, MERCATOR_MEAN_RADIUS_M }
  from '../../src/scripts/climate-engine/ward-frame.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WARDS = ['ballygunge', 'barrackpore', 'baruipur'];

/** MapLibre's own MercatorCoordinate.fromLngLat, written out so the test depends
 *  on the SPEC rather than on the library we are trying to agree with. */
function mercator(lon, lat) {
  return {
    x: (180 + lon) / 360,
    y: (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360,
  };
}
/** …and its metre scale, likewise from the spec. */
function metreInMercator(lat) {
  return 1 / (2 * Math.PI * MERCATOR_MEAN_RADIUS_M * Math.cos((lat * Math.PI) / 180));
}

const centroid = (flat) => {
  const xs = flat.filter((_, i) => i % 2 === 0), ys = flat.filter((_, i) => i % 2 === 1);
  return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
};
/** `lonlat` is the CLOSED ring — its last vertex repeats its first — while `p` is
 *  open. Comparing the two centroids naively double-counts that vertex and reads
 *  as ~1.4 m of phantom error, which looks exactly like a real registration
 *  problem. Drop the closing vertex. */
const centroidLL = (closed) => {
  const ring = closed.length > 1
    && closed[0][0] === closed[closed.length - 1][0]
    && closed[0][1] === closed[closed.length - 1][1]
    ? closed.slice(0, -1) : closed;
  return [
    ring.reduce((a, p) => a + p[0], 0) / ring.length,
    ring.reduce((a, p) => a + p[1], 0) / ring.length,
  ];
};

/** Metres of error on the ground for a mercator offset at this latitude. */
const toMetres = (d, lat) => d / metreInMercator(lat);

async function measure(ward, project) {
  const { WARD_MAP } = await import('../../src/data/wards.ts');
  const origin = WARD_MAP[ward];
  const doc = JSON.parse(await readFile(
    join(ROOT, `data/geometry/${ward}-footprints.json`), 'utf8'));
  const o = mercator(origin.lon, origin.lat);
  const errs = [];
  for (const row of doc.b) {
    const [px, py] = centroid(row.p);
    const [lo, la] = centroidLL(row.lonlat);
    const got = project(o, origin.lat, px, py);
    const want = mercator(lo, la);
    errs.push(toMetres(Math.hypot(got.x - want.x, got.y - want.y), origin.lat));
  }
  errs.sort((a, b) => a - b);
  return { n: errs.length, median: errs[errs.length >> 1], p95: errs[Math.floor(errs.length * 0.95)] };
}

/** The transform as it ships TODAY: isotropic, and north put on +mercator y. */
const legacy = (o, lat, x, y) => {
  const s = metreInMercator(lat);
  return { x: o.x + x * s, y: o.y + y * s };
};

test('every shipped building lands on its own lon/lat, to centimetres', async () => {
  for (const ward of WARDS) {
    const r = await measure(ward, (o, lat, x, y) =>
      wardToMercator(o, wardMercatorScale(lat), x, y));
    assert.ok(r.median <= 0.05,
      `${ward}: median ${r.median.toFixed(4)} m exceeds 5 cm (n=${r.n})`);
    assert.ok(r.p95 <= 0.10,
      `${ward}: p95 ${r.p95.toFixed(4)} m exceeds 10 cm (n=${r.n})`);
  }
});

test('the transform that shipped is off by HUNDREDS of metres — the mirror', async () => {
  // Without this the suite would pass on a reverted fix. The failure it pins is a
  // north-south reflection about the ward's centre line, which reads as ~700 m of
  // median error, not as drift.
  const r = await measure('ballygunge', legacy);
  assert.ok(r.median > 100,
    `the legacy transform should be catastrophically wrong; measured median ${r.median.toFixed(1)} m. `
    + 'If this drops, the mirror has been reintroduced somewhere and test 1 is passing for '
    + 'the wrong reason.');
});

test('north DECREASES mercator y — the whole bug in one assertion', () => {
  const f = wardMercatorScale(22.528);
  const o = mercator(88.3659, 22.528);
  const north = wardToMercator(o, f, 0, 500);
  const south = wardToMercator(o, f, 0, -500);
  assert.ok(north.y < o.y,
    'a building 500 m NORTH must have a SMALLER mercator y. MapLibre mercator y grows '
    + 'southward; putting our northing on +y is exactly what drew the whole ward mirrored.');
  assert.ok(south.y > o.y, 'and 500 m south must have a larger mercator y');
  assert.ok(Math.abs((o.y - north.y) - (south.y - o.y)) < 1e-12, 'symmetric about the origin');
});

test('the scale is ANISOTROPIC — east and north differ by 0.7%', () => {
  const f = wardMercatorScale(22.528);
  assert.notEqual(f.east, f.north);
  const ratio = f.north / f.east;
  assert.ok(Math.abs(ratio - 111_320 / 110_540) < 1e-9,
    `north/east must be 111320/110540 = ${(111_320 / 110_540).toFixed(6)}, got ${ratio.toFixed(6)}. `
    + 'This is the ~4 m rim error: our data frame uses 110540 m/deg north while MapLibre '
    + 'uses its own sphere. A constant offset cannot correct it — the error grows with y.');
});

test('altitude keeps MapLibre\'s own metre, because heights are drawn in it', () => {
  const lat = 22.528;
  assert.ok(Math.abs(wardMercatorScale(lat).up - metreInMercator(lat)) < 1e-18,
    'building heights are not in the ward frame — they are true metres, and the vertical '
    + 'scale must stay MapLibre\'s own or an 87 m tower draws at the wrong height');
});
