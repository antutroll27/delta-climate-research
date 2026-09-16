import assert from 'node:assert/strict';
import test from 'node:test';

import { CITIES } from '../../src/data/cities.ts';

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
  assert.match(blr.since ?? '', /^\d{4}-\d{2}-\d{2}$/,
    `bengaluru.since must be an ISO date, got ${JSON.stringify(blr.since)}`);
  assert.equal(blr.showcase, 'mg-road',
    'MG Road is the ward with the citable landmarks (Vidhana Soudha, UB Tower)');
  assert.ok(blr.wards.some((w) => w.id === blr.showcase),
    `bengaluru.showcase "${blr.showcase}" is not one of its wards`);
});

test('Kolkata declares no arrival date, so it is never announced as new', () => {
  assert.equal(CITIES.kolkata.since, undefined,
    'Kolkata predates the badge; a date here would advertise the city the reader is already in');
});
