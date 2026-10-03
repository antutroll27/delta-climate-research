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

/* RE-PINNED 2026-10-02. "One ward size per city" stopped being true when Ballygunge became
   the 1800 m square around KMC Ward 68 beside two 1400 m wards. What the rule protected was
   the declared resolution being honest for EVERY ward, so that is what is asserted now: the
   city declares its first ward's cell size, and every ward's own pair computes a cell within
   0.1 % of it (7.2874 vs 7.2917 m — see the 247-cell row in types.ts). */
test('each city declares its own resolution, and it is honest', () => {
  for (const [id, city] of Object.entries(CITIES)) {
    const wards = wardsOfCity(id);
    const first = gridFor(wards[0].footprintM);
    assert.ok(Math.abs(city.cellMeters - wards[0].footprintM / first.n) < 1e-6,
      `${id}: declares ${city.cellMeters} m cells but its first ward computes ${wards[0].footprintM / first.n}`);
    for (const w of wards) {
      const cell = w.footprintM / gridFor(w.footprintM).n;
      assert.ok(Math.abs(cell - city.cellMeters) / city.cellMeters < 1e-3,
        `${id}/${w.id}: ${cell} m cells are not within 0.1 % of the declared ${city.cellMeters} m`);
    }
  }
});

test('Bengaluru and Kolkata resolve to the same cell size', () => {
  assert.ok(Math.abs(CITIES.kolkata.cellMeters - CITIES.bengaluru.cellMeters) / CITIES.bengaluru.cellMeters < 1e-3,
    'the whole point of 384 was that a cell means one thing in both cities (to 0.1 % since Ward 68)');
});
