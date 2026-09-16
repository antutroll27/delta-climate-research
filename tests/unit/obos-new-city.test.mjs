import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';
import { AREA_KEYS, splitKey } from '../../src/scripts/climate-engine/scope/registry.ts';

/**
 * `showcase` NAMES THE WARD WORTH OPENING FIRST, NOT "THE FIRST ONE".
 *
 * Bengaluru declares indiranagar first in the registry, but its citable
 * landmarks are in MG Road; a reader who follows the badge's link should land
 * where the city is recognisable, not wherever the array happens to start.
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
  let checked = 0;
  for (const [id, city] of Object.entries(CITIES)) {
    if (city.since === undefined) continue;
    const t = arrivedMs(city);
    assert.ok(Number.isFinite(t),
      `${id}.since "${city.since}" is not a real date; newCityToAnnounce would silently never announce it`);
    assert.equal(new Date(t).toISOString().slice(0, 10), city.since,
      `${id}.since "${city.since}" is not the day it names — Date.parse rolled it over`);
    checked += 1;
  }
  // Guard the guard: if no city declared a `since`, the loop above would pass
  // while checking nothing, and the badge could never fire for anyone.
  assert.ok(checked > 0,
    'no city declares an arrival date, so this loop checked nothing — and the badge can never fire');
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

import {
  NEW_CITY_DAYS,
  arrivedMs,
  newCityKey,
  newCityToAnnounce,
  wasDismissed,
  rememberDismissed,
} from '../../src/scripts/climate-engine/shell/new-city.ts';

/** A store that records writes, like the ones obos-shell.test.mjs uses. */
const fakeStore = (seed = {}) => {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
};

/** A store that throws on both halves — a private window, or blocked site data. */
const hostileStore = () => ({
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('SecurityError'); },
});

const DAY = 86_400_000;
const ARRIVED = Date.parse('2026-09-16T00:00:00Z');

test('a city inside the window is announced, and names its showcase ward', () => {
  const found = newCityToAnnounce('kolkata', new Date(ARRIVED + 3 * DAY), fakeStore());
  assert.equal(found?.id, 'bengaluru');
  assert.equal(found?.name, 'Bengaluru');
  assert.equal(found?.href, '/heat-map/in/bengaluru/mg-road/');
});

test('the window is ninety days: a city 89 days old is still announced, 91 days old is not', () => {
  /* LITERALS ON PURPOSE. Deriving the boundary from NEW_CITY_DAYS — as this test
     first did — makes the constant cancel out of its own guard: cutoff lands one
     day after arrival for D = 1, 90 or 90_000 alike, so every value passes and the
     ninety is pinned by nothing. Two literal days either side pin the number and
     the comparison at once. */
  const store = fakeStore();
  assert.equal(newCityToAnnounce('kolkata', new Date(ARRIVED + 89 * DAY), store)?.id, 'bengaluru',
    'a city 89 days old is inside a ninety-day window');
  assert.equal(newCityToAnnounce('kolkata', new Date(ARRIVED + 91 * DAY), store), null,
    'a city 91 days old is outside it, and the badge retires itself');
  assert.equal(NEW_CITY_DAYS, 90,
    'the two day counts above are written against a ninety-day window');
});

test('a city is not announced before it arrives', () => {
  const early = new Date(ARRIVED - DAY);
  assert.equal(newCityToAnnounce('kolkata', early, fakeStore()), null);
});

test('the reader is never told about the city they are already in', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('bengaluru', when, fakeStore()), null);
});

test('a dismissed city stays dismissed, and only that city', () => {
  const store = fakeStore();
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, store)?.id, 'bengaluru');
  rememberDismissed('bengaluru', store);
  assert.equal(wasDismissed('bengaluru', store), true);
  assert.equal(wasDismissed('someplace-else', store), false);
  assert.equal(newCityToAnnounce('kolkata', when, store), null);
});

test('the key is namespaced like every other preference this console stores', () => {
  assert.equal(newCityKey('bengaluru'), 'obos:new-city:bengaluru');
});

test('an unreadable store shows the badge rather than swallowing it', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, hostileStore())?.id, 'bengaluru');
  assert.equal(wasDismissed('bengaluru', hostileStore()), false);
  assert.doesNotThrow(() => rememberDismissed('bengaluru', hostileStore()));
});

test('a null store is the same as no store, never a crash', () => {
  const when = new Date(ARRIVED + DAY);
  assert.equal(newCityToAnnounce('kolkata', when, null)?.id, 'bengaluru');
  assert.doesNotThrow(() => rememberDismissed('bengaluru', null));
});
