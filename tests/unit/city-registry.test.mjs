import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES, CITY_OF, wardsOfCity, allWards } from '../../src/data/cities.ts';
import { gridFor } from '../../src/scripts/climate-engine/types.ts';

/* Four places used to hard-code the ward list, and one of them was a TYPE:
   `type WardId = 'ballygunge' | 'baruipur' | 'barrackpore'`. That wrote "there
   are exactly three wards and they are Kolkata's" into the type system, so a
   second city was not a data change but a type change rippling through every
   switch. This registry is the one source; these tests keep it honest. */

test('both cities are present with three wards each', () => {
  assert.deepEqual(Object.keys(CITIES).sort(), ['bengaluru', 'kolkata']);
  assert.equal(wardsOfCity('kolkata').length, 3);
  assert.equal(wardsOfCity('bengaluru').length, 3);
});

test('every ward id is unique across cities', () => {
  const ids = allWards().map((w) => w.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ward id: ${ids.join(', ')}`);
});

test('every ward maps back to exactly one city', () => {
  for (const w of allWards()) {
    const city = CITY_OF[w.id];
    assert.ok(city, `${w.id} has no city`);
    assert.ok(wardsOfCity(city).some((x) => x.id === w.id), `${w.id} not in ${city}`);
  }
});

test('every ward size has an admitted grid', () => {
  for (const w of allWards()) {
    assert.ok(gridFor(w.footprintM), `${w.id}: ${w.footprintM} m has no admitted grid`);
  }
});

test('each city declares its own resolution, and it is honest', () => {
  for (const [id, city] of Object.entries(CITIES)) {
    const sizes = wardsOfCity(id).map((w) => w.footprintM);
    assert.equal(new Set(sizes).size, 1, `${id}: wards of differing size cannot share one declared resolution`);
    const g = gridFor(sizes[0]);
    assert.ok(Math.abs(city.cellMeters - sizes[0] / g.n) < 1e-6,
      `${id}: declares ${city.cellMeters} m cells but its wards compute ${sizes[0] / g.n}`);
  }
});

test('Bengaluru and Kolkata resolve to the same cell size', () => {
  assert.ok(Math.abs(CITIES.kolkata.cellMeters - CITIES.bengaluru.cellMeters) < 1e-6,
    'the whole point of 384 was that a cell means one thing in both cities');
});
