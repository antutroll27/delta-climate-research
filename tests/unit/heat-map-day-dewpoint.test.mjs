/**
 * The dewpoint limit on evaporation, by day. 2026-11-10.
 *
 * Amsterdam, air 0 C, RH 100 %, low sun: the greenest cell read -16 C, -9.1 K of it from
 * "evaporation" into saturated air. By night `nightLatent` already tapered ET to zero as the
 * surface reached the dewpoint; by day `evapScale` floors at 0.6 even at RH 100 %. The
 * taper is now ONE helper (`dewpointTaper`) used by both.
 *
 * Pinned here:
 *   (a) the night latent term is bit-identical to the old implementation;
 *   (b) ordinary daytime "now" params are bit-identical to the old arithmetic, field by field;
 *   (c) the saturated cold case: latent is 0, the greenest cell is the old value plus the term;
 *   (d) a partial taper is strictly between, and continuous in RH (steep, not flat: see the test);
 *   (e) the canonical peak / night / Compare builders are unchanged for ordinary forcing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import * as M from '../../src/scripts/climate-engine/heat-map-model.ts';
import { DEFAULT_PARAMS, STORE_NIGHT } from '../../src/scripts/climate-engine/types.ts';
import { dewpointC, skyTemperatureC } from '../../src/scripts/climate-engine/sky.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

const IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
const NIGHT_ET_FRACTION = 0.10, Q_NIGHT_RATIO = 0.5, TAPER_K = 1.0;   // mirrored from the model

const SCOPES = {
  kolkata: resolve('in/kolkata/ballygunge'),
  bengaluru: resolve('in/bengaluru/indiranagar'),
  amsterdam: resolve('nl/amsterdam/canal-ring'),
};

function state(scope, live, sunNow, extra = {}) {
  const climate = scope.climate;
  return { live, phase: 'peak', path: Object.keys(climate.pathDelta)[0] ?? '2025', iv: IV, climate,
    clock: { month: 11, hour: 8 }, sunNow, heatTairC: null, ...extra };
}
const delta = (s) => Object.keys(s.climate.pathDelta).length ? s.climate.pathDelta[s.path] : 0;
const windOf = (w) => Math.min(2.5, Math.max(0.3, w / 3));

/* ── ORACLES: the old arithmetic, verbatim ─────────────────────────────────── */
function oldNightLatent(p, rh) {
  const dry = { ...p, L: 0 };
  const surface = M.eqCell(dry, 0.18, 0.6, 0);
  const headroom = (surface - dewpointC(p.tAir, rh)) / TAPER_K;
  return p.L * NIGHT_ET_FRACTION * Math.min(1, Math.max(0, headroom));
}
/** The old lit "now" branch: no taper, no observed block. */
function oldLit(s) {
  const L = s.live, baseTair = L.tAir + delta(s), cloud = L.cloud / 100, rh = L.rh;
  const evap = M.evapScale(rh);
  const b = { ...DEFAULT_PARAMS, D: M.SIM_D, Q: DEFAULT_PARAMS.Q, wind: windOf(L.wind), L: DEFAULT_PARAMS.L * evap };
  return { ...b, sun: s.sunNow * M.legacyCloudTransmission(cloud), tAir: baseTair,
    tSky: skyTemperatureC(baseTair, rh, cloud) };
}
const sameFields = (a, b, msg) => {
  assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort(), `${msg}: key set`);
  for (const k of Object.keys(b)) assert.ok(Object.is(a[k], b[k]), `${msg}: ${k} ${a[k]} vs ${b[k]}`);
};
const headroomOf = (p, rh) => M.eqCell({ ...p, L: 0 }, 0.18, 0.6, 0) - dewpointC(p.tAir, rh);

/* ── (a) night latent bit-identical ────────────────────────────────────────── */
test('(a) nightLatent is bit-identical to the old implementation', () => {
  let n = 0;
  for (const tAir of [-10, 0, 5, 12, 20, 28, 33, 41]) for (const rh of [5, 30, 60, 85, 90, 95, 99, 100])
    for (const wind of [0, 1, 3, 8, 20]) for (const cloud of [0, 30, 70, 100]) {
      const live = { tAir, rh, wind, cloud, feels: tAir };
      const s = state(SCOPES.kolkata, live, 0);                        // "now", dark
      const p = M.currentParams(s);
      const dark = { ...p, L: DEFAULT_PARAMS.L * M.evapScale(rh) };
      assert.ok(Object.is(p.L, oldNightLatent(dark, rh)), `now night ${JSON.stringify(live)}`);
      // the canonical night scenario and the Compare night builder
      const night = M.currentParams({ ...s, sunNow: null, phase: 'night' });
      assert.ok(Object.is(night.L, oldNightLatent({ ...night, L: DEFAULT_PARAMS.L * M.evapScale(rh) }, rh)), 'scenario night');
      const ref = M.currentParamsForReference(live, 'night', IV);
      assert.ok(Object.is(ref.L, oldNightLatent({ ...ref, L: DEFAULT_PARAMS.L * M.evapScale(rh) }, rh)), 'compare night');
      n += 3;
    }
  assert.equal(n, 8 * 8 * 5 * 4 * 3);
  // and the helper is the same factor the old function clamped
  const p = M.currentParams(state(SCOPES.kolkata, { tAir: 26, rh: 97, wind: 3, cloud: 0, feels: 26 }, 0));
  const taper = M.dewpointTaper({ ...p, L: 123 }, 97);               // p.L is ignored
  assert.ok(taper >= 0 && taper <= 1);
  assert.ok(Object.is(taper, M.dewpointTaper({ ...p, L: 0 }, 97)));
});

/* ── (b) ordinary daytime "now": every field identical ─────────────────────── */
const ORDINARY = [
  ['Kolkata midday', 'kolkata', { tAir: 33, rh: 55, wind: 9, cloud: 20, feels: 36 }, 0.92],
  ['Kolkata monsoon forenoon', 'kolkata', { tAir: 31, rh: 88, wind: 6, cloud: 60, feels: 38 }, 0.55],
  ['Bengaluru midday', 'bengaluru', { tAir: 29, rh: 50, wind: 10, cloud: 30, feels: 29 }, 0.9],
  ['Kolkata dawn', 'kolkata', { tAir: 28, rh: 70, wind: 3, cloud: 0, feels: 28 }, 0.06],
];
test('(b) ordinary daytime "now" params are Object.is-identical to the old arithmetic', () => {
  for (const [name, sc, live, sunNow] of ORDINARY) {
    const s = state(SCOPES[sc], live, sunNow);
    assert.ok(sunNow > M.SUN_LIT, `${name} is a lit branch`);
    sameFields(M.currentParams(s), oldLit(s), name);
  }
});
test('(b) Kolkata dawn (sunNow 0.06) headroom', () => {
  const s = state(SCOPES.kolkata, ORDINARY[3][2], 0.06);
  const p = M.currentParams(s);
  const h = headroomOf(p, 70);
  console.log(`    Kolkata dawn headroom ${h.toFixed(2)} K, taper ${M.dewpointTaper(p, 70)}`);
  assert.ok(h > TAPER_K, `headroom ${h} K must exceed the ${TAPER_K} K taper width`);
  assert.equal(M.dewpointTaper(p, 70), 1);
});

/* ── (c) Amsterdam, air 0 C, RH 100 %, clear ───────────────────────────────── */
test('(c) saturated cold air: the latent term is closed and the greenest cell warms by exactly that term', () => {
  const live = { tAir: 0, rh: 100, wind: 1.0, cloud: 0, feels: 0 };
  for (const sunNow of [0.06, 0.35]) {
    const s = state(SCOPES.amsterdam, live, sunNow);
    const now = M.currentParams(s), old = oldLit(s);
    assert.equal(now.L, 0, `sunNow ${sunNow}: lit L`);
    assert.ok(old.L > 0);
    for (const k of Object.keys(old)) if (k !== 'L') assert.ok(Object.is(now[k], old[k]), `${k}`);
    const was = M.eqCell(old, 0.19, 0.878, 0), is = M.eqCell(now, 0.19, 0.878, 0);
    const k = old.kRad + old.h * old.wind, removed = old.L * 0.878 / k;
    assert.ok(Math.abs((is - was) - removed) < 1e-12, `${is - was} vs ${removed}`);
    console.log(`    sunNow ${sunNow}: greenest cell ${was.toFixed(2)} -> ${is.toFixed(2)} C (+${removed.toFixed(2)} K)`);
  }
});

/* ── (d) partial taper ─────────────────────────────────────────────────────── */
test('(d) a partial taper lands strictly between, and is continuous in RH', () => {
  const at = (rh) => {
    const s = state(SCOPES.amsterdam, { tAir: 0, rh, wind: 1.0, cloud: 0, feels: 0 }, 0.06);
    return M.currentParams(s);
  };
  const full = (rh) => DEFAULT_PARAMS.L * M.evapScale(rh);
  let partial = null;
  for (let rh = 100; rh >= 40; rh -= 0.25) {
    const p = at(rh), h = headroomOf(p, rh);
    if (h > 0.2 && h < 0.8) { partial = { rh, p, h }; break; }
  }
  assert.ok(partial, 'found a partial-taper RH');
  assert.ok(partial.p.L > 0 && partial.p.L < full(partial.rh), `L ${partial.p.L} in (0, ${full(partial.rh)})`);
  console.log(`    partial: rh ${partial.rh}, headroom ${partial.h.toFixed(2)} K, L ${partial.p.L.toFixed(3)} of ${full(partial.rh).toFixed(3)}`);
  /* CONTINUOUS, NOT FLAT. The taper closes over 1 K of headroom, which is ~5 % RH at 0 C, while
     the day's full latent term is ~13 K in the greenest cell at wind 0.33 (k = 0.027): so the
     ramp is steep -- about 3 K per 1 % RH -- but it is a ramp. A hard cutoff would be a 13 K
     step. The pin is that no 0.1 % RH change moves the cell by more than 0.5 K. */
  const cell = (rh) => M.eqCell(at(rh), 0.19, 0.878, 0);
  let fine = 0, coarse = 0;
  for (let rh = 30; rh < 99.9; rh += 0.1) {
    fine = Math.max(fine, Math.abs(cell(rh + 0.1) - cell(rh)));
    coarse = Math.max(coarse, Math.abs(cell(rh + 1) - cell(rh)));
  }
  console.log(`    largest greenest-cell step: ${fine.toFixed(3)} K per 0.1 % RH, ${coarse.toFixed(3)} K per 1 % RH`);
  assert.ok(fine <= 0.5, `step ${fine} K per 0.1 % RH`);
});

/* ── (e) canonical builders unchanged ──────────────────────────────────────── */
test('(e) peak, night and Compare builders are unchanged for ordinary forcing, and peak never tapers', () => {
  for (const sc of ['kolkata', 'bengaluru', 'amsterdam']) for (const live of [
    { tAir: 34, rh: 50, wind: 9, cloud: 10, feels: 37 }, { tAir: 30, rh: 90, wind: 6, cloud: 70, feels: 38 },
    { tAir: 0, rh: 100, wind: 1, cloud: 0, feels: 0 }, { tAir: -5, rh: 100, wind: 0, cloud: 100, feels: -8 }]) {
    const rh = live.rh, cloud = live.cloud / 100, s = state(SCOPES[sc], live, null, { phase: 'peak' });
    const baseTair = live.tAir + delta(s);
    const b = { ...DEFAULT_PARAMS, D: M.SIM_D, Q: DEFAULT_PARAMS.Q, wind: windOf(live.wind), L: DEFAULT_PARAMS.L * M.evapScale(rh) };
    const oldPeak = { ...b, sun: 1 * M.legacyCloudTransmission(cloud), tAir: baseTair, tSky: skyTemperatureC(baseTair, rh, cloud) };
    sameFields(M.currentParams(s), oldPeak, `${sc} peak ${JSON.stringify(live)}`);
    const ref = M.currentParamsForReference(live, 'peak', IV);
    assert.ok(Object.is(ref.L, DEFAULT_PARAMS.L * M.evapScale(rh)), 'compare peak L');
    assert.ok(headroomOf(oldPeak, rh) > TAPER_K, 'full noon sun keeps the surface well above the dewpoint');
  }
  // heatwave override rides the same path
  const hw = state(SCOPES.kolkata, { tAir: 31, rh: 80, wind: 6, cloud: 20, feels: 36 }, 0.7, { heatTairC: 41 });
  assert.ok(M.currentParams(hw).L > 0);
  assert.ok(STORE_NIGHT > 0 && Q_NIGHT_RATIO === 0.5);
});
