/**
 * "Now" from the airport: station choice, staleness, the rain timeline, and the
 * reading the model receives. Fixture: 36 h of real VECC / VOBL / VOBG reports.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseMetar } from '../../src/lib/weather/metar.ts';
import {
  observedNow, rainEpisodes, rankStations, METAR_STALE_MIN, describeWeather,
} from '../../src/lib/weather/observed.ts';
import { METAR_STATIONS } from '../../src/data/metar-stations.ts';
import { CITIES } from '../../src/data/cities.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/metar/metar-20261007T0609Z.json'), 'utf8'));
const CAPTURE = Date.parse('2026-10-07T06:09:00Z');
const MIN = 60_000;
const reportsOf = (icao, upTo = CAPTURE) => RAW.filter(r => r.icaoId === icao)
  .map(r => parseMetar(r.rawOb, CAPTURE)).filter(m => m && Date.parse(m.time) <= upTo)
  .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
const ALL = { VECC: reportsOf('VECC'), VOBL: reportsOf('VOBL'), VOBG: reportsOf('VOBG') };

test('every Kolkata ward reads Dum Dum (VECC), labelled with its distance', () => {
  for (const w of CITIES.kolkata.wards) {
    const r = rankStations('kolkata', w.lat, w.lon);
    assert.equal(r[0].icao, 'VECC');
    assert.ok(r[0].km > 5 && r[0].km < 40, `${w.id} ${r[0].km}`);
  }
  const bg = rankStations('kolkata', 22.522704, 88.369173)[0];
  assert.equal(Math.round(bg.km), 16, 'Ballygunge to the VECC reference point is 16 km');
});

test('Bengaluru wards read the NEARER of Kempegowda (VOBL) and HAL (VOBG)', () => {
  const s = METAR_STATIONS.bengaluru.map(x => x.icao).sort();
  assert.deepEqual(s, ['VOBG', 'VOBL']);
  for (const w of CITIES.bengaluru.wards) {
    const r = rankStations('bengaluru', w.lat, w.lon);
    assert.equal(r.length, 2);
    assert.ok(r[0].km <= r[1].km);
    assert.equal(r[0].icao, 'VOBG', `${w.id}: HAL is ${r[0].km.toFixed(1)} km, Kempegowda ${r[1].km.toFixed(1)} km`);
  }
  // a point in the north of the city goes to Kempegowda: the choice is real, not fixed
  assert.equal(rankStations('bengaluru', 13.15, 77.62)[0].icao, 'VOBL');
});

test('a city with no station returns nothing to rank (met.no stays in charge)', () => {
  assert.deepEqual(rankStations('dubai', 25.2, 55.3), []);
});

test('the nearest FRESH report wins; stale or missing hands over', () => {
  const at = Date.parse('2026-10-07T06:05:00Z');
  const ranked = rankStations('bengaluru', 12.9784, 77.6408);
  assert.equal(observedNow(ALL, ranked, at).station.icao, 'VOBG');
  // HAL silent → Kempegowda
  assert.equal(observedNow({ ...ALL, VOBG: [] }, ranked, at).station.icao, 'VOBL');
  // both silent → null, which is the met.no fallback
  assert.equal(observedNow({ VOBG: [], VOBL: [] }, ranked, at), null);
  // stale: 90 minutes is the limit
  const vecc = [{ icao: 'VECC', km: 16 }];
  const last = Date.parse(ALL.VECC.at(-1).time);
  assert.ok(observedNow(ALL, vecc, last + METAR_STALE_MIN * MIN));
  assert.equal(observedNow(ALL, vecc, last + (METAR_STALE_MIN + 1) * MIN), null);
  assert.equal(METAR_STALE_MIN, 90);
  // a report from the future (clock skew, bad decode) is not "fresh" either
  assert.equal(observedNow(ALL, vecc, last - 30 * MIN).latest.time !== ALL.VECC.at(-1).time, true);
});

test('rain episodes: onset and end at the midpoint between reports', () => {
  const eps = rainEpisodes(ALL.VECC);
  const iso = (ms) => (ms === null ? null : new Date(ms).toISOString().replace('.000Z', 'Z'));
  const got = eps.map(e => [iso(e.startMs), iso(e.endMs)]);
  // 6 Oct: TS without rain at 1330, -TSRA from 1400, -RA to 1630, dry (HZ) at 1700
  assert.ok(got.some(([s, e]) => s === '2026-10-06T13:45:00Z' && e === '2026-10-06T16:45:00Z'), JSON.stringify(got));
  // 7 Oct: dry (HZ) at 0530, -RA at 0600 and still raining: onset 0545, ongoing
  assert.deepEqual(got.at(-1), ['2026-10-07T05:45:00Z', null]);
});

test('a trend forecast of rain is not a rain episode', () => {
  // 0530Z carried TEMPO 2000 RA and no observed rain
  const upTo0530 = reportsOf('VECC', Date.parse('2026-10-07T05:30:00Z'));
  assert.equal(rainEpisodes(upTo0530).some(e => e.endMs === null), false);
});

test('recent rain (RE) is an episode that has ended', () => {
  const ref = Date.parse('2026-10-07T08:00:00Z');
  const r = [
    parseMetar('METAR VECC 070630Z 05004KT 4000 HZ BKN020 30/25 Q1015', ref),
    parseMetar('METAR VECC 070700Z 05004KT 4000 HZ BKN020 29/25 Q1015 RERA', ref),
  ];
  const e = rainEpisodes(r);
  assert.equal(e.length, 1);
  assert.equal(e[0].endMs, Date.parse('2026-10-07T06:45:00Z'));
  assert.ok(e[0].startMs < e[0].endMs && e[0].startMs >= Date.parse('2026-10-07T06:30:00Z'));
});

test('VC weather is reported, never applied', () => {
  const ref = Date.parse('2026-10-07T08:00:00Z');
  const r = [
    parseMetar('METAR VECC 070630Z 05004KT 6000 FEW020CB 30/25 Q1015', ref),
    parseMetar('METAR VECC 070700Z 05004KT 6000 VCSH FEW020CB 30/25 Q1015', ref),
  ];
  const now = observedNow({ VECC: r }, [{ icao: 'VECC', km: 16 }], Date.parse('2026-10-07T07:05:00Z'));
  assert.equal(now.raining, false);
  assert.equal(now.ambient.observed.wet, 0);
  assert.deepEqual(now.vicinity, ['VCSH']);
  assert.match(describeWeather(now).text, /showers nearby/i);
});

test('the reading the model receives', () => {
  const at = Date.parse('2026-10-07T06:00:00Z');
  const now = observedNow(ALL, [{ icao: 'VECC', km: 16 }], at);
  const a = now.ambient;
  assert.equal(a.tAir, 31);
  // Magnus, from 31/23: ~62 %
  assert.ok(a.rh > 61 && a.rh < 63.5, `rh ${a.rh}`);
  assert.ok(Math.abs(a.wind - 4 * 0.514444) < 1e-6, 'knots → m/s');
  assert.equal(a.windFrom, 50);
  assert.equal(a.cloud, 75, 'BKN is the largest layer');
  assert.equal(a.validAt, '2026-10-07T06:00:00Z');
  assert.deepEqual({ ...a.observed, wet: Math.round(a.observed.wet * 1000) / 1000 },
    { stationCloud: true, convective: 'cumuliform', wet: Math.round((1 - Math.exp(-15 / 20)) * 1000) / 1000 });
  const d = describeWeather(now);
  assert.match(d.text, /light rain/i);
  assert.equal(d.icon, '🌧');
  assert.equal(d.iconLabel, 'Rain');
});

test('unknown cloud borrows met.no\'s figure, and says it is model cloud', () => {
  const ref = Date.parse('2026-10-07T08:00:00Z');
  const r = [parseMetar('METAR VOBL 070700Z AUTO 27005KT 9999 28/15 Q1012', ref)];
  const n = observedNow({ VOBL: r }, [{ icao: 'VOBL', km: 25 }], Date.parse('2026-10-07T07:10:00Z'), { cloudPct: 40 });
  assert.equal(n.ambient.cloud, 40);
  assert.equal(n.ambient.observed.stationCloud, false, 'K&C is fitted to observed oktas; a model fraction keeps the calibrated formula');
  const none = observedNow({ VOBL: r }, [{ icao: 'VOBL', km: 25 }], Date.parse('2026-10-07T07:10:00Z'));
  assert.equal(none.ambient.cloud, 0);
});

test('a report with no temperature cannot drive the model', () => {
  const ref = Date.parse('2026-10-07T08:00:00Z');
  const r = [parseMetar('METAR VECC 070700Z 05004KT 4000 HZ BKN020 Q1015', ref)];
  assert.equal(observedNow({ VECC: r }, [{ icao: 'VECC', km: 16 }], Date.parse('2026-10-07T07:05:00Z')), null);
});
