import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { asTerrainField, terrainDrawAt, terrainLabel } from '../../src/scripts/climate-engine/terrain.ts';
import { asTreesFile } from '../../src/scripts/climate-engine/vegetation-layer.ts';

/* AMSTERDAM, PHASE A TASKS A8-A10. The exported artefacts are read by the browser's own
   narrowing functions, so a contract mismatch fails here rather than as a silently empty
   layer. Orientation is asserted at OFF-CENTRE, unpaired points: a mirrored field agrees
   with itself on every symmetric statistic and disagrees here. */

const ROOT = new URL('../../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const PUB = 'public/heat-map/data/canal-ring';

test('terrain: the browser draws the ground the data file holds (row 0 NORTH after one flip), 1:1, below zero allowed', () => {
  const src = json('data/cities/amsterdam/canal-ring-terrain.json');         // row 0 = SOUTH, NAP metres
  const field = asTerrainField(json(`${PUB}-terrain.json`));
  assert.ok(field, 'the shipped terrain did not narrow to a field: the area would draw flat');
  assert.equal(field.exaggeration, 1);
  assert.match(terrainLabel(field), /1:1/);
  const n = src.n, size = src.sizeM, half = size / 2;
  const south = (x, y) => {                                                    // bilinear on the SOUTH-first file
    const gx = Math.min(Math.max((x + half) / size * (n - 1), 0), n - 1);
    const gy = Math.min(Math.max((y + half) / size * (n - 1), 0), n - 1);
    const x0 = Math.trunc(gx), y0 = Math.trunc(gy), x1 = Math.min(x0 + 1, n - 1), y1 = Math.min(y0 + 1, n - 1);
    const fx = gx - x0, fy = gy - y0;
    return (src.h[y0 * n + x0] * (1 - fx) + src.h[y0 * n + x1] * fx) * (1 - fy)
      + (src.h[y1 * n + x0] * (1 - fx) + src.h[y1 * n + x1] * fx) * fy;
  };
  let worst = 0;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 7919) % size) - half + 0.37, y = ((i * 104729) % size) - half + 0.61;
    worst = Math.max(worst, Math.abs(terrainDrawAt(field, x, y) - (south(x, y) - src.meanM)));
  }
  assert.ok(worst < 0.02, `web ground differs from the data file by up to ${worst.toFixed(3)} m: mirrored, mis-datumed or exaggerated`);
  // terrain.ts does not clamp heights at zero (only the sample INDEX is clamped): the lowest cell (-2.5 m NAP after the pit patch) survives.
  assert.ok(Math.min(...field.h) < -2, 'the lowest mesh cell (about -3 m relative to the mean) must reach the browser unclamped');
  // ...and the mirror is genuinely different at these points, so the check above could fail.
  let mirrored = 0;
  for (let i = 0; i < 400; i++) {
    const x = ((i * 7919) % size) - half + 0.37, y = ((i * 104729) % size) - half + 0.61;
    mirrored = Math.max(mirrored, Math.abs(terrainDrawAt(field, x, -y) - (south(x, y) - src.meanM)));
  }
  assert.ok(mirrored > 1, `a mirrored terrain would differ by ${mirrored.toFixed(2)} m here: the guard has teeth`);
});

/* F6 (Amsterdam audit): AHN4 was flown in 2020 and recorded the open construction pit of a building finished in 2022 (NL.IMBAG.Pand.0363100012250514,
   27.7 m tall, 3D BAG ground -0.98 m NAP). The served mesh dropped to -4.52 m NAP under it. The terrain is patched from b3_h_maaiveld. */
test('terrain: no pit under a building put up after the AHN4 flight', () => {
  const src = json('data/cities/amsterdam/canal-ring-terrain.json');
  const n = src.n;
  // the cell the audit measured: row 19 from the SOUTH edge, column 49 (about 52.35653 N, 4.88564 E)
  const pit = src.h[19 * n + 49];
  assert.ok(pit > -1.5, `the pit cell is ${pit} m NAP: the AHN4 construction pit is back in the served terrain`);
  assert.ok(Math.min(...src.h) > -3, 'no mesh cell may sit more than 3 m under NAP in this square');
  const patch = src.postAhn4Patch;
  assert.ok(patch, 'the patch is recorded in the terrain file');
  const ids = patch.buildings.map((b) => b.id);
  assert.ok(ids.includes('NL.IMBAG.Pand.0363100012250514'));
  assert.ok(patch.buildings.every((b) => b.builtYear > 2020), 'only buildings first built after the 2020 AHN4 flight are patched');
  assert.equal(patch.cellsChanged, 14);
  assert.ok(patch.cellsChangedOver0_5m >= 8 && patch.pixelsRaised > 5000);
  // and the file the browser fetches carries the same fix (public = data, datum removed, flipped to row 0 = NORTH)
  const pub = json(`${PUB}-terrain.json`);
  assert.ok(Math.min(...pub.h) + pub.datumM > -3);
});

test('trees: Amsterdam draws no palms (founder decision: none outside the tropics), under its own one-name header', () => {
  const raw = json(`${PUB}-trees.json`);
  assert.deepEqual(raw.speciesNames, ['broadleaf']);
  const t = asTreesFile(raw);
  assert.ok(t && t.trees.length > 10000);
  assert.ok(t.trees.every((p) => p.species === 'broadleaf'));
  assert.ok(!JSON.stringify(raw.speciesNames).includes('palm'));
});

test('trees: the file narrows through asTreesFile, in the north-up frame', () => {
  const t = asTreesFile(json(`${PUB}-trees.json`));
  assert.ok(t, 'the shipped trees did not narrow');
  assert.equal(t.sizeM, 2800);
  assert.ok(t.trees.length > 10000);
  const half = 1400;
  assert.ok(t.trees.every((p) => Math.abs(p.x) <= half + 1 && Math.abs(p.y) <= half + 1));
});

test('buildings: rows are [h, x, z, ...] with z = NORTH, and Vondelpark (south-west of centre) has fewer buildings than the centre', () => {
  const b = json(`${PUB}.json`);
  assert.equal(b.count, b.b.length);
  assert.equal(b.sizeM, 2800);
  assert.match(b.heightsNote, /70th|percentile|NAP/);
  const inBox = (x, z, x0, x1, z0, z1) => x > x0 && x < x1 && z > z0 && z < z1;
  const count = (x0, x1, z0, z1) => b.b.filter((r) => inBox(r[1], r[2], x0, x1, z0, z1)).length;
  // Vondelpark spans roughly x -1500..-700, z -1100..-250 from this centre: sparse in buildings.
  const park = count(-1300, -800, -900, -400) / (500 * 500);
  const core = count(-300, 300, -300, 300) / (600 * 600);
  assert.ok(park < core, `park density ${park} should be below the core's ${core}`);
  // The mirrored park window (z -> -z) is dense city: the same statistic would NOT hold on a mirrored frame.
  const mirroredPark = count(-1300, -800, 400, 900) / (500 * 500);
  assert.ok(mirroredPark > 1.5 * park, `mirrored window ${mirroredPark} vs park ${park}`);
});

test('roads and water are in the same frame and carry counts that agree with their rows', () => {
  const r = json(`${PUB}-roads.json`), w = json(`${PUB}-water.json`);
  assert.equal(r.count, r.ways.length);
  assert.ok(r.ways.every((x) => x.w === 1 || x.w === 2));
  assert.equal(w.count, w.polys.length);
  assert.equal(w.fieldM, 2800);
  assert.ok(w.coveredDropped >= 0 && w.lines.length > 0);
});

test('veg in cities.ts is the measured Sentinel-2 FVC of the exported surface raster, not the A2 placeholder', async () => {
  const { wardsOfCity } = await import('../../src/data/cities.ts');
  const veg = wardsOfCity('amsterdam')[0].veg;
  const meta = json('public/heat-map/data/surface-meta.json').wards['canal-ring'];
  assert.equal(meta.level, 'measured');
  assert.equal(meta.grid, 280);
  assert.ok(veg > 0 && veg < 1, `veg is ${veg}`);
  assert.equal(veg, Math.round(meta.fvc_mean * 1000) / 1000, 'cities.ts holds the measured mean to three places');
});

test('surface: Amsterdam is composited from high-sun scenes only, and the file says so', () => {
  const meta = json('public/heat-map/data/surface-meta.json').wards['canal-ring'];
  assert.equal(meta.sunElevationFloorDeg, 40);
  assert.ok(meta.scenes >= 20, `only ${meta.scenes} scenes in the composite`);
  // Kolkata's and Bengaluru's rows carry no floor: their selection is unchanged
  const wards = json('public/heat-map/data/surface-meta.json').wards;
  for (const id of ['ballygunge', 'baruipur', 'barrackpore', 'indiranagar', 'mg-road', 'whitefield']) {
    assert.equal(wards[id].sunElevationFloorDeg, undefined, id);
  }
});
