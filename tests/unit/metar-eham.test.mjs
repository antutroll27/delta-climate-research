/**
 * Amsterdam's "now": Schiphol (EHAM) METARs, REAL reports.
 *
 * Fixture: tests/fixtures/metar/metar-eham-20261107T1500Z.{json,txt} — 400 consecutive
 * reports (30 Oct 07:00Z to 7 Nov 15:00Z 2026) fetched from aviationweather.gov through
 * the same URL and User-Agent api/metar.ts uses. Public data (NOAA AWC).
 *
 * Why a second fixture: the first (tests/fixtures/metar) is Indian, and Europe writes the
 * same format differently — CAVOK, NOSIG/BECMG/TEMPO trends carrying precipitation,
 * wind-variation sectors, RVR groups, RE groups, M00 temperatures, BCFG/MIFG.
 * Each test below names the real report it stands on.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseMetar, cloudFraction, rainingAtStation, rainedRecently, thunderAtStation, convectiveCloud,
} from '../../src/lib/weather/metar.ts';
import {
  observedNow, rainEpisodes, rankStations, describeWeather, METAR_STALE_MIN, placeWords, fixed,
} from '../../src/lib/weather/observed.ts';
import { METAR_STATIONS, ALL_METAR_ICAO } from '../../src/data/metar-stations.ts';
import { CITIES } from '../../src/data/cities.ts';
import { wardTime, decodeRows } from '../../src/scripts/climate-engine/v2/weather-panel.ts';
import { handle } from '../../api/metar.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROWS = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/metar/metar-eham-20261107T1500Z.json'), 'utf8'));
const LINES = readFileSync(join(ROOT, 'tests/fixtures/metar/metar-eham-20261107T1500Z.txt'), 'utf8').split('\n').filter(Boolean);
const REF = Date.parse('2026-11-07T15:00:00Z');
const MIN = 60_000;

const real = (needle) => {
  const hit = LINES.filter((l) => l.includes(needle));
  assert.equal(hit.length, 1, `fixture must hold exactly one report containing ${JSON.stringify(needle)} (got ${hit.length})`);
  return hit[0];
};
const P = (needle) => parseMetar(real(needle), REF);

test('all 400 real Schiphol reports parse, with temperature, pressure and nothing unrecognised', () => {
  assert.equal(LINES.length, 400);
  for (const l of LINES) {
    const m = parseMetar(l, REF);
    assert.ok(m, `refused: ${l}`);
    assert.equal(m.station, 'EHAM');
    assert.ok(m.tempC !== null && m.dewC !== null, l);
    assert.ok(m.qnhHpa !== null && m.qnhHpa > 980 && m.qnhHpa < 1050, l);
    assert.deepEqual(m.unparsed, [], `a group nobody parses: ${l}`);
  }
});

test('every number agrees with the API\'s own decode (independent oracle)', () => {
  for (const r of ROWS) {
    const m = parseMetar(r.rawOb, REF);
    assert.equal(m.tempC, r.temp, r.rawOb);
    assert.equal(m.dewC, r.dewp, r.rawOb);
    assert.equal(m.qnhHpa, Math.round(r.altim), r.rawOb);
    // reportTime is the API's nominal hour (06:55Z files under 07:00Z); the obs time is DDHHMM in the report itself
    assert.ok(Math.abs(Date.parse(m.time) - Date.parse(r.reportTime)) <= 30 * MIN, r.rawOb);
  }
});

test('CAVOK: 10 km, no cloud that matters, clear sky and no weather', () => {
  const m = P('071355Z VRB02KT CAVOK');
  assert.equal(m.cavok, true);
  assert.equal(m.skyClear, true);
  assert.equal(m.visibilityM, 10000);
  assert.equal(cloudFraction(m), 0);
  assert.deepEqual(m.clouds, []);
  assert.equal(m.wind.dirDeg, null, 'VRB is variable');
  assert.equal(m.wind.speedKt, 2);
  assert.equal(m.tempC, 7);
  assert.equal(m.dewC, 4);
});

test('NOSIG ends the observation and is not an unknown group', () => {
  const m = P('071455Z 12004KT 9999 BKN035');
  assert.equal(m.tempC, 7);
  assert.equal(m.qnhHpa, 1022);
  assert.equal(cloudFraction(m), 6 / 8);
  assert.deepEqual(m.unparsed, []);
});

test('TEMPO trend with rain is a forecast, never an observation', () => {
  // dry now, "TEMPO 7000 -RADZ" (and with BKN015 after it)
  const a = P('030055Z 03011KT 350V080 9999 FEW015 SCT025 BKN027');
  assert.equal(a.weather.length, 0);
  assert.equal(rainingAtStation(a), false);
  assert.equal(cloudFraction(a), 6 / 8, 'cloud is the observed BKN027, not the trend\'s BKN015');
  assert.deepEqual(a.clouds.map((c) => c.baseFt), [1500, 2500, 2700]);
  // "TEMPO 7000 -SHRA FEW025TCU": neither the shower nor the towering cumulus is observed
  const b = P('021555Z 01008KT 320V060 9999 FEW019 SCT039');
  assert.equal(rainingAtStation(b), false);
  assert.equal(convectiveCloud(b), false);
  assert.equal(thunderAtStation(b), false);
  assert.deepEqual(b.weather, []);
});

test('BECMG trend ends the observation (NSC, then BECMG 8000)', () => {
  const m = P('070725Z 09003KT 7000 NSC 00/00');
  assert.equal(m.skyClear, true);
  assert.equal(m.visibilityM, 7000);
  assert.equal(cloudFraction(m), 0);
  assert.equal(m.tempC, 0);
  assert.deepEqual(m.unparsed, []);
});

test('Q group is hPa as written (and A-group stays inches)', () => {
  assert.equal(P('070725Z 09003KT 7000 NSC').qnhHpa, 1023);
  assert.equal(P('071455Z 12004KT 9999 BKN035').qnhHpa, 1022);
  assert.equal(P('311955Z 04002KT 2000').qnhHpa, 1033);
});

test('wind-variation sectors (110V190, 250V310) are skipped, not read as visibility or weather', () => {
  const a = P('071325Z 15003KT 110V190 CAVOK');
  assert.equal(a.wind.dirDeg, 150);
  assert.equal(a.cavok, true);
  assert.deepEqual(a.unparsed, []);
  const b = P('011425Z 29005KT 250V310 9999');
  assert.equal(b.wind.dirDeg, 290);
  assert.equal(b.visibilityM, 10000);
  assert.deepEqual(b.unparsed, []);
});

test('gusts: 07015G25KT', () => {
  const m = P('041525Z 07015G25KT 030V090 9999 FEW022');
  assert.deepEqual(m.wind, { dirDeg: 70, speedKt: 15, gustKt: 25 });
});

test('light drizzle and rain together (-DZRA) is rain at the station; its TEMPO is not', () => {
  const m = P('030455Z 04011KT 010V070 9999 -DZRA SCT008 SCT010 BKN024');
  assert.deepEqual(m.weather.map((w) => [w.intensity, w.phenomena]), [['light', ['DZ', 'RA']]]);
  assert.equal(rainingAtStation(m), true);
  assert.equal(cloudFraction(m), 6 / 8);
  assert.equal(m.tempC, 9);
});

test('RE group (REDZ) after Q is recent weather, and TEMPO after it is still ignored', () => {
  const m = P('020155Z VRB02KT 3500 -DZRA FEW001 SCT004 BKN022');
  assert.equal(rainingAtStation(m), true);
  assert.equal(rainedRecently(m), true);
  assert.deepEqual(m.recent.map((w) => w.raw), ['REDZ']);
  assert.deepEqual(m.unparsed, []);
});

test('RVR groups, BCFG and BR (fog at 1.8 km) parse; RVR is not mistaken for visibility', () => {
  const m = P('312055Z 36002KT 1800 R18C/1200U');
  assert.equal(m.visibilityM, 1800);
  assert.deepEqual(m.weather.map((w) => [w.descriptor, w.phenomena]), [['BC', ['FG']], [null, ['BR']]]);
  assert.equal(rainingAtStation(m), false);
  assert.equal(m.skyClear, true);
  assert.deepEqual(m.unparsed, []);
});

test('directional minimum visibility (0600NW) is skipped', () => {
  const m = P('010155Z 06003KT 010V110 9999 0600NW');
  assert.equal(m.visibilityM, 10000);
  assert.deepEqual(m.unparsed, []);
});

test('M00 is zero, not negative zero (it would print as "-0")', () => {
  const a = P('070625Z 08004KT 7000 NSC M00/M01');
  assert.ok(Object.is(a.tempC, 0), `tempC ${Object.is(a.tempC, -0) ? '-0' : a.tempC}`);
  assert.equal(a.dewC, -1);
  const b = P('070455Z 08005KT 8000 MIFG NSC M00/M00');
  assert.ok(Object.is(b.tempC, 0) && Object.is(b.dewC, 0));
  assert.equal(`${b.tempC.toLocaleString('en-GB')}`, '0');
  for (const l of LINES) {
    const m = parseMetar(l, REF);
    assert.ok(!Object.is(m.tempC, -0) && !Object.is(m.dewC, -0), l);
  }
});

test('COR (a corrected report) keeps the station and time', () => {
  const m = P('061425Z COR 07007KT CAVOK');
  assert.equal(m.corrected, true);
  assert.equal(m.station, 'EHAM');
  assert.equal(m.time, '2026-11-06T14:25:00Z');
});

test('the Dutch METAR clock: DDHHMMZ resolves across the month boundary (31 Oct report read on 7 Nov, 1 Nov one too)', () => {
  assert.equal(P('312055Z 36002KT').time, '2026-10-31T20:55:00Z');
  assert.equal(P('011425Z 29005KT').time, '2026-11-01T14:25:00Z');
});

// ---- the station and the city ---------------------------------------------------

test('Amsterdam reads Schiphol, 8.4 km from the Canal Ring centre', () => {
  assert.deepEqual(METAR_STATIONS.amsterdam.map((s) => s.icao), ['EHAM']);
  assert.ok(ALL_METAR_ICAO.includes('EHAM'));
  const w = CITIES.amsterdam.wards[0];
  const [r] = rankStations('amsterdam', w.lat, w.lon);
  assert.equal(r.icao, 'EHAM');
  assert.equal(r.km.toFixed(1), '8.4');
});

test('the station record is the one aviationweather.gov files the reports against', () => {
  const s = METAR_STATIONS.amsterdam[0];
  assert.equal(s.lat, ROWS[0].lat);
  assert.equal(s.lon, ROWS[0].lon);
});

test('Kolkata and Bengaluru keep exactly the stations they had', () => {
  assert.deepEqual(METAR_STATIONS.kolkata.map((s) => s.icao), ['VECC']);
  assert.deepEqual(METAR_STATIONS.bengaluru.map((s) => s.icao), ['VOBL', 'VOBG']);
  assert.deepEqual([...ALL_METAR_ICAO], ['EHAM', 'VECC', 'VOBG', 'VOBL']);
});

const reportsUpTo = (iso) => ROWS.map((r) => parseMetar(r.rawOb, REF))
  .filter((m) => Date.parse(m.time) <= Date.parse(iso)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
const wardAt = () => CITIES.amsterdam.wards[0];
const rankedAms = () => rankStations('amsterdam', wardAt().lat, wardAt().lon);

test('"now" at 14:58Z on 7 Nov is the 14:55Z report: 7 degrees, 4 degrees dew point, 4 kt from 120', () => {
  const nowMs = Date.parse('2026-11-07T14:58:00Z');
  const o = observedNow({ EHAM: reportsUpTo('2026-11-07T14:58:00Z') }, rankedAms(), nowMs, {});
  assert.ok(o);
  assert.equal(o.station.name, 'Schiphol airport');
  assert.equal(o.ageMin, 3);
  assert.equal(o.ambient.tAir, 7);
  assert.ok(Math.abs(o.ambient.rh - 81.2) < 0.5, `rh ${o.ambient.rh}`);
  assert.ok(Math.abs(o.ambient.wind - 4 * 0.514444) < 1e-9);
  assert.equal(o.ambient.windFrom, 120);
  assert.equal(o.cloud, 6 / 8);
  assert.equal(o.ambient.cloud, 75);
  assert.equal(o.ambient.observed.wet, 0);
  assert.equal(describeWeather(o).text, 'Mostly cloudy');
  assert.equal(o.vicinity.length, 0);
});

test('CAVOK reads as a clear sky, 0 cloud', () => {
  const nowMs = Date.parse('2026-11-07T13:58:00Z');
  const o = observedNow({ EHAM: reportsUpTo('2026-11-07T13:58:00Z') }, rankedAms(), nowMs, {});
  assert.equal(o.cloud, 0);
  assert.equal(o.ambient.cloud, 0);
  assert.equal(describeWeather(o).text, 'Clear');
});

test('stale after 90 minutes: Schiphol hands "now" back to met.no', () => {
  const last = Date.parse('2026-11-07T14:55:00Z');
  const reports = reportsUpTo('2026-11-07T15:00:00Z');
  assert.equal(observedNow({ EHAM: reports }, rankedAms(), last + (METAR_STALE_MIN - 1) * MIN, {}) !== null, true);
  assert.equal(observedNow({ EHAM: reports }, rankedAms(), last + (METAR_STALE_MIN + 1) * MIN, {}), null);
});

test('the 3 Nov morning drizzle: wet at 04:55Z, onset between the 03:55Z and 04:25Z reports\' midpoints, "light rain"', () => {
  const nowMs = Date.parse('2026-11-03T04:58:00Z');
  const reports = reportsUpTo('2026-11-03T04:58:00Z');
  const o = observedNow({ EHAM: reports }, rankedAms(), nowMs, {});
  assert.equal(o.raining, true);
  assert.ok(o.ambient.observed.wet > 0.9, `wet ${o.ambient.observed.wet}`);
  assert.equal(describeWeather(o).text, 'Light rain');
  assert.equal(describeWeather(o).effect, 'surfaces cooling');
  const eps = rainEpisodes(reports);
  assert.ok(eps.length >= 1);
  assert.ok(eps.every((e) => e.startMs < nowMs));
});

test('fog is said as fog (30 Oct 08:25Z, FG BKN001, 900 m), and shallow BCFG/MIFG patches are not', () => {
  const at = '2026-10-30T08:27:00Z';
  const o = observedNow({ EHAM: reportsUpTo(at) }, rankedAms(), Date.parse(at), {});
  assert.equal(describeWeather(o).text, 'Fog');
  const at2 = '2026-10-31T20:58:00Z';
  const p = observedNow({ EHAM: reportsUpTo(at2) }, rankedAms(), Date.parse(at2), {});
  assert.notEqual(describeWeather(p).text, 'Fog', 'BCFG BR at 1.8 km: patches, mist');
});

test('snow and hail are named (a real 7 Nov report with its weather group swapped; no snow fell in the capture window)', () => {
  const base = real('071455Z 12004KT 9999 BKN035').replace('9999 BKN035', '-SN BKN035');
  const m = parseMetar(base, REF);
  assert.deepEqual(m.weather.map((w) => w.phenomena), [['SN']]);
  const at = Date.parse('2026-11-07T14:58:00Z');
  const o = observedNow({ EHAM: [m] }, rankedAms(), at, {});
  assert.equal(describeWeather(o).text, 'Light snow');
  assert.equal(o.raining, false, 'snow does not wet the surface the way rain does');
  assert.equal(o.ambient.observed.wet, 0);
  const h = parseMetar(base.replace('-SN', 'GR'), REF);
  assert.equal(describeWeather(observedNow({ EHAM: [h] }, rankedAms(), at, {})).text, 'Moderate hail');
});

const word = (raw, ranked = rankedAms(), icao = 'EHAM') => {
  const m = parseMetar(raw, REF);
  return describeWeather(observedNow({ [icao]: [m] }, ranked, Date.parse(m.time) + 3 * MIN, {}));
};
const BASE = 'METAR EHAM 071455Z 12004KT 9999 BKN035 07/04 Q1022 NOSIG';

test('VC groups are named for what they are: only VCSH is showers (VCFG fog, others plain weather, VCTS thunderstorm)', () => {
  assert.equal(word(BASE.replace('9999 BKN035', '9999 VCSH BKN035')).text, 'Mostly cloudy · showers nearby');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 VCFG BKN035')).text, 'Mostly cloudy · fog nearby');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 VCTS BKN035')).text, 'Mostly cloudy · thunderstorm nearby');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 VCSS BKN035')).text, 'Mostly cloudy · weather nearby');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 -SN VCFG BKN035')).text, 'Light snow · fog nearby');
});

test('blowing and drifting snow are not snowfall; falling snow is; ice pellets and small hail say what they are', () => {
  for (const g of ['BLSN', 'DRSN', '-BLSN']) assert.equal(word(BASE.replace('9999 BKN035', `9999 ${g} BKN035`)).text, 'Mostly cloudy', g);
  assert.equal(word(BASE.replace('9999 BKN035', '9999 -SHSN BKN035')).text, 'Light snow');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 SG BKN035')).text, 'Moderate snow');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 PL BKN035')).text, 'Moderate ice pellets');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 GS BKN035')).text, 'Moderate small hail');
  assert.equal(word(BASE.replace('9999 BKN035', '9999 GR BKN035')).text, 'Moderate hail');
});

test('no "surfaces drying" note while snow or fog is the weather', () => {
  const rainy = ROWS.map((r) => parseMetar(r.rawOb, REF)).filter((m) => Date.parse(m.time) <= Date.parse('2026-11-03T05:30:00Z'));
  const dry = parseMetar(BASE.replace('071455Z', '030525Z').replace('9999 BKN035', '9999 -SN BKN035'), REF);
  const at = Date.parse('2026-11-03T05:30:00Z');
  const o = observedNow({ EHAM: [...rainy.filter((m) => Date.parse(m.time) < Date.parse(dry.time)), dry] }, rankedAms(), at, {});
  assert.ok(o.ambient.observed.wet > 0.05, 'the surface is still wet from the morning rain');
  assert.equal(describeWeather(o).text, 'Light snow');
  assert.equal(describeWeather(o).effect, '');
});

test('shallow, patchy and partial fog (MIFG, BCFG, PRFG) keep the sky words; FG and FZFG are fog', () => {
  for (const g of ['MIFG', 'BCFG', 'PRFG']) assert.notEqual(word(BASE.replace('9999 BKN035', `0800 ${g} BKN035`)).text, 'Fog', g);
  for (const g of ['FG', 'FZFG']) assert.equal(word(BASE.replace('9999 BKN035', `0400 ${g} BKN035`)).text, 'Fog', g);
});

test('Kolkata: a fog report now reads Fog (intended), mist and haze keep the sky words (real VECC reports)', () => {
  const ranked = rankStations('kolkata', 22.5227, 88.3692);
  const hz = 'METAR VECC 070530Z 06004KT 3200 HZ SCT020 FEW025CB BKN100 32/26 Q1015 TEMPO 2000 RA';
  assert.equal(word(hz, ranked, 'VECC').text, 'Mostly cloudy, storm clouds');
  const br = 'METAR VECC 070300Z 11004KT 2400 BR FEW100 30/27 Q1016 NOSIG';
  assert.equal(word(br, ranked, 'VECC').text, 'A few clouds');
  // the fixture holds no FG at Dum Dum: this one is SYNTHETIC (a VECC-shaped fog report with the vertical visibility a Kolkata winter dawn gives)
  const fg = 'METAR VECC 070530Z 06004KT 0600 FG VV001 32/26 Q1015 NOSIG';
  assert.equal(word(fg, ranked, 'VECC').text, 'Fog');
});

test('the area\'s own noun: Kolkata and Bengaluru keep "the ward", Amsterdam names the Canal Ring', () => {
  assert.deepEqual(placeWords('kolkata', 'Ballygunge'), { centre: 'the ward', over: 'the ward' });
  assert.deepEqual(placeWords('bengaluru', 'Indiranagar'), { centre: 'the ward', over: 'the ward' });
  assert.deepEqual(placeWords('amsterdam', 'Canal Ring'), { centre: 'the Canal Ring centre', over: 'the Canal Ring' });
});

test('a reading just below zero prints 0, never -0', () => {
  assert.equal(fixed(-0.4, 0), '0');
  assert.equal(fixed(-0.04, 1), '0.0');
  assert.equal(fixed(-0.6, 0), '-1');
  assert.equal(fixed(-1.2, 1), '-1.2');
  assert.equal(fixed(7, 0), '7');
});

// ---- the page clock --------------------------------------------------------------

test('Amsterdam times are CET in winter and CEST in summer, and the DST edges are right', () => {
  assert.equal(wardTime('2026-11-07T14:55:00Z', 'Europe/Amsterdam'), '15:55 CET');
  assert.equal(wardTime('2026-07-07T14:55:00Z', 'Europe/Amsterdam'), '16:55 CEST');
  // 2026 spring forward: Sun 29 Mar, 01:00Z; autumn back: Sun 25 Oct, 01:00Z
  assert.equal(wardTime('2026-03-29T00:55:00Z', 'Europe/Amsterdam'), '01:55 CET');
  assert.equal(wardTime('2026-03-29T01:05:00Z', 'Europe/Amsterdam'), '03:05 CEST');
  assert.equal(wardTime('2026-10-25T00:55:00Z', 'Europe/Amsterdam'), '02:55 CEST');
  assert.equal(wardTime('2026-10-25T01:05:00Z', 'Europe/Amsterdam'), '02:05 CET');
});

test('the decoded-report card shows UTC and the ward clock side by side for Schiphol', () => {
  const rows = decodeRows(P('071455Z 12004KT 9999 BKN035'), 'Europe/Amsterdam');
  assert.deepEqual(rows.find((r) => r.code === '071455Z'), { code: '071455Z', text: 'observed 14:55 UTC = 15:55 CET' });
  assert.deepEqual(rows.find((r) => r.code.startsWith('120')), { code: '12004KT', text: 'wind from 120° at 4 knots' });
  assert.ok(rows.some((r) => r.code === 'Q1022' && r.text === 'sea-level pressure 1022 hPa'));
  assert.ok(!rows.some((r) => r.text.includes('not recognised')));
});

test('the city declares Europe/Amsterdam (sun and night follow lon/lat and UTC, the label follows this)', () => {
  assert.equal(CITIES.amsterdam.name, 'Amsterdam');
});

// ---- the proxy -------------------------------------------------------------------

const res = () => { const r = { code: 0, headers: {}, body: null, status(c) { r.code = c; return r; }, setHeader(k, v) { r.headers[k] = v; }, json(b) { r.body = b; } }; return r; };

test('/api/metar?ids=EHAM is accepted, asked upstream with the generic User-Agent, and returns parseable raw reports', async () => {
  let asked = null, ua = null;
  const r = res();
  await handle({ method: 'GET', query: { ids: 'EHAM' } }, r, {
    now: () => new Date('2026-11-07T15:00:00Z'),
    fetch: async (u, init) => {
      asked = String(u); ua = init?.headers?.['User-Agent'];
      return new Response(JSON.stringify(ROWS), { status: 200 });
    },
  });
  assert.equal(r.code, 200);
  assert.match(asked, /ids=EHAM&format=json&hours=4/);
  assert.equal(ua, 'delta-climate-research/1.0 (+https://deltaclimate.earth)');
  assert.ok(!/@/.test(ua), 'no mailbox in the User-Agent');
  assert.ok(r.body.reports.length > 0 && r.body.reports.every((x) => x.icao === 'EHAM'));
  for (const x of r.body.reports) assert.ok(parseMetar(x.raw, Date.parse(r.body.fetchedAt)), x.raw);
});

test('the proxy still refuses a mixed or unsorted station list', async () => {
  for (const ids of ['VECC,EHAM', 'EHAM,EHAM', 'eham', 'EHRD']) {
    const r = res();
    await handle({ method: 'GET', query: { ids } }, r, { fetch: async () => { throw new Error('must not fetch'); } });
    assert.equal(r.code, 400, ids);
  }
});
