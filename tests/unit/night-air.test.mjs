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
import * as NA from '../../src/lib/weather/night-air.ts';
import { istMonth, nightAirOffsetK, sunAt } from '../../src/lib/weather/night-air.ts';
import { NIGHT_AIR_CORRECTION } from '../../src/data/night-air-correction.ts';
import * as MODEL from '../../src/scripts/climate-engine/heat-map-model.ts';
import { currentParams, SUN_LIT } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { selectPhase } from '../../src/scripts/climate-engine/phase-select.ts';

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

const CLIMATE = resolve('in/kolkata/ballygunge').climate;
const IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
const RANKED = rankStations('kolkata', BG.lat, BG.lon);
/** the month's offset for a station, the sun NOT consulted: what the app hands observedNow */
const month = (now) => (icao) => NIGHT_AIR_CORRECTION[icao]?.offsetsK[istMonth(now) - 1] ?? 0;
/** the live ambient the page composes from one VECC report, with or without the offset carried */
function liveFrom(nowIso, raw, carry) {
  const now = T(nowIso.replace(/Z$/, ''));
  const m = parseMetar(raw, now);
  return observedNow({ VECC: [m] }, RANKED, now, {}, carry ? month(now) : undefined);
}
const NIGHT_RAW = 'VECC 102000Z 02004KT 2500 HZ NSC 21/17 Q1015 NOSIG';
const DAY_RAW = 'VECC 100600Z 02004KT 3000 HZ NSC 31/16 Q1012 NOSIG';
const params = (live, over) => currentParams({ live, phase: 'peak', path: '2025', climate: CLIMATE, iv: IV, sunNow: null, heatTairC: null, ...over });

test('observedNow carries the month\'s offset on the observation; the air it hands the model is the raw report', () => {
  const now = T('2025-11-10T20:05:00');                       // 01:35 IST, 11 Nov: November
  const plain = liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, false);
  const adj = liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, true);
  const off = NIGHT_AIR_CORRECTION.VECC.offsetsK[10];
  assert.equal(plain.nightAirK, 0);
  assert.equal(adj.nightAirK, off);
  assert.equal(adj.ambient.observed.nightAirK, off, 'the number rides on the observation currentParams reads');
  assert.equal(adj.ambient.tAir, 21, 'the composed air is the airport\'s, untouched');
  assert.equal(adj.latest.tempC, 21, 'the report itself is not altered');
  assert.equal(adj.ambient.rh, plain.ambient.rh, 'humidity comes from the report\'s own air and dew point');
  assert.equal(adj.ambient.wind, plain.ambient.wind);
  assert.equal(adj.ambient.feels, plain.ambient.feels);
  assert.equal(adj.ambient.cloud, plain.ambient.cloud);
  assert.ok(now > 0);
});

test('the carried offset does not depend on the clock\'s sun: a day-composed observation still carries it', () => {
  const o = liveFrom('2025-11-10T06:05:00Z', DAY_RAW, true);
  assert.equal(o.nightAirK, NIGHT_AIR_CORRECTION.VECC.offsetsK[10]);
  assert.equal(o.ambient.tAir, 31);
});

test('AUDIT M1(a): every scenario\'s params are byte-identical with and without the offset present', () => {
  const withOff = liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, true).ambient;   // composed AT NIGHT
  const without = liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, false).ambient;
  assert.equal(withOff.observed.nightAirK > 3, true);
  const P99 = 38.4;
  const pathways = Object.keys(CLIMATE.pathDelta);
  assert.ok(pathways.length > 1, 'the Kolkata scope has pathways to sweep');
  let n = 0;
  for (const id of ['peak', 'night', 'heatwave']) {
    for (const path of ['2025', ...pathways]) {
      const sel = selectPhase(id, P99);
      const a = JSON.stringify(params(withOff, { phase: sel.phase, sunNow: sel.sunNow, heatTairC: sel.heatTairC, path }));
      const b = JSON.stringify(params(without, { phase: sel.phase, sunNow: sel.sunNow, heatTairC: sel.heatTairC, path }));
      assert.equal(a, b, `${id}/${path}: the offset leaked into a canonical scenario`);
      n++;
    }
  }
  assert.ok(n >= 6);
  // Heatwave's derived humidity in particular (it is computed from the observed air)
  const hw = selectPhase('heatwave', P99);
  assert.equal(params(withOff, { phase: hw.phase, sunNow: hw.sunNow, heatTairC: hw.heatTairC }).L,
    params(without, { phase: hw.phase, sunNow: hw.sunNow, heatTairC: hw.heatTairC }).L);
  // and "Now" after DARK is the one place it acts
  const nowNight = params(withOff, { sunNow: 0 }), nowNightRaw = params(without, { sunNow: 0 });
  assert.equal(nowNight.tAir, 21 - NIGHT_AIR_CORRECTION.VECC.offsetsK[10]);
  assert.equal(nowNightRaw.tAir, 21);
});

test('AUDIT M1(b): a dawn flip uses the raw air for the day branch; a dusk flip applies the offset at once', () => {
  // ONE composed observation (made in the dark) across both sides of SUN_LIT, as the page
  // holds it for up to ten minutes after the stats tick flips the branch.
  const live = liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, true).ambient;
  const off = NIGHT_AIR_CORRECTION.VECC.offsetsK[10];
  const dark = params(live, { sunNow: SUN_LIT }), lit = params(live, { sunNow: SUN_LIT + 1e-6 });
  assert.equal(dark.tAir, 21 - off, 'sun <= SUN_LIT: the night branch, corrected');
  assert.equal(lit.tAir, 21, 'dawn: the day branch runs on the airport\'s own air');
  assert.ok(lit.sun > 0 && dark.sun === 0);
  // Dusk is the same observation read the other way round (composed by day, then the sun sets)
  const dayComposed = liveFrom('2025-11-10T06:05:00Z', DAY_RAW, true).ambient;
  assert.equal(params(dayComposed, { sunNow: 0.5 }).tAir, 31, 'day: raw');
  assert.equal(params(dayComposed, { sunNow: 0 }).tAir, 31 - off, 'dusk: the offset the moment the branch flips');
  // the day branch is byte-identical to the one an un-offset observation produces
  assert.equal(JSON.stringify(lit), JSON.stringify(params(liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, false).ambient, { sunNow: SUN_LIT + 1e-6 })));
});

test('the month offset function agrees with the table, sun not consulted', () => {
  const noon = T('2025-11-10T06:00:00');
  assert.equal(NA.nightAirMonthOffsetK('VECC', noon), NIGHT_AIR_CORRECTION.VECC.offsetsK[10]);
  assert.equal(NA.nightAirMonthOffsetK('VOBG', noon), 0);
});

test('nightAirAppliedK: what is subtracted is a function of the branch only, and the app line reads the same', () => {
  const live = liveFrom('2025-11-10T20:05:00Z', NIGHT_RAW, true).ambient;
  const off = NIGHT_AIR_CORRECTION.VECC.offsetsK[10];
  assert.equal(MODEL.nightAirAppliedK({ live, sunNow: 0, heatTairC: null }), off);
  assert.equal(MODEL.nightAirAppliedK({ live, sunNow: SUN_LIT, heatTairC: null }), off);
  assert.equal(MODEL.nightAirAppliedK({ live, sunNow: SUN_LIT + 1e-6, heatTairC: null }), 0);
  assert.equal(MODEL.nightAirAppliedK({ live, sunNow: null, heatTairC: null }), 0, 'a canonical scenario');
  assert.equal(MODEL.nightAirAppliedK({ live: null, sunNow: 0, heatTairC: null }), 0);
  assert.equal(MODEL.nightAirAppliedK({ live: { ...live, observed: undefined }, sunNow: 0, heatTairC: null }), 0, 'a forecast has no offset');
});

test('the RUNTIME path (carried month offset, applied by nightAirAppliedK) reproduces the parity oracle on every scene and twilight probe', () => {
  const oracle = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/night-air/ts-oracle.json'), 'utf8'));
  const run = (utc, sun) => {
    const ms = Date.parse(`${utc}Z`);
    const live = { tAir: 20, rh: 70, wind: 2, cloud: 0, feels: 20, observed: { stationCloud: false, convective: 'none', wet: 0, nightAirK: NA.nightAirMonthOffsetK('VECC', ms) } };
    return MODEL.nightAirAppliedK({ live, sunNow: sun, heatTairC: null });
  };
  const rows = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/night-air/rows-night-49.json'), 'utf8')).rows;
  rows.forEach((r, i) => assert.equal(run(r.utc, oracle.rows[i].sun), oracle.rows[i].offsetK, r.rid));
  for (const p of oracle.probes) assert.equal(run(p.utc, p.sun), p.offsetK, p.utc);
  const twi = oracle.probes.filter((p) => p.sun > 0 && p.sun <= SUN_LIT);
  assert.ok(twi.length >= 4 && twi.every((p) => p.offsetK > 0), 'twilight probes are inside the night branch');
});

test('wiring: the app carries the month offset at compose time and never subtracts it there; the line is the plain-°C copy', () => {
  const app = readFileSync(join(ROOT, 'src/scripts/climate-engine/heat-map-app.ts'), 'utf8');
  assert.ok(!/nightAirOffsetK|sunAt\(/.test(app), 'composeLive must not decide night: the sun at compose time is the audit M1 bug');
  assert.ok(/nightAirMonthOffsetK\(icao, nowMs\)/.test(app));
  assert.ok(/Map uses air \$\{adjK\.toFixed\(1\)\} °C below the airport at night \(calibration\)/.test(app));
  assert.ok(!/ K lower at night/.test(app), 'no "K lower" jargon beside a °C tile (audit m1)');
});
