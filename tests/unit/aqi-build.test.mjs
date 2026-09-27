// tests/unit/aqi-build.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPayload, LIVE_H, STALE_DAYS } from '../../src/lib/aqi/build.ts';
import { isStampedUtc } from '../../src/lib/aqi/hours.ts';
import { stationFor } from '../../src/lib/aqi/stations.ts';
import { subIndex } from '../../src/lib/aqi/cpcb.ts';

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
/** Like rawUpTo, but each value is fn(pollutant, istDate 'YYYY-MM-DD', istHour) of the IST hour the reading closes within. */
function series(lastEnd, fn, days = 31) {
  const end = Date.parse(lastEnd), out = {};
  for (const p of ['pm25', 'pm10', 'no2', 'so2', 'co', 'o3']) {
    out[p] = [];
    for (let t = end - days * 86_400_000; t <= end; t += 900_000) {
      const startIst = new Date(t + 5.5 * 3_600_000 - 900_000);
      out[p].push({ end_utc: new Date(t).toISOString(), value: fn(p, startIst.toISOString().slice(0, 10), startIst.getUTCHours()) });
    }
  }
  return out;
}
const flat = (p) => (p === 'co' ? 0.5 : 20);
const pol = (cur, p) => cur.result.pollutants.find((q) => q.parameter === p);
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

test('zero readings do not count as fresh: CPCB treats 0 as missing', () => {
  const T = '2026-09-24T17:30:00Z';
  const raw = rawUpTo(T);
  for (const p of Object.keys(raw)) {
    for (let t = Date.parse(T) + 900_000; t <= Date.parse(T) + 3 * 3_600_000; t += 900_000) raw[p].push({ end_utc: new Date(t).toISOString(), value: 0 });
  }
  const c = buildPayload(KEY, stationFor(KEY), raw, at(T, 3 * 3_600_000)).current;
  assert.equal(c.state, 'stale');
  assert.equal(c.observed_at, '2026-09-24T17:30:00.000Z');
});

/* ---- Review round: pin day windows, nulls, units and freshness bounds. ---- */

test('each history day is exactly IST 00:00-24:00 of that date, and "today" is the IST date', () => {
  // PM2.5 = 10 + 10*(IST hour) + 1000*(IST date odd); everything else flat, so PM2.5 dominates.
  const raw = series('2026-09-24T18:30:00Z', (p, d, h) => (p === 'pm25' ? 10 + 10 * h + 1000 * (Number(d.slice(8)) % 2) : flat(p)));
  const days = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:31:00Z')).history.days;
  // Mean of 10+10h over h = 0..23 is 125 (even day) and 1125 (odd day).
  const even = subIndex('pm25', 125), odd = subIndex('pm25', 1125);
  assert.deepEqual([even, odd], [304, 1073]); // 300+100*(125-120)/130 = 303.85; 400+100*(1125-250)/130 = 1073.08
  assert.equal(days.find((d) => d.date_ist === '2026-09-24')?.aqi, even);
  assert.equal(days.find((d) => d.date_ist === '2026-09-23')?.aqi, odd);
});

test('the current window closes at the end of the last reading\'s IST hour, in +05:30', () => {
  // IST hour 22 on 24 Sep = readings ending 16:45..17:30Z.
  const raw = series('2026-09-24T17:30:00Z', (p, d, h) => (p === 'pm25' && d === '2026-09-24' && h === 22 ? 500 : flat(p)));
  const p = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z'));
  assert.equal(p.current.state, 'live');
  assert.equal(p.current.result.window_end_ist, '2026-09-24T23:00:00+05:30');
  assert.equal(pol(p.current, 'pm25').value, (23 * 20 + 500) / 24);
  assert.deepEqual(p.history.pm25_24h.at(-1), { hour_ist: '2026-09-24T22:00:00+05:30', value: 500 });
});

test('a pollutant with no rows in the window is null, 0 hours, no sub-index; the AQI still publishes', () => {
  const raw = rawUpTo('2026-09-24T17:30:00Z');
  raw.o3 = raw.o3.filter((r) => Date.parse(r.end_utc) <= Date.parse('2026-09-23T17:30:00Z'));
  const c = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z')).current;
  assert.equal(c.state, 'live');
  assert.deepEqual((({ value, hours_present, sub_index }) => ({ value, hours_present, sub_index }))(pol(c, 'o3')), { value: null, hours_present: 0, sub_index: null });
});

test('a missing PM2.5 hour is null in pm25_24h, never 0', () => {
  const raw = series('2026-09-24T17:30:00Z', (p, d, h) => (p === 'pm25' && d === '2026-09-24' && h === 15 ? -1 : flat(p)));
  raw.pm25 = raw.pm25.filter((r) => r.value !== -1);
  const h = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z')).history.pm25_24h;
  assert.deepEqual(h.find((x) => x.hour_ist === '2026-09-24T15:00:00+05:30'), { hour_ist: '2026-09-24T15:00:00+05:30', value: null });
});

test('CO carries its verified unit, mg/m3, and its value unscaled', () => {
  const co = pol(buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z')).current, 'co');
  assert.equal(co.unit, 'mg_m3');
  assert.equal(co.value, 0.5);
});

test(`${STALE_DAYS} days old is still stale; one minute more is unavailable`, () => {
  const T = '2026-09-24T17:30:00Z', raw = rawUpTo(T), D = STALE_DAYS * 86_400_000;
  assert.equal(buildPayload(KEY, stationFor(KEY), raw, at(T, D)).current.state, 'stale');
  assert.equal(buildPayload(KEY, stationFor(KEY), raw, at(T, D + 60_000)).current.state, 'unavailable');
});

test('CO is the maximum rolling 8-hour mean, over an 8-hour window', () => {
  const raw = series('2026-09-24T17:30:00Z', (p, d, h) => (p === 'co' ? (d === '2026-09-24' && h >= 10 && h <= 17 ? 5 : 0.5) : flat(p)));
  const co = pol(buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z')).current, 'co');
  assert.equal(co.value, 5);
  assert.equal(co.window_h, 8);
});

test('a row stamped in the future is dropped: it neither freshens nor enters a window', () => {
  const raw = rawUpTo('2026-09-24T17:30:00Z');
  raw.so2.push({ end_utc: '2099-01-01T00:00:00Z', value: 20 });
  const c = buildPayload(KEY, stationFor(KEY), raw, new Date('2026-09-24T18:00:00Z')).current;
  assert.equal(c.state, 'live');
  assert.equal(c.observed_at, '2026-09-24T17:30:00.000Z');
});

test('source.owner comes from the station entry', () => {
  const st = { ...stationFor(KEY), owner: 'X' };
  assert.equal(buildPayload(KEY, st, rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:00:00Z')).current.source.owner, 'X');
  /* No station, so nobody measured anything: the owner is null, not a board that has no monitor here. */
  assert.equal(buildPayload('in/kolkata/baruipur', null, {}, new Date()).current.source.owner, null);
});

/* ---- Audit I1: every unavailable says why. ---- */

test(`a feed quiet for more than ${STALE_DAYS} days is unavailable with reason feed_quiet`, () => {
  const c = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-10-02T18:00:00Z')).current;
  assert.equal(c.state, 'unavailable');
  assert.equal(c.reason, 'feed_quiet');
  assert.equal(c.last_observed_at, '2026-09-24T17:30:00.000Z');
});

test('no readings at all in the 31-day window is feed_quiet', () => {
  const c = buildPayload(KEY, stationFor(KEY), { pm25: [], pm10: [], no2: [], so2: [], co: [], o3: [] }, new Date()).current;
  assert.equal(c.reason, 'feed_quiet');
  assert.equal(c.last_observed_at, null);
});

test('stale and failing CPCB validity is unavailable with reason no_valid_aqi', () => {
  const c = buildPayload(KEY, stationFor(KEY), rawUpTo('2026-09-24T17:30:00Z', 10 / 24), at('2026-09-24T17:30:00Z', 30 * 3_600_000)).current;
  assert.equal(c.state, 'unavailable');
  assert.equal(c.reason, 'no_valid_aqi');
});

test('the builder marks its own results origin obos, schema 2', () => {
  const p = buildPayload('in/kolkata/ballygunge', stationFor('in/kolkata/ballygunge'), rawUpTo('2026-09-24T17:30:00Z'), new Date('2026-09-24T18:30:00Z'));
  assert.equal(p.current.schema, 2);
  assert.equal(p.current.result.origin, 'obos');
  assert.equal(p.history.schema, 2);
});
