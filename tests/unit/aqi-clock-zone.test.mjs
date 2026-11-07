import assert from 'node:assert/strict';
import test from 'node:test';

import { fixedClock, IST_CLOCK, zoneClock } from '../../src/lib/aqi/clock.ts';

/* THE DAYLIGHT-SAVING CLOCK (plan Phase C3). `fixedClock` still refuses a zone whose offset
   moves, because the Indian hour windows walk by 3,600,000 ms over local wall-clock keys.
   `zoneClock` is the clock for a zone that may move: every answer is a function of a UTC
   INSTANT, and wall-clock times map back to instants only with the ambiguity spelled out.

   The two 2027 changes are the EU's (last Sunday of March and of October, 01:00 UTC both):
   2027-03-28 02:00 CET -> 03:00 CEST (a 23-hour day) and 2027-10-31 03:00 CEST -> 02:00 CET
   (a 25-hour day). */

const AMS = zoneClock('Europe/Amsterdam');
const TYO = zoneClock('Asia/Tokyo');
const ist = zoneClock('Asia/Kolkata');
const z = (s) => Date.parse(s);
const H = 3_600_000;

test('Amsterdam: spring forward 2027-03-28, 01:00 UTC is 02:00 CET -> 03:00 CEST', () => {
  assert.equal(AMS.observesDst, true);
  assert.equal(AMS.isoAt(z('2027-03-28T00:59:00Z')), '2027-03-28T01:59:00+01:00');
  assert.equal(AMS.isoAt(z('2027-03-28T01:00:00Z')), '2027-03-28T03:00:00+02:00');
  assert.equal(AMS.offsetAt(z('2027-03-28T00:59:59Z')), 1 * H);
  assert.equal(AMS.offsetAt(z('2027-03-28T01:00:00Z')), 2 * H);
  assert.equal(AMS.dateAt(z('2027-03-28T22:30:00Z')), '2027-03-29', '00:30 CEST is already the 29th');
});

test('Amsterdam: fall back 2027-10-31, 01:00 UTC is 03:00 CEST -> 02:00 CET and 02:30 happens twice', () => {
  assert.equal(AMS.isoAt(z('2027-10-31T00:30:00Z')), '2027-10-31T02:30:00+02:00');
  assert.equal(AMS.isoAt(z('2027-10-31T01:00:00Z')), '2027-10-31T02:00:00+01:00');
  assert.equal(AMS.isoAt(z('2027-10-31T01:30:00Z')), '2027-10-31T02:30:00+01:00');
  assert.equal(AMS.offsetAt(z('2027-10-31T00:59:59Z')), 2 * H);
  assert.equal(AMS.offsetAt(z('2027-10-31T01:00:00Z')), 1 * H);
});

test('Amsterdam: the local day is 23 h on 2027-03-28, 25 h on 2027-10-31 and 24 h either side', () => {
  const spring = AMS.dayBounds('2027-03-28');
  assert.equal(spring.hours, 23);
  assert.equal(spring.startMs, z('2027-03-27T23:00:00Z'));
  assert.equal(spring.endMs, z('2027-03-28T22:00:00Z'));
  const fall = AMS.dayBounds('2027-10-31');
  assert.equal(fall.hours, 25);
  assert.equal(fall.startMs, z('2027-10-30T22:00:00Z'));
  assert.equal(fall.endMs, z('2027-10-31T23:00:00Z'));
  for (const d of ['2027-03-27', '2027-03-29', '2027-10-30', '2027-11-01', '2027-06-15', '2027-01-15']) {
    assert.equal(AMS.dayBounds(d).hours, 24, d);
  }
});

test('a wall time that does not exist is null; one that happens twice must say which', () => {
  assert.equal(AMS.utcFromLocal('2027-03-28', 2, 30, 'earlier'), null, '02:30 is skipped on 28 March');
  assert.equal(AMS.utcFromLocal('2027-03-28', 3, 0, 'earlier'), z('2027-03-28T01:00:00Z'));
  assert.equal(AMS.utcFromLocal('2027-03-28', 1, 59, 'earlier'), z('2027-03-28T00:59:00Z'));
  assert.equal(AMS.utcFromLocal('2027-10-31', 2, 30, 'earlier'), z('2027-10-31T00:30:00Z'));
  assert.equal(AMS.utcFromLocal('2027-10-31', 2, 30, 'later'), z('2027-10-31T01:30:00Z'));
  assert.equal(AMS.utcFromLocal('2027-10-31', 1, 59, 'later'), z('2027-10-30T23:59:00Z'), 'unambiguous: the choice is ignored');
  assert.equal(AMS.utcFromLocal('2027-10-31', 3, 0, 'earlier'), z('2027-10-31T02:00:00Z'));
});

test('every hour of the 25-hour day has its own distinct start instant (no duplicate hour keys)', () => {
  const { startMs, hours } = AMS.dayBounds('2027-10-31');
  const stamps = Array.from({ length: hours }, (_, i) => AMS.isoAt(startMs + i * H));
  assert.equal(new Set(stamps).size, 25);
  assert.deepEqual(stamps.slice(1, 5), [
    '2027-10-31T01:00:00+02:00', '2027-10-31T02:00:00+02:00', '2027-10-31T02:00:00+01:00', '2027-10-31T03:00:00+01:00',
  ]);
  const spring = AMS.dayBounds('2027-03-28');
  const s2 = Array.from({ length: spring.hours }, (_, i) => AMS.isoAt(spring.startMs + i * H).slice(11, 13));
  assert.deepEqual(s2.slice(0, 5), ['00', '01', '03', '04', '05'], '02 never appears');
});

test('the hour containing an instant starts on the local hour, in whole-hour and half-hour zones', () => {
  assert.equal(AMS.hourStartMs(z('2027-10-31T01:30:00Z')), z('2027-10-31T01:00:00Z'));
  assert.equal(AMS.hourStartMs(z('2027-03-28T00:59:59Z')), z('2027-03-28T00:00:00Z'));
  /* IST is UTC+5:30: its clock hours begin at :30 UTC. */
  assert.equal(ist.hourStartMs(z('2026-09-27T23:45:00Z')), z('2026-09-27T23:30:00Z'));
  assert.equal(ist.hourStartMs(z('2026-09-27T23:15:00Z')), z('2026-09-27T22:30:00Z'));
});

test('Tokyo has no daylight saving: a fixed +09:00 and 24 h days on the same two dates', () => {
  assert.equal(TYO.observesDst, false);
  assert.equal(TYO.isoAt(z('2027-03-28T01:00:00Z')), '2027-03-28T10:00:00+09:00');
  assert.equal(TYO.isoAt(z('2027-10-31T01:00:00Z')), '2027-10-31T10:00:00+09:00');
  assert.equal(TYO.dayBounds('2027-03-28').hours, 24);
  assert.equal(TYO.dayBounds('2027-10-31').hours, 24);
  assert.equal(TYO.utcFromLocal('2027-10-31', 2, 30, 'later'), z('2027-10-30T17:30:00Z'));
  assert.equal(fixedClock('Asia/Tokyo').isoSuffix, '+09:00', 'the fixed clock still serves Japan');
});

test('the Indian fixed clock and the zone clock agree on IST, and the fixed clock still refuses a moving zone', () => {
  assert.equal(ist.observesDst, false);
  assert.equal(ist.offsetAt(z('2026-09-27T23:30:00Z')), IST_CLOCK.offsetMs);
  assert.equal(ist.isoAt(z('2026-09-27T23:30:00Z')), '2026-09-28T05:00:00+05:30');
  assert.throws(() => fixedClock('Europe/Amsterdam'), /observes daylight saving \(\+01:00 \/ \+02:00\)/);
});

test('bad input is refused rather than rolled over', () => {
  assert.throws(() => AMS.dayBounds('2027-02-30'), RangeError);
  assert.throws(() => AMS.dayBounds('27-03-28'), RangeError);
  assert.throws(() => AMS.utcFromLocal('2027-03-28', 24, 0, 'earlier'), RangeError);
  assert.throws(() => AMS.isoAt(Number.NaN), RangeError);
  assert.throws(() => zoneClock('Not/AZone'), RangeError);
});
