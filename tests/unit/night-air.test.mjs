/**
 * The Kolkata night-air correction: the airport's air, put back on the basis the model was
 * calibrated on, at night only, in the model's input only. Evidence:
 * docs/evidence/2026-11-08-kolkata-night-air-correction.md
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { parseMetar } from '../../src/lib/weather/metar.ts';
import { observedNow, rankStations } from '../../src/lib/weather/observed.ts';
import { istMonth, nightAirOffsetK, sunAt } from '../../src/lib/weather/night-air.ts';
import { NIGHT_AIR_CORRECTION } from '../../src/data/night-air-correction.ts';
import { SUN_LIT } from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BG = { lat: 22.522704, lon: 88.369173 };   // Ballygunge, ward centre
const T = (s) => Date.parse(`${s}Z`);

test('the table in TypeScript is the provenance JSON, and the TS oracle for the Python mirror is current', () => {
  const j = JSON.parse(readFileSync(join(ROOT, 'data/night-air/vecc-night-air.json'), 'utf8'));
  assert.deepEqual([...NIGHT_AIR_CORRECTION.VECC.offsetsK], j.offsets_k);
  assert.deepEqual([...NIGHT_AIR_CORRECTION.VECC.n], j.n_instants);
  assert.equal(j.never_fitted_to, 'satellite LST');
  assert.doesNotThrow(() => execFileSync('node', ['--import', 'tsx', 'scripts/dump-night-air-parity.mjs', '--check'],
    { cwd: ROOT, stdio: 'pipe' }));
});

test('the table is 12 months, all positive, seasonal (winter warmest gap, May smallest)', () => {
  const o = NIGHT_AIR_CORRECTION.VECC.offsetsK;
  assert.equal(o.length, 12);
  assert.ok(o.every((x) => x > 0 && x < 5));
  assert.equal(o.indexOf(Math.min(...o)), 4, 'May is the smallest');
  assert.ok(o[11] > 3.5 && o[10] > 3.5, 'Nov-Dec about 4 K');
  assert.ok(NIGHT_AIR_CORRECTION.VECC.n.every((n) => n > 1000));
});

test('IST month: the calendar month the ward lives in, with the turn at 18:30 UTC', () => {
  assert.equal(istMonth(T('2025-01-31T18:29:00')), 1);
  assert.equal(istMonth(T('2025-01-31T18:30:00')), 2);
  assert.equal(istMonth(T('2025-12-31T18:30:00')), 1);
});

test('the offset applies only when the sun is at or below SUN_LIT, only for a station with a table', () => {
  const night = T('2025-11-10T20:00:00'), noon = T('2025-11-10T06:00:00');
  assert.ok(sunAt(night, BG.lat, BG.lon) <= SUN_LIT);
  assert.ok(sunAt(noon, BG.lat, BG.lon) > SUN_LIT);
  assert.equal(nightAirOffsetK('VECC', night, sunAt(night, BG.lat, BG.lon)), NIGHT_AIR_CORRECTION.VECC.offsetsK[10]);
  assert.equal(nightAirOffsetK('VECC', noon, sunAt(noon, BG.lat, BG.lon)), 0);
  assert.equal(nightAirOffsetK('VOBG', night, 0), 0, 'Bengaluru has no table');
  assert.equal(nightAirOffsetK('EHAM', night, 0), 0);
  assert.equal(nightAirOffsetK('VECC', night, SUN_LIT), NIGHT_AIR_CORRECTION.VECC.offsetsK[10], 'the boundary is night, as currentParams');
  assert.equal(nightAirOffsetK('VECC', night, SUN_LIT + 1e-9), 0);
});

test('observedNow: the model gets reading − offset; the report, RH, wind and feels are the airport\'s', () => {
  const now = T('2025-11-10T20:05:00');                       // 01:35 IST, 11 Nov: November
  const m = parseMetar('VECC 102000Z 02004KT 2500 HZ NSC 21/17 Q1015 NOSIG', now);
  const ranked = rankStations('kolkata', BG.lat, BG.lon);
  const sun = sunAt(now, BG.lat, BG.lon);
  const plain = observedNow({ VECC: [m] }, ranked, now);
  const adj = observedNow({ VECC: [m] }, ranked, now, {}, (icao) => nightAirOffsetK(icao, now, sun));
  const off = NIGHT_AIR_CORRECTION.VECC.offsetsK[10];
  assert.equal(plain.airAdjustK, 0);
  assert.equal(adj.airAdjustK, off);
  assert.equal(adj.ambient.tAir, 21 - off);
  assert.equal(adj.latest.tempC, 21, 'the report itself is not altered');
  assert.equal(adj.ambient.rh, plain.ambient.rh, 'humidity comes from the report\'s own air and dew point');
  assert.equal(adj.ambient.wind, plain.ambient.wind);
  assert.equal(adj.ambient.feels, plain.ambient.feels);
  assert.equal(adj.ambient.cloud, plain.ambient.cloud);
});

test('observedNow by day: the same call changes nothing', () => {
  const now = T('2025-11-10T06:05:00');
  const m = parseMetar('VECC 100600Z 02004KT 3000 HZ NSC 31/16 Q1012 NOSIG', now);
  const ranked = rankStations('kolkata', BG.lat, BG.lon);
  const sun = sunAt(now, BG.lat, BG.lon);
  const o = observedNow({ VECC: [m] }, ranked, now, {}, (icao) => nightAirOffsetK(icao, now, sun));
  assert.equal(o.airAdjustK, 0);
  assert.equal(o.ambient.tAir, 31);
});
