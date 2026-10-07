/**
 * The METAR parser, against REAL reports.
 *
 * Fixture: tests/fixtures/metar/metar-20261007T0609Z.{txt,json} — 36 h of VECC,
 * VOBL and VOBG from aviationweather.gov, captured 2026-10-07 06:09Z, the morning
 * OBOS showed a 46.7 °C surface in the rain. Public data. The .json is the API's
 * own decode, used here as an independent oracle for the numbers it carries.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  parseMetar, cloudFraction, rainingAtStation, thunderAtStation, convectiveCloud,
  vicinityWeather, COVER_FRACTION,
} from '../../src/lib/weather/metar.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/fixtures/metar');
const LINES = readFileSync(join(FIX, 'metar-20261007T0609Z.txt'), 'utf8').split('\n').filter(Boolean);
const JSONROWS = JSON.parse(readFileSync(join(FIX, 'metar-20261007T0609Z.json'), 'utf8'));
const REF = Date.parse('2026-10-07T06:09:00Z');

test('every real report parses, and none throws', () => {
  assert.equal(LINES.length, 216);
  for (const l of LINES) {
    const m = parseMetar(l, REF);
    assert.ok(m, `refused: ${l}`);
    assert.match(m.station, /^V(ECC|OBL|OBG)$/);
  }
});

test('the numbers agree with aviationweather.gov\'s own decode, report for report', () => {
  let n = 0;
  for (const row of JSONROWS) {
    const m = parseMetar(row.rawOb, REF);
    assert.ok(m, row.rawOb);
    assert.equal(Date.parse(m.time), row.obsTime * 1000, `time: ${row.rawOb}`);
    if (typeof row.temp === 'number') assert.equal(m.tempC, row.temp, `temp: ${row.rawOb}`);
    if (typeof row.dewp === 'number') assert.equal(m.dewC, row.dewp, `dew: ${row.rawOb}`);
    if (typeof row.wspd === 'number') assert.equal(m.wind?.speedKt, row.wspd, `wind: ${row.rawOb}`);
    if (typeof row.wdir === 'number') assert.equal(m.wind?.dirDeg, row.wdir, `dir: ${row.rawOb}`);
    if (row.wdir === 'VRB') assert.equal(m.wind?.dirDeg, null);
    // cloud layers: same covers, same bases (the JSON drops the CB/TCU suffix)
    assert.deepEqual(m.clouds.map(c => [c.cover, c.baseFt]),
      (row.clouds ?? []).map(c => [c.cover, c.base]), `clouds: ${row.rawOb}`);
    n++;
  }
  assert.ok(n >= 200);
});

test('today\'s report: light rain, a cumulonimbus, 31/23', () => {
  const m = parseMetar('METAR VECC 070600Z 05004KT 3200 -RA SCT018 FEW025CB BKN100 31/23 Q1015 TEMPO FM0610 2000 TSRA', REF);
  assert.equal(m.time, '2026-10-07T06:00:00Z');
  assert.equal(m.tempC, 31); assert.equal(m.dewC, 23);
  assert.equal(m.visibilityM, 3200);
  assert.deepEqual(m.weather.map(w => [w.intensity, w.descriptor, w.phenomena.join('')]), [['light', null, 'RA']]);
  assert.deepEqual(m.clouds.map(c => c.convective), [null, 'CB', null]);
  assert.equal(rainingAtStation(m), true);
  assert.equal(thunderAtStation(m), false, 'TSRA here is in the TEMPO trend, a forecast, not an observation');
  assert.equal(convectiveCloud(m), true);
  assert.equal(cloudFraction(m), COVER_FRACTION.BKN);
  assert.equal(m.qnhHpa, 1015);
});

test('a trend group never becomes present weather — including the corrupted "TEMP"', () => {
  // 0530Z: no rain observed, rain only FORECAST (TEMPO 2000 RA)
  const a = parseMetar('METAR VECC 070530Z 06004KT 3200 HZ SCT020 FEW025CB BKN100 32/26 Q1015 TEMPO 2000 RA', REF);
  assert.equal(rainingAtStation(a), false);
  // VOBG wrote TEMPO as "TEMP" on 5 Oct; the TSRA after it is still a forecast
  const b = parseMetar('METAR VOBG 052100Z VRB02KT 4000 -TSRA SCT012 FEW025CB BKN080 22/18 Q1020 TEMP 2000 TSRA', REF);
  assert.equal(b.weather.length, 1, 'only the observed -TSRA, not the trend TSRA');
  assert.equal(b.weather[0].intensity, 'light');
  // and a NOSIG broken across two tokens is just noise
  const c = parseMetar('METAR VECC 061300Z 00000KT 3000 HZ SCT020 26/25 Q1014 N OSIG', REF);
  assert.ok(c); assert.equal(rainingAtStation(c), false);
});

test('intensity, descriptors and several groups', () => {
  const heavy = parseMetar('METAR VOBG 052000Z 06003KT 2000 R/27/2000 +TSRA SCT012 FEW025CB BKN080 22/20 Q1019', REF);
  assert.equal(heavy.weather[0].intensity, 'heavy');
  assert.equal(heavy.weather[0].descriptor, 'TS');
  assert.equal(rainingAtStation(heavy), true); assert.equal(thunderAtStation(heavy), true);
  const two = parseMetar('METAR VOBL 051830Z 12008KT 5000 -TSRA DZ FEW010 SCT012 FEW025CB BKN080 21/20 Q1019 NOSIG', REF);
  assert.equal(two.weather.length, 2);
  assert.equal(two.weather[1].phenomena[0], 'DZ'); assert.equal(two.weather[1].intensity, 'moderate');
  const dz = parseMetar('METAR VOBG 061230Z 10008KT 6000 -DZ SCT012 SCT018 23/21 Q1017 NOSIG', REF);
  assert.equal(rainingAtStation(dz), true, 'drizzle wets a surface too');
  const ts = parseMetar('METAR VOBL 051900Z 13008KT 6000 -TS SCT012 FEW025CB SCT080 21/21 Q1018 NOSIG', REF);
  assert.equal(rainingAtStation(ts), false, 'thunder without precipitation is not rain');
  assert.equal(thunderAtStation(ts), true);
  const sh = parseMetar('METAR VECC 071200Z 18005KT 4000 SHRA FEW020TCU 29/25 Q1010', REF);
  assert.equal(sh.weather[0].descriptor, 'SH'); assert.equal(rainingAtStation(sh), true);
  assert.equal(convectiveCloud(sh), true);
});

test('VC is the vicinity: noted, never rain at the station', () => {
  const m = parseMetar('METAR VECC 071200Z 18005KT 6000 VCSH VCTS FEW020CB 30/25 Q1010', REF);
  assert.equal(rainingAtStation(m), false);
  assert.equal(thunderAtStation(m), false);
  assert.deepEqual(vicinityWeather(m).map(w => w.raw), ['VCSH', 'VCTS']);
  // precipitation written WITH a VC prefix (non-standard, seen in the wild) is still not here
  const vcra = parseMetar('METAR VECC 071200Z 18005KT 6000 VCSHRA BKN020CB 30/25 Q1010', REF);
  assert.equal(vcra.weather[0].vicinity, true);
  assert.deepEqual(vcra.weather[0].phenomena, ['RA']);
  assert.equal(rainingAtStation(vcra), false, 'rain in the vicinity is not rain at the station');
});

test('CAVOK, NSC, NCD, SKC, CLR all mean no cloud that matters', () => {
  for (const s of ['CAVOK', 'NSC', 'NCD', 'SKC', 'CLR']) {
    const m = parseMetar(`METAR VOBL 071200Z 27005KT ${s === 'CAVOK' ? '' : '9999 '}${s} 30/12 Q1012`, REF);
    assert.equal(cloudFraction(m), 0, s);
  }
  const cavok = parseMetar('METAR VOBL 071200Z 27005KT CAVOK 30/12 Q1012', REF);
  assert.equal(cavok.cavok, true); assert.equal(cavok.visibilityM, 10000);
  const nothing = parseMetar('METAR VOBL 071200Z AUTO 27005KT 9999 30/12 Q1012', REF);
  assert.equal(nothing.auto, true);
  assert.equal(cloudFraction(nothing), null, 'no cloud group at all is UNKNOWN, not clear');
  const vv = parseMetar('METAR VECC 070100Z 00000KT 0100 FG VV001 24/24 Q1015', REF);
  assert.equal(cloudFraction(vv), 1, 'an obscured sky passes no direct sun');
});

test('minus temperatures, missing dew point, gusts, MPS, statute miles, COR', () => {
  const m = parseMetar('SPECI UUEE 070600Z COR 27012G25MPS 1/2SM -SN BKN008 M05/M07 Q1002', REF);
  assert.equal(m.type, 'SPECI'); assert.equal(m.corrected, true);
  assert.equal(m.tempC, -5); assert.equal(m.dewC, -7);
  assert.equal(m.wind.gustKt !== null && m.wind.gustKt > 40, true, 'MPS is converted to knots');
  assert.ok(Math.abs(m.visibilityM - 805) < 2);
  const nodew = parseMetar('METAR VECC 070600Z 05004KT 3200 HZ 31/ Q1015', REF);
  assert.equal(nodew.tempC, 31); assert.equal(nodew.dewC, null);
  const cor = parseMetar('METAR VOBG 070100Z COR 11004KT 4000 HZ SCT012 SCT080 22/21 Q1020 NOSIG', REF);
  assert.equal(cor.corrected, true); assert.equal(cor.wind.speedKt, 4);
});

test('garbage is survived, recorded, and never invents weather', () => {
  // the live API returned "Q101 5" for VECC 0600Z on 2026-10-07 (seen from Vercel)
  const m = parseMetar('METAR VECC 070600Z 05004KT 3200 -RA SCT018 FEW025CB BKN100 31/23 Q101 5 TEMPO FM0610 2000 TSRA', REF);
  assert.equal(m.tempC, 31); assert.equal(m.qnhHpa, null);
  assert.ok(m.unparsed.includes('Q101'));
  for (const junk of ['', 'hello', 'METAR', 'METAR VECC', 'METAR VECC 999999Z', '\u0000\u0001', 'METAR VECC 070600Z NIL=']) {
    const r = parseMetar(junk, REF);
    if (r) assert.equal(rainingAtStation(r), false, junk);
  }
  assert.equal(parseMetar('METAR VECC 070600Z NIL=', REF)?.nil ?? true, true);
});

test('the day-of-month resolves against the reference clock across a month boundary', () => {
  const m = parseMetar('METAR VECC 302330Z 00000KT 3000 HZ 27/25 Q1010', Date.parse('2026-10-01T00:10:00Z'));
  assert.equal(m.time, '2026-09-30T23:30:00Z');
  const y = parseMetar('METAR VECC 312330Z 00000KT 3000 HZ 17/15 Q1010', Date.parse('2027-01-01T00:10:00Z'));
  assert.equal(y.time, '2026-12-31T23:30:00Z');
});

test('cloud fraction is the largest reported layer (METAR\'s summation principle)', () => {
  assert.deepEqual(COVER_FRACTION, { FEW: 0.1875, SCT: 0.4375, BKN: 0.75, OVC: 1 });
  const m = parseMetar('METAR VECC 071200Z 18005KT 6000 FEW010 SCT020 BKN080 30/25 Q1010', REF);
  assert.equal(cloudFraction(m), 0.75);
});
