import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';
import { AREA_KEYS, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';

/**
 * THE CITY RECORD CARRIES WHEN IT ARRIVED, AND WHAT TO SHOW.
 *
 * `since` is the date a city became reachable in production. The badge's window
 * is measured from it, so the announcement retires itself rather than living as
 * copy someone must remember to delete. `showcase` names the ward worth opening
 * first: Bengaluru declares indiranagar first in the registry, so "the first
 * drawable area" would send a reader somewhere the city is not at its best.
 */
test('Bengaluru declares when it arrived and which ward represents it', () => {
  const blr = CITIES.bengaluru;
  assert.ok(blr, 'the registry has no bengaluru city record');
  assert.equal(blr.showcase, 'mg-road',
    'MG Road is the ward with the citable landmarks (Vidhana Soudha, UB Tower)');
});

test('Kolkata declares no arrival date, so it is never announced as new', () => {
  assert.equal(CITIES.kolkata.since, undefined,
    'Kolkata predates the badge; a date here would advertise the city the reader is already in');
});

/**
 * A REGEX CANNOT TELL A REAL DATE FROM A DIGIT-SHAPED STRING.
 *
 * `/^\d{4}-\d{2}-\d{2}$/` accepts '2026-13-01', which Date.parse turns into NaN —
 * and Task 2's filter is Number.isFinite(since), so an impossible month means the
 * city is NEVER announced, silently. It also accepts '2026-09-31', which does NOT
 * produce NaN: V8 rolls it forward to 2026-10-01, so a day typo silently shifts the
 * announcement window instead of failing anything. Parse it and round-trip it back
 * to the string it started as; loop over every city so a later addition is covered
 * for free.
 */
test('every declared arrival date is a real day, and the day it names', () => {
  for (const [id, city] of Object.entries(CITIES)) {
    if (city.since === undefined) continue;
    const t = Date.parse(`${city.since}T00:00:00Z`);
    assert.ok(Number.isFinite(t),
      `${id}.since "${city.since}" is not a real date; newCityToAnnounce would silently never announce it`);
    assert.equal(new Date(t).toISOString().slice(0, 10), city.since,
      `${id}.since "${city.since}" is not the day it names — Date.parse rolled it over`);
  }
});

/**
 * `showcase` IS A WARD ID, BUT IT MUST ALSO RESOLVE AS AN AREA ID.
 *
 * cities.ts's `wards` array and scope/registry.ts's `AREA_KEYS` are two separate
 * namespaces. They are only cross-checked, in obos-scope.test.mjs, for areas that
 * ship data — and all three Bengaluru areas are shipsData: false, so nothing forces
 * a ward id to equal its area id. Task 2 resolves `showcase` against AREA_KEYS, so a
 * future city with a showcase spelled differently from its area slug (e.g.
 * 'mgroad') would pass every other gate and silently fall back to the first
 * drawable area instead of the founder's chosen ward.
 */
test('every declared showcase is a ward of its own city and an area the instrument can open', () => {
  for (const [id, city] of Object.entries(CITIES)) {
    if (city.showcase === undefined) continue;
    assert.ok(city.wards.some((w) => w.id === city.showcase),
      `${id}.showcase "${city.showcase}" is not one of its wards`);
    assert.ok(AREA_KEYS.some((k) => splitKey(k).city === id && splitKey(k).area === city.showcase),
      `${id}.showcase "${city.showcase}" is not a registered area id — newCityToAnnounce `
      + 'would silently fall back to the first drawable area');
  }
});
