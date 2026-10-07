/**
 * Observed cloud and rain in the heat model — 2026-10-07, "46.7 °C in the rain".
 *
 * Three things are pinned here:
 *   1. station-observed cloud attenuates the sun per Kasten & Czeplak (1980),
 *      further under CB/TCU/TS, and NOTHING ELSE CHANGES: a met.no (model-cloud)
 *      reading produces bit-identical params to the calibrated path;
 *   2. while it rains surfaces relax towards AIR temperature, and re-warm after;
 *   3. today's case: the 0600Z VECC report puts Ballygunge near air, not 46.7.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as M from '../../src/scripts/climate-engine/heat-map-model.ts';
import { solarElevationFactor } from '../../src/scripts/climate-engine/sky.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { parseMetar } from '../../src/lib/weather/metar.ts';
import { observedNow } from '../../src/lib/weather/observed.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = join(ROOT, 'tests/fixtures/metar');
const ZERO = { trees: 0, roof: 0, parks: 0, facades: 0 };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const RAW = JSON.parse(readFileSync(join(FIX, 'metar-20261007T0609Z.json'), 'utf8'));
const CAPTURE = Date.parse('2026-10-07T06:09:00Z');
const reportsOf = (icao, upTo = CAPTURE) => RAW.filter(r => r.icaoId === icao)
  .map(r => parseMetar(r.rawOb, CAPTURE)).filter(m => m && Date.parse(m.time) <= upTo)
  .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));

// Ballygunge's ward surface, as the calibration scores it (ward-observations.json)
const OBS = JSON.parse(readFileSync(join(ROOT, 'data/calibration/ward-observations.json'), 'utf8'));
const BG = OBS.rows.find(r => r.ward === 'ballygunge');
const BG_MEANS = { albedo: BG.albedo, veg: BG.fvc, built: BG.built };
const BG_LAT = 22.522704, BG_LON = 88.369173;
const SCOPE = resolve('in/kolkata/ballygunge');

function sunAt(ms, lat = BG_LAT, lon = BG_LON) {
  const h = (((ms / 3.6e6) % 24) + lon / 15) % 24;
  const doy = Math.floor((ms - Date.UTC(new Date(ms).getUTCFullYear(), 0, 1)) / 864e5) + 1;
  return { sunNow: solarElevationFactor(h, doy, lat), hour: h };
}
function nowParams(live, ms) {
  const { sunNow, hour } = sunAt(ms);
  return M.currentParams({ live, phase: 'peak', path: SCOPE.pathway?.initial ?? '2025',
    climate: SCOPE.climate, iv: ZERO, clock: { month: 10, hour }, sunNow });
}

/* ── 1. cloud ─────────────────────────────────────────────────────────── */

test('Kasten & Czeplak: 1 − 0.75·C^3.4 for station-observed cloud', () => {
  assert.equal(M.stationCloudTransmission(0, 'none'), 1);
  close(M.stationCloudTransmission(1, 'none'), 0.25, 1e-12, 'overcast passes a quarter');
  close(M.stationCloudTransmission(0.75, 'none'), 1 - 0.75 * 0.75 ** 3.4, 1e-12, 'BKN');
  close(M.stationCloudTransmission(0.4375, 'none'), 1 - 0.75 * 0.4375 ** 3.4, 1e-12, 'SCT');
  // monotone in cover
  let prev = 2;
  for (let c = 0; c <= 1.0001; c += 0.05) {
    const t = M.stationCloudTransmission(c, 'none');
    assert.ok(t <= prev); prev = t;
  }
  // out-of-range input is clamped, never extrapolated
  assert.equal(M.stationCloudTransmission(-1, 'none'), 1);
  assert.equal(M.stationCloudTransmission(2, 'none'), M.stationCloudTransmission(1, 'none'));
});

test('convective cloud and thunder cut the sun further, in that order', () => {
  for (const c of [0.19, 0.44, 0.75, 1]) {
    const n = M.stationCloudTransmission(c, 'none');
    const cb = M.stationCloudTransmission(c, 'cumuliform');
    const ts = M.stationCloudTransmission(c, 'thunder');
    assert.ok(cb < n && ts < cb, `C=${c}: ${n} ${cb} ${ts}`);
    close(cb, n * M.CONVECTIVE_TRANSMISSION.cumuliform, 1e-12, 'CB factor');
    close(ts, n * M.CONVECTIVE_TRANSMISSION.thunder, 1e-12, 'TS factor');
  }
});

test('a met.no reading (model cloud) is the calibrated path, byte for byte', () => {
  // The calibration was fitted with 1 − 0.6·C on NASA POWER's model cloud; swapping
  // that formula globally moved the Landsat stratum's RMSE 2.913 → 3.170 K. So it
  // stays for model cloud. Pin it by its arithmetic, not by a call to itself.
  const ms = Date.parse('2026-10-07T06:00:00Z');
  for (const cloud of [0, 13.3, 38, 76.6, 100]) {
    const live = { tAir: 32, rh: 62.9, wind: 1, cloud, feels: 38 };
    const p = nowParams(live, ms);
    close(p.sun, sunAt(ms).sunNow * (1 - 0.6 * cloud / 100), 1e-12, `metno sun at ${cloud}%`);
    const peak = M.currentParams({ live, phase: 'peak', path: '2025', climate: SCOPE.climate, iv: ZERO, clock: { month: 10, hour: 13 } });
    close(peak.sun, 1 - 0.6 * cloud / 100, 1e-12, `peak sun at ${cloud}%`);
    const ref = M.currentParamsForReference(live, 'peak', ZERO);
    close(ref.sun, 1 - 0.6 * cloud / 100, 1e-12, `compare sun at ${cloud}%`);
  }
});

test('a CLEAR station report is the clear-sky calibrated path exactly', () => {
  const ms = Date.parse('2026-10-07T06:00:00Z');
  const base = { tAir: 30, rh: 60, wind: 2, cloud: 0, feels: 33 };
  const metno = nowParams(base, ms);
  const station = nowParams({ ...base, observed: { stationCloud: true, convective: 'none', wet: 0 } }, ms);
  assert.deepEqual(station, metno, 'clear and dry: the observation must not move a single param');
});

/* ── 2. rain ──────────────────────────────────────────────────────────── */

test('wetness: rises with τ_wet while it rains, falls with τ_dry after', () => {
  const T0 = Date.parse('2026-10-07T05:45:00Z'), min = 60_000;
  assert.equal(M.surfaceWetness([], T0), 0);
  assert.equal(M.surfaceWetness([{ startMs: T0, endMs: null }], T0 - min), 0, 'before the rain');
  close(M.surfaceWetness([{ startMs: T0, endMs: null }], T0 + M.TAU_WET_MIN * min), 1 - Math.exp(-1), 1e-12, 'one τ_wet');
  // stops after 60 min: w_stop then e-folds with τ_dry
  const ep = [{ startMs: T0, endMs: T0 + 60 * min }];
  const wStop = 1 - Math.exp(-60 / M.TAU_WET_MIN);
  close(M.surfaceWetness(ep, T0 + 60 * min), wStop, 1e-12, 'at the stop');
  close(M.surfaceWetness(ep, T0 + (60 + M.TAU_DRY_MIN) * min), wStop * Math.exp(-1), 1e-12, 'one τ_dry later');
  assert.ok(M.surfaceWetness(ep, T0 + 300 * min) < 0.01, 'dry again within a few hours');
  // two showers: the second starts on a still-damp surface
  const two = [{ startMs: T0, endMs: T0 + 10 * min }, { startMs: T0 + 20 * min, endMs: null }];
  assert.ok(M.surfaceWetness(two, T0 + 25 * min) > M.surfaceWetness([{ startMs: T0 + 20 * min, endMs: null }], T0 + 25 * min));
  // the time constants are the ones documented, inside the founder's range
  assert.ok(M.TAU_WET_MIN >= 20 && M.TAU_WET_MIN <= 40);
  assert.ok(M.TAU_DRY_MIN > 0 && M.TAU_DRY_MIN <= 60);
});

test('wet params relax every cell towards air by exactly (1 − w)', () => {
  const p = nowParams({ tAir: 31, rh: 62, wind: 2, cloud: 75, feels: 35,
    observed: { stationCloud: true, convective: 'cumuliform', wet: 0 } }, Date.parse('2026-10-07T06:00:00Z'));
  for (const w of [0, 0.25, 0.5, 0.9, 1]) {
    const q = M.wetSurfaceParams(p, w);
    for (const [a, v, b] of [[0.1, 0, 1], [0.2, 0.9, 0], [0.15, 0.3, 0.4], [0.3, 0.05, 0.8]]) {
      const dry = M.eqCell(p, a, v, b), wet = M.eqCell(q, a, v, b);
      close(wet - p.tAir, (1 - w) * (dry - p.tAir), 1e-9, `cell ${a}/${v}/${b} at w=${w}`);
    }
    // the conductance is untouched, so the solver's relaxation and diffusion length are too
    assert.equal(q.kRad, p.kRad); assert.equal(q.h, p.h); assert.equal(q.wind, p.wind); assert.equal(q.D, p.D);
  }
  assert.deepEqual(M.wetSurfaceParams(p, 0), p);
});

test('rain applies to "now" only, and night surfaces relax too', () => {
  const live = { tAir: 26, rh: 94, wind: 1, cloud: 100, feels: 26,
    observed: { stationCloud: true, convective: 'none', wet: 0.8 } };
  const night = nowParams(live, Date.parse('2026-10-06T16:30:00Z'));   // 22:00 IST
  const dryNight = nowParams({ ...live, observed: { ...live.observed, wet: 0 } }, Date.parse('2026-10-06T16:30:00Z'));
  close(M.eqMeanFromMeans(BG_MEANS, night) - 26, 0.2 * (M.eqMeanFromMeans(BG_MEANS, dryNight) - 26), 1e-9, 'night');
  // the canonical 13:00 scenario is a representative midday, not this minute
  const peak = M.currentParams({ live, phase: 'peak', path: '2025', climate: SCOPE.climate, iv: ZERO, clock: { month: 10, hour: 13 } });
  const peakDry = M.currentParams({ live: { ...live, observed: { ...live.observed, wet: 0 } }, phase: 'peak', path: '2025', climate: SCOPE.climate, iv: ZERO, clock: { month: 10, hour: 13 } });
  assert.deepEqual(peak, peakDry);
});

/* ── 3. today's case ──────────────────────────────────────────────────── */

test('2026-10-07 11:30 IST, Ballygunge: the 0600Z VECC report puts surfaces near air', () => {
  const at = Date.parse('2026-10-07T06:00:00Z');
  const now = observedNow({ VECC: reportsOf('VECC', at) }, [{ icao: 'VECC', km: 16 }], at);
  assert.ok(now, 'a fresh VECC report must be used');
  assert.equal(now.latest.time, '2026-10-07T06:00:00Z');
  assert.equal(now.ambient.tAir, 31);
  assert.equal(now.raining, true);
  const mean = M.eqMeanFromMeans(BG_MEANS, nowParams(now.ambient, at));
  // BEFORE: met.no's forecast at the same minute
  const metno = M.asAmbient(JSON.parse(readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8')));
  const before = M.eqMeanFromMeans(BG_MEANS, nowParams(metno, at));
  assert.ok(before > 46, `the defect, reproduced: ${before.toFixed(1)}`);
  assert.ok(mean >= 31 && mean <= 34.5, `ward mean ${mean.toFixed(2)} °C must sit near the 31 °C air`);
  // and 13 minutes on (the next poll), wetter still
  const later = Date.parse('2026-10-07T06:13:00Z');
  const n2 = observedNow({ VECC: reportsOf('VECC', at) }, [{ icao: 'VECC', km: 16 }], later);
  const mean2 = M.eqMeanFromMeans(BG_MEANS, nowParams(n2.ambient, later));
  assert.ok(mean2 < mean && mean2 <= 34, `13 min later ${mean2.toFixed(2)}`);
});

test('the same morning without the rain term would still be far above air', () => {
  // This is what the rain term is worth, measured: cloud alone does not do it.
  const at = Date.parse('2026-10-07T06:00:00Z');
  const now = observedNow({ VECC: reportsOf('VECC', at) }, [{ icao: 'VECC', km: 16 }], at);
  const dry = { ...now.ambient, observed: { ...now.ambient.observed, wet: 0 } };
  const mean = M.eqMeanFromMeans(BG_MEANS, nowParams(dry, at));
  assert.ok(mean > 36, `dry under the same cloud: ${mean.toFixed(2)}`);
});

/* ── audit fixes (PR #52 review) ──────────────────────────────────────── */

import { fallbackAmbient, carriedWetness } from '../../src/lib/weather/observed.ts';

const STATION_BKN_CB = { tAir: 31, rh: 62, wind: 2, cloud: 75, feels: 35,
  observed: { stationCloud: true, convective: 'cumuliform', wet: 0 } };

test('the 13:00 scenario runs the CALIBRATED cloud formula even when "now" is a METAR', () => {
  // A representative midday must not borrow this minute's physics: its band was
  // measured with 1 − 0.6·C, so that is what it runs, exactly.
  const peak = M.currentParams({ live: STATION_BKN_CB, phase: 'peak', path: '2025', climate: SCOPE.climate, iv: ZERO, clock: { month: 10, hour: 13 } });
  assert.equal(peak.sun, 1 * (1 - 0.6 * 0.75));
  const metno = M.currentParams({ live: M.asScenarioAmbient(STATION_BKN_CB), phase: 'peak', path: '2025', climate: SCOPE.climate, iv: ZERO, clock: { month: 10, hour: 13 } });
  assert.deepEqual(peak, metno, 'the scenario is blind to the observation');
  // and the deck is handed the same: the scenario reading has no observed term
  assert.equal(M.asScenarioAmbient(STATION_BKN_CB).observed, undefined);
  assert.equal(M.ambientCloudTransmission(M.asScenarioAmbient(STATION_BKN_CB)), 1 - 0.6 * 0.75);
  // "now" with the same reading does use Kasten & Czeplak
  const now = nowParams(STATION_BKN_CB, Date.parse('2026-10-07T06:00:00Z'));
  close(now.sun, sunAt(Date.parse('2026-10-07T06:00:00Z')).sunNow * M.stationCloudTransmission(0.75, 'cumuliform'), 1e-12, 'now');
});

test('outside validation: wet, or station cloud that is not the calibrated physics', () => {
  assert.equal(M.outsideValidation(null, true), null);
  assert.equal(M.outsideValidation({ tAir: 30, rh: 60, wind: 2, cloud: 40, feels: 33 }, true), null, 'met.no: calibrated');
  assert.equal(M.outsideValidation(STATION_BKN_CB, true), 'station-cloud');
  // HAL at 0600Z: SCT012, no CB — still K&C, still outside
  assert.equal(M.outsideValidation({ ...STATION_BKN_CB, cloud: 43.75, observed: { stationCloud: true, convective: 'none', wet: 0 } }, true), 'station-cloud');
  // a clear station sky transmits 1 under both formulae: calibrated, band kept
  assert.equal(M.outsideValidation({ ...STATION_BKN_CB, cloud: 0, observed: { stationCloud: true, convective: 'none', wet: 0 } }, true), null);
  // a clear sky with a CB reported is not
  assert.equal(M.outsideValidation({ ...STATION_BKN_CB, cloud: 0, observed: { stationCloud: true, convective: 'cumuliform', wet: 0 } }, true), 'station-cloud');
  // wet wins, whatever the cloud
  assert.equal(M.outsideValidation({ ...STATION_BKN_CB, observed: { ...STATION_BKN_CB.observed, wet: 0.3 } }, true), 'wet');
  assert.equal(M.outsideValidation({ tAir: 30, rh: 60, wind: 2, cloud: 40, feels: 33, observed: { stationCloud: false, convective: 'none', wet: 0.2 } }, true), 'wet');
  // AFTER DARK station cloud is the calibrated physics: transmission multiplies a sun of 0
  assert.equal(M.outsideValidation(STATION_BKN_CB, false), null, 'night: band stands');
  const dark = (L) => nowParams(L, Date.parse('2026-10-07T16:30:00Z'));   // 22:00 IST
  assert.deepEqual(dark(STATION_BKN_CB), dark(M.asScenarioAmbient(STATION_BKN_CB)), 'night params identical either way');
  // ...but wet is wet at night too
  assert.equal(M.outsideValidation({ ...STATION_BKN_CB, observed: { ...STATION_BKN_CB.observed, wet: 0.3 } }, false), 'wet');
  // model cloud carried with wet = 0 is the calibrated physics
  assert.equal(M.outsideValidation({ tAir: 30, rh: 60, wind: 2, cloud: 40, feels: 33, observed: { stationCloud: false, convective: 'none', wet: 0 } }, true), null);
});

test('wetness below 1 % is dry, so the chip can clear', () => {
  const T0 = Date.parse('2026-10-07T05:00:00Z'), min = 60_000;
  const ep = [{ startMs: T0, endMs: T0 + 30 * min }];
  assert.ok(M.surfaceWetness(ep, T0 + 100 * min) > 0);
  assert.equal(M.surfaceWetness(ep, T0 + 30 * min + 200 * min), 0);
  assert.equal(M.WET_FLOOR, 0.01);
});

test('a feed that freezes in the rain decays the surface — no snap back to the dry model', () => {
  // The audit's case: VECC's feed stops after 06:00Z (-RA). Before the fix it read a
  // wet 31 °C at 07:29 and 46.7 °C at 07:31.
  const frozen = { VECC: reportsOf('VECC', Date.parse('2026-10-07T06:00:00Z')) };
  const metno = M.asAmbient(JSON.parse(readFileSync(join(FIX, 'metno-ballygunge-20261007T0609Z.json'), 'utf8')));
  const ranked = [{ icao: 'VECC', km: 16 }];
  let prev = null, worst = 0, at729 = 0, at731 = 0;
  for (let t = Date.parse('2026-10-07T06:00:00Z'); t <= Date.parse('2026-10-07T09:30:00Z'); t += 60_000) {
    const live = observedNow(frozen, ranked, t)?.ambient ?? fallbackAmbient(metno, frozen, ranked, t);
    const mean = M.eqMeanFromMeans(BG_MEANS, nowParams(live, t));
    if (prev !== null) worst = Math.max(worst, Math.abs(mean - prev));
    prev = mean;
    if (t === Date.parse('2026-10-07T07:29:00Z')) at729 = mean;
    if (t === Date.parse('2026-10-07T07:31:00Z')) at731 = mean;
  }
  /* The handover is not seamless and should not pretend to be: met.no's air is 32 °C
     where the airport's was 31, so the surface steps by about that — and NOT by the
     15 K it used to. Wetness itself is continuous across the stale limit. */
  assert.ok(at731 - metno.tAir < 1, `07:31: surface ${at731.toFixed(2)} must stay near met.no's ${metno.tAir} °C air`);
  assert.ok(Math.abs(at731 - at729) < 2, `07:29 ${at729.toFixed(2)} → 07:31 ${at731.toFixed(2)}`);
  assert.ok(worst < 2, `largest one-minute step ${worst.toFixed(2)} K`);
  const wAt = (t) => observedNow(frozen, ranked, t)?.ambient.observed.wet ?? fallbackAmbient(metno, frozen, ranked, t).observed.wet;
  assert.ok(Math.abs(wAt(Date.parse('2026-10-07T07:30:00Z')) - wAt(Date.parse('2026-10-07T07:31:00Z'))) < 0.05,
    'wetness is continuous across the stale limit');
  // it does dry out: an hour past the stale limit the surface has mostly re-warmed
  const later = Date.parse('2026-10-07T08:30:00Z');
  const w = carriedWetness(frozen, ranked, later);
  // onset 05:45 (midpoint), trusted to 07:30 (06:00 + 90 min), then an hour of τ_dry
  close(w, (1 - Math.exp(-105 / M.TAU_WET_MIN)) * Math.exp(-60 / M.TAU_DRY_MIN), 1e-9, 'one hour of τ_dry after the trust ran out');
  assert.equal(fallbackAmbient(metno, frozen, ranked, Date.parse('2026-10-07T13:00:00Z')).observed, undefined,
    'once dry, the fallback is met.no unchanged');
  // and with no airport history at all, met.no is untouched
  assert.equal(fallbackAmbient(metno, {}, ranked, later), metno);
});
