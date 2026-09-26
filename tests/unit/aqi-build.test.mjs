// tests/unit/aqi-build.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayload, LIVE_H, STALE_DAYS } from '../../src/lib/aqi/build.ts';
import { isStampedUtc } from '../../src/lib/aqi/hours.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';

const KEY = 'in/kolkata/ballygunge';
/** Every pollutant reporting every quarter-hour up to `lastEnd`, clean air. */
function rawUpTo(lastEnd, days = 31) {
  const end = Date.parse(lastEnd), out = {};
  for (const p of ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3']) {
    out[p] = [];
    for (let t = end - days * 86_400_000; t <= end; t += 900_000) out[p].push({ end_utc: new Date(t).toISOString(), value: p === 'co' ? 0.5 : 20 });
  }
  return out;
}
const at = (iso, plusMs = 0) => new Date(Date.parse(iso) + plusMs);

test('fresh complete data is live', () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:30:00Z'));
  assert.equal(p.current.state, 'live');
  assert.equal(p.current.result.category, 'good');
  assert.equal(p.history.days.length, 30);
});

test(`older than ${LIVE_H} h is stale, with its age`, () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-26T08:30:00Z'));
  assert.equal(p.current.state, 'stale');
  assert.equal(p.current.age_h, 39);
});

test(`older than ${STALE_DAYS} days is unavailable and carries no AQI`, () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-10-02T18:00:00Z'));
  assert.equal(p.current.state, 'unavailable');
  assert.equal('result' in p.current, false);
});

test('a fresh window with too few hours is insufficient_data, with reasons', () => {
  const raw = rawUpTo('2026-09-24T17:30:00Z');
  // Drops IST hours 12..20 entirely (9 hours), leaving 15 of the 24. The plan's 07:00Z cut left hour 12
  // holding its 12:15 reading, so exactly 16 hours survived and the window was valid.
  for (const p of Object.keys(raw)) raw[p] = raw[p].filter((r) => Date.parse(r.end_utc) < Date.parse('2026-09-24T06:00:00Z') || Date.parse(r.end_utc) > Date.parse('2026-09-24T16:00:00Z'));
  const out = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z'));
  assert.equal(out.current.state, 'insufficient_data');
  assert.ok(out.current.reasons.includes('PM2.5 had 15 of 16 required hours'), out.current.reasons.join(' | '));
});

test('no station is its own state and carries no history', () => {
  const p = buildPayload('in/kolkata/baruipur', null, {}, new Date());
  assert.equal(p.current.state, 'no_station');
  assert.equal(p.history, null);
});

test('no raw data at all is unavailable, never zero', () => {
  const p = buildPayload(KEY, stationFor(KEY), { pm25: [], pm10: [], no2: [], so2: [], co: [], o3: [] }, new Date());
  assert.equal(p.current.state, 'unavailable');
});

/* ---- History anchoring (correction 4): 30 complete IST days ending yesterday relative to `now`. ---- */

test('a last reading ending exactly on an IST hour stays on its own IST day, and that day is valid', () => {
  // 17:30Z = 23:00 IST on 24 Sep; now = 00:00 IST on 25 Sep.
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:30:00Z'));
  const last = p.history.days.at(-1);
  assert.equal(last.date_ist, '2026-09-24');
  assert.equal(typeof last.aqi, 'number');
});

test('history ends yesterday in IST, never on the day still in progress', () => {
  // now = 12:30 IST on 24 Sep: 24 Sep is incomplete, so the last day is 23 Sep.
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T06:45:00Z'), new Date('2026-09-24T07:00:00Z'));
  assert.equal(p.history.days.length, 30);
  assert.equal(p.history.days.at(-1).date_ist, '2026-09-23');
  assert.equal(typeof p.history.days.at(-1).aqi, 'number');
});

test('days after the feed died are missing with reason "no readings", not a month ending when it died', () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-10-02T18:00:00Z'));
  const days = p.history.days;
  assert.equal(days.length, 30);
  assert.equal(days.at(-1).date_ist, '2026-10-01');
  for (const d of days.filter((x) => x.date_ist >= '2026-09-25')) {
    assert.deepEqual({ aqi: d.aqi, reason: d.reason }, { aqi: null, reason: 'no readings' }, d.date_ist);
  }
  assert.equal(typeof days.find((d) => d.date_ist === '2026-09-24').aqi, 'number');
});

/* ---- Freshness clock (corrections 1 and 2). ---- */

test('one malformed timestamp does not poison the freshness clock', () => {
  const raw = rawUpTo('2026-09-24T17:30:00Z');
  raw.pm25.push({ end_utc: 'garbage', value: 5 });
  const p = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:30:00Z'));
  assert.equal(p.current.state, 'live');
});

test('isStampedUtc accepts offset-bearing parseable stamps only', () => {
  assert.equal(isStampedUtc('2026-09-24T17:30:00Z'), true);
  assert.equal(isStampedUtc('2026-09-24T23:00:00+05:30'), true);
  assert.equal(isStampedUtc('2026-09-24T17:30:00'), false);
  assert.equal(isStampedUtc('garbage'), false);
  assert.equal(isStampedUtc('2026-13-45T99:00:00Z'), false);
});

test(`live is decided on exact milliseconds: ${LIVE_H} h is live, ${LIVE_H} h + 1 min is stale`, () => {
  const T = '2026-09-24T17:30:00Z';
  const raw = rawUpTo(T);
  assert.equal(buildPayload(KEY, stationFor(KEY), raw, at(T, LIVE_H * 3_600_000)).current.state, 'live');
  const s = buildPayload(KEY, stationFor(KEY), raw, at(T, LIVE_H * 3_600_000 + 60_000)).current;
  assert.equal(s.state, 'stale');
  assert.equal(s.age_h, LIVE_H);
});

/* ---- Stale and invalid (correction 3). ---- */

test('a stale window that fails CPCB validity is unavailable, not insufficient_data', () => {
  const p = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z', 10 / 24), at('2026-09-24T17:30:00Z', 30 * 3_600_000));
  assert.equal(p.current.state, 'unavailable');
  assert.equal(p.current.last_observed_at, '2026-09-24T17:30:00.000Z');
});
