import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { rasterizeWardBuilt, rasterWardBase } from '../../src/scripts/climate-engine/ward-raster.ts';
import { gridFor } from '../../src/scripts/climate-engine/types.ts';
import { CITIES } from '../../src/data/cities.ts';

/* KOLKATA MUST NOT MOVE WHILE A SECOND CITY IS BUILT AROUND IT.
 *
 * The city refactor replaced the constant CANONICAL_GRID_N = 192 with admitted
 * (grid, ward size) pairs, put a country → city → ward registry under the ward
 * list, and made the solver grid per-ward rather than a module constant. Each of
 * those changes claimed "Kolkata is unchanged". This file is what makes the
 * claim checkable: it pins the rasterised built field — the dominant solver
 * input — for all three Kolkata wards, byte for byte.
 *
 * WHAT THIS CANNOT PROVE. The baseline below was captured AFTER the refactor
 * landed, not before it. So this test cannot certify that the refactor was
 * harmless; if it had already shifted Kolkata, these numbers would have pinned
 * the shifted values. What it does is close the door from here on: any FUTURE
 * change to the grid pairs, the registry or the rasteriser that moves Kolkata
 * fails here and has to be argued for, rather than being discovered later in a
 * temperature field nobody was diffing.
 *
 * WHAT IT DOES NOT COVER. Only `built` is pinned. `veg` and `albedo` come from
 * the measured Sentinel-2 texture and are resampled from a sibling PNG, and the
 * solver itself is pinned elsewhere (heat-sim-parity, heat-sim-per-ward-grid).
 */

/* A checksum over the whole field, not a sample of it. `head`-style pins read
   the first cells and miss a change in the middle — which is exactly where a
   grid or cell-size bug would show, since the wards' buildings are nowhere near
   cell 0. FNV-1a over the raw float bytes is exact and order-sensitive, so any
   moved cell changes it. The scalars beside it exist to make a FAILURE legible:
   the checksum says "something moved", `nonZero` and `sum` say what kind of
   thing — a shifted field, a lost ward, a changed coverage rule. */
function checksum(field) {
  const bytes = new Uint8Array(field.buffer, field.byteOffset, field.byteLength);
  let hash = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/* Captured 2026-09-12 at 7809f84, via rasterizeWardBuilt(ward, 192) on the
   shipped public/heat-map/data/{ward}.json. `sum` is exact rather than
   toleranced because cell coverage is quarters (0, .25, .5, .75, 1) and every
   partial sum is exactly representable — a tolerance here would only hide
   small real movements.

   BALLYGUNGE RE-PINNED 2026-10-02, DELIBERATELY: it became KMC Ward 68 (founder
   decision) — an 1800 m square on the 247-cell admitted pair, 7,931 Overture
   2026-09-23.1 footprints. Was { 1400 m, 192, 3527, 17956, 11669.5,
   1967476418 }. Baruipur and Barrackpore are NOT re-pinned: their values below
   are the 2026-09-12 capture, unchanged, which is the proof that moving one
   ward did not move the other two. */
const PINNED = {
  ballygunge: { sizeM: 1800, n: 247, version: 'hm-grid-247-1800-v1',
    buildings: 7931, nonZero: 33689, sum: 21148.75, checksum: 3601010616 },
  baruipur: { sizeM: 1400, n: 192, version: 'hm-grid-192-v1',
    buildings: 4538, nonZero: 13163, sum: 7433.75, checksum: 3827345544 },
  barrackpore: { sizeM: 1400, n: 192, version: 'hm-grid-192-v1',
    buildings: 4702, nonZero: 16165, sum: 9570.25, checksum: 3648073067 },
};

const wardData = (id) => JSON.parse(
  readFileSync(new URL(`../../public/heat-map/data/${id}.json`, import.meta.url), 'utf8'));

function summarise(field) {
  let sum = 0;
  let nonZero = 0;
  for (const v of field) {
    sum += v;
    if (v > 0) nonZero++;
  }
  return { count: field.length, nonZero, sum, mean: sum / field.length, checksum: checksum(field) };
}

for (const [id, expected] of Object.entries(PINNED)) {
  test(`${id} rasterises identically after the city refactor`, () => {
    const ward = wardData(id);
    assert.equal(ward.sizeM, expected.sizeM, `${id} must still be a ${expected.sizeM} m window`);
    assert.equal(ward.b.length, expected.buildings,
      'the footprint artefact itself changed, so the raster below cannot be compared');

    /* The grid comes from the WARD'S OWN SIZE, through the same lookup the
       solver uses — not from a literal. That is the contract the refactor
       introduced; asserting 192 afterwards is what makes it a pin rather than a
       restatement of whatever gridFor happens to return today. */
    const grid = gridFor(ward.sizeM);
    assert.ok(grid, `${id}: a ${expected.sizeM} m ward must have an admitted grid`);
    assert.equal(grid.n, expected.n, `${id} must still resolve to a ${expected.n} grid`);
    assert.equal(grid.version, expected.version, `${id} keeps the version its cached baselines carry`);

    const got = summarise(rasterizeWardBuilt(ward, grid.n));
    assert.equal(got.count, expected.n * expected.n);
    assert.equal(got.nonZero, expected.nonZero,
      `${id}: the number of built cells moved (${got.nonZero} vs ${expected.nonZero})`);
    assert.equal(got.sum, expected.sum,
      `${id}: total built coverage moved (${got.sum} vs ${expected.sum}, mean ${got.mean})`);
    assert.equal(got.checksum, expected.checksum,
      `${id}: the built field changed somewhere — totals may still match, so diff the field, not the summary`);
  });
}

/* The test above calls the rasteriser directly, which is not how the solver
   reaches it. rasterWardBase is the production entry point, and it derives the
   grid itself via requireGrid(ward.sizeM) — the line the per-ward-grid commit
   actually changed. If that lookup ever sent Kolkata somewhere else, the direct
   call above would still pass while every shipped field moved. */
test('the production raster path lands on the same Kolkata field', () => {
  for (const [id, expected] of Object.entries(PINNED)) {
    /* Only `built` is under test, and it ignores these means entirely; they are
       supplied because the signature requires them, not as data. */
    const layers = rasterWardBase(wardData(id), { fvc: 0, albedo: 0 });
    assert.equal(layers.built.length, expected.n * expected.n, `${id}: rasterWardBase chose another grid`);
    assert.equal(checksum(layers.built), expected.checksum,
      `${id}: rasterWardBase disagrees with a direct rasterizeWardBuilt at the same grid`);
  }
});

test('the registry describes Kolkata as Ward 68 at 1800 m and two 1400 m wards', () => {
  const kolkata = CITIES.kolkata;
  assert.deepEqual(kolkata.wards.map((w) => w.id).sort(), Object.keys(PINNED).sort(),
    'a ward added to or removed from Kolkata is outside what this file pins');
  for (const w of kolkata.wards) {
    assert.equal(w.footprintM, PINNED[w.id].sizeM, `${w.id}: Kolkata's analysis window must not move`);
  }
});

/* Derived from the contract rather than typed in as 7.29: writing the literal
   would let cellMeters and the admitted pair drift apart while this test kept
   agreeing with the number it had memorised.

   RE-PINNED 2026-10-02. The city declares the cell size of its FIRST ward, which
   is now Ballygunge's 1800/247 = 7.2874 m; the two 1400 m wards still run
   1400/192 = 7.2917 m. Exact equality across cities was the promise while every
   pair was a 175/24 m multiple; the founder accepted 247 cells over 1800 m
   (0.057 % finer) rather than a domain that is not 1.8 km, so the promise is
   now "the same cell to within 0.1 %", and this test holds it to that. */
test('Kolkata still declares the cell size its grid implies', () => {
  const first = CITIES.kolkata.wards[0];
  const grid = gridFor(first.footprintM);
  assert.ok(grid, `the ${first.footprintM} m pair must remain admitted`);
  assert.ok(Math.abs(CITIES.kolkata.cellMeters - first.footprintM / grid.n) < 1e-9,
    `declared ${CITIES.kolkata.cellMeters} m cells, grid implies ${first.footprintM / grid.n}`);
  for (const w of CITIES.kolkata.wards) {
    const g = gridFor(w.footprintM);
    assert.ok(Math.abs(w.footprintM / g.n - 1400 / 192) / (1400 / 192) < 1e-3,
      `${w.id}: ${w.footprintM / g.n} m cells are not within 0.1 % of 1400/192`);
  }
  assert.ok(Math.abs(CITIES.kolkata.cellMeters - CITIES.bengaluru.cellMeters)
    / CITIES.bengaluru.cellMeters < 1e-3,
    'the second city was admitted on the promise that a cell means the same thing in both');
});
