/**
 * Invariants over the committed validation artefacts.
 *
 * These guard the honesty rules the campaign was built on, not the numbers
 * themselves — the numbers move whenever the archive grows, and that is fine.
 * What must never move: a morning reading is never counted as a peak reading,
 * a blocked sensor pooling never produces a pooled figure anyway, and the
 * confidence interval always contains the estimate it describes.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as M from '../../src/scripts/climate-engine/heat-map-model.ts';
import { DEFAULT_PARAMS, STORE_NIGHT } from '../../src/scripts/climate-engine/types.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));

const ACCURACY = await read('data/calibration/model-accuracy.json');
const LANDSAT = await read('data/calibration/landsat-ward-lst.json');
const OBS = await read('data/calibration/ward-observations.json');

test('Landsat rows sit on the descending node, not wherever they landed', () => {
  // Every row within a hair of 10:30 local solar is what a sun-synchronous
  // orbit looks like. A row outside this window means the time base drifted,
  // and a drifted time base is how morning readings end up in a peak stratum.
  for (const r of LANDSAT.rows) {
    assert.ok(r.hour_lst >= 9.5 && r.hour_lst <= 11.5,
      `${r.scene_id}/${r.ward} at ${r.hour_lst} h is off the descending node`);
  }
  const dates = new Set(LANDSAT.rows.map((r) => r.date));
  assert.equal(LANDSAT.overpasses, dates.size);
  assert.ok(LANDSAT.overpasses > 12,
    'the campaign exists to beat 12 daytime overpasses');
});

test('the reference reports its own uncertainty, and it is small enough to matter', () => {
  const q = LANDSAT.rows.map((r) => r.st_qa_mean_k);
  assert.ok(q.every((v) => typeof v === 'number' && v > 0));
  const mean = q.reduce((a, b) => a + b, 0) / q.length;
  // A validation reference whose own error approaches the error being measured
  // has stopped being an independent check. The daytime model error is ~4.4 K.
  assert.ok(mean < 3.0, `reference uncertainty ${mean.toFixed(2)} K is too close to the model's`);
  assert.ok(q.every((v) => v <= LANDSAT.mask.st_qa_max_k + 1e-9),
    'a row survived that exceeds the stated ST_QA ceiling');
});

test('every observation says which instrument saw it', () => {
  const sensors = new Set(OBS.rows.map((r) => r.sensor));
  for (const s of sensors) assert.ok(['ecostress', 'landsat'].includes(s), `unknown sensor ${s}`);
  // Unlabelled rows would silently default to one sensor downstream, which is
  // exactly the pooling mistake the stratification exists to prevent.
  assert.ok(OBS.rows.every((r) => typeof r.sensor === 'string'));
});

test('ward-scale validation is stratified, bounded and honestly split', (t) => {
  const ws = ACCURACY.ward_scale;
  if (!ws) return t.skip('ward_scale block absent — run scripts/measure-accuracy.py');

  assert.equal(ws.bootstrap.seed, 7, 'a silent seed change silently moves a published CI');
  assert.equal(ws.bootstrap.unit, 'overpass',
    'resampling ward-scenes would treat three wards on one pass as three facts');
  assert.match(ws.method, /overpass/i);

  for (const [name, s] of Object.entries(ws.strata)) {
    assert.ok(s.n_overpasses <= s.n_scenes, `${name}: more overpasses than scenes`);
    assert.ok(s.ci95_K[0] <= s.rmse_K && s.rmse_K <= s.ci95_K[1],
      `${name}: rmse ${s.rmse_K} outside its own CI ${JSON.stringify(s.ci95_K)}`);
    assert.ok(s.ci95_K[0] <= s.ci95_K[1], `${name}: inverted CI`);
  }

  // The stratification that the whole campaign turns on: 10:30 is not 13:00.
  const m = ws.strata.morning_landsat, p = ws.strata.peak_ecostress;
  if (m && p) {
    assert.ok(m.hour_range[1] <= p.hour_range[0],
      `morning (${m.hour_range}) overlaps peak (${p.hour_range})`);
  }

  // A blocked pooling must actually block, or the flag is decoration.
  if (ws.intercomparison.pooling === 'blocked') {
    assert.ok(!('day_pooled' in ws.strata),
      'pooling reported blocked but a pooled daytime stratum was published anyway');
  }
});

test('the shipping calibration reads one instrument unless told otherwise', async () => {
  // accuracy.ts names fit-ward-scale.py in its own regeneration recipe, and
  // ward-observations.json now holds two instruments. A loader that took every
  // row would refit the published calibration across ECOSTRESS and Landsat —
  // two instruments AND two times of day — at the same moment the
  // intercomparison reports their offset is not measurable on this archive.
  // "More evidence arrived" must never silently mean "the calibration moved".
  const src = await readFile(join(ROOT, 'scripts/fit-ward-scale.py'), 'utf8');
  assert.match(src, /DEFAULT_SENSORS[^\n]*=\s*\("ecostress",\)/,
    'fit-ward-scale must default to a single instrument');
  assert.match(src, /def load_rows\(sensors[^)]*=\s*DEFAULT_SENSORS\)/,
    'load_rows must apply that default rather than reading every row');

  // And the validation must be the thing that opts in, explicitly.
  const meas = await readFile(join(ROOT, 'scripts/measure-accuracy.py'), 'utf8');
  assert.match(meas, /load_rows\(sensors=None\)/,
    'the cross-sensor validation should opt in to both instruments by name');
});

test('more overpasses bought a tighter interval than the 12-scene baseline', (t) => {
  const ws = ACCURACY.ward_scale;
  if (!ws) return t.skip('ward_scale block absent');
  const s = ws.strata.morning_landsat;
  if (!s) return t.skip('no Landsat stratum');
  // The published daytime CI half-width before this campaign was +/-1.87 K over
  // 12 overpasses. The point of the exercise is to beat that; if a future change
  // loses scenes badly enough to give it back, this should fail loudly.
  assert.ok(s.ci95_halfwidth_K < 1.87,
    `half-width ${s.ci95_halfwidth_K} K did not improve on the 12-overpass baseline`);
});

/* ————— the ET coefficient L, and the region it actually sits in —————
   docs/green-score-methodology.md §4.2.1. These pin the re-derivation so it is
   reproducible, AND they pin a defect found while verifying it: at the dry tail
   of our own observed humidity the ET term exceeds the model's own physical bar.
   The published [0.40, 0.46] band is a FOSSIL — it cannot be reproduced from
   this model, and nothing here should be read as reinstating it. */

const ZERO_IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
const peakAt = (rh, over = {}) => M.currentParams({
  live: { tAir: 32, rh, wind: 3, cloud: 0 }, phase: 'peak', path: '2025', iv: ZERO_IV, ...over,
});
const parkDropOf = (p) => M.eqCell(p, 0.20, 0, 0) - M.eqCell(p, 0.20, 0.9, 0);
const vegBelowAirOf = (p) => p.tAir - M.eqCell(p, 0.25, 1.0, 0);
/** Largest effective L for which the 4 K bar still holds under this forcing. */
const maxLeffFor = (p) => {
  let lo = 0, hi = 3;
  for (let i = 0; i < 120; i++) {
    const m = (lo + hi) / 2;
    (p.tAir - M.eqCell({ ...p, L: m }, 0.25, 1.0, 0) <= 4) ? lo = m : hi = m;
  }
  return lo;
};

test('park cooling is exactly 15x the effective L — the identity every ceiling is inverted from', () => {
  for (const rh of [20, 40, 60, 80, 95]) {
    const p = peakAt(rh);
    assert.ok(Math.abs(parkDropOf(p) / p.L - 15) < 1e-9, `park cooling / L_eff must be 15 at rh ${rh}`);
  }
});

test('the humidity ramp is CAPPED at 1.0, and the cap binds only in dry air', () => {
  /* The cap is the fix from §4.2.2. Below rh 33.3 the ramp would have kept
     climbing to 1.2x; above it nothing changed, which is the whole point. */
  assert.equal(M.evapScale(0), 1, 'the ramp must not exceed 1.0 however dry the air');
  assert.equal(M.evapScale(20), 1, 'the cap binds in dry air');
  assert.ok(Math.abs(M.evapScale(33.4) - 1) < 2e-3, 'the cap releases around rh 33.3');
  assert.ok(Math.abs(M.evapScale(60) - 0.84) < 1e-9, 'ordinary humidity is untouched');
  assert.ok(Math.abs(M.evapScale(100) - 0.6) < 1e-9, 'the wet end is untouched');
  assert.ok(peakAt(0).L / peakAt(100).L < 1.7, 'the effective span must be narrower than the old 2x');
});

test('below ~35% rh the VEGETATED-SURFACE bar binds, not park cooling', () => {
  /* The first draft of §4.2.1 derived every ceiling from park cooling alone and
     was wrong for exactly this reason. Which bar binds is not a constant. */
  const parkCeil = (p) => (8.07 / 15) / (p.L / DEFAULT_PARAMS.L);
  const vegCeil = (p) => maxLeffFor(p) / (p.L / DEFAULT_PARAMS.L);
  for (const rh of [25, 30]) {
    const p = peakAt(rh);
    assert.ok(vegCeil(p) < parkCeil(p), `at rh ${rh} the vegetated-surface bar must be the binding one`);
  }
  for (const rh of [50, 60, 80]) {
    const p = peakAt(rh);
    assert.ok(parkCeil(p) < vegCeil(p), `at rh ${rh} park cooling must be the binding one`);
  }
});

test('RESIDUAL DEFECT: the bar still breaks below ~16% rh, down from 22%', () => {
  /* NOT a passing grade — a pinned residual, so it cannot widen unnoticed.
     Capping the ramp at 1.0 (§4.2.2) moved the crossing from 22% rh to 16% and
     cut observed-weather violations from 6 of 298 readings to 3. It did not
     eliminate them: below the cap the ET term is frozen while the 4 K headroom
     keeps shrinking with the drying sky, so a crossing must still exist
     somewhere. Closing it entirely needs a lower cap, which would reshape
     ordinary Kolkata humidity — the trade §4.2.2 tables and declines.

     If this test fails, the crossing has MOVED. Re-derive; do not retune the
     expectation to match. */
  const crossing = (() => {
    for (let rh = 100; rh >= 1; rh--) if (vegBelowAirOf(peakAt(rh)) > 4) return rh + 1;
    return 0;
  })();
  assert.ok(crossing >= 14 && crossing <= 18,
    `the bar is expected to break just below ~16% rh after the cap; measured ${crossing}%`);
  // Above the crossing the model is sound, and that is the great majority of weather.
  for (const rh of [30, 40, 54, 60, 80]) {
    assert.ok(vegBelowAirOf(peakAt(rh)) <= 4, `the bar must hold at rh ${rh}, well inside ordinary humidity`);
    assert.ok(parkDropOf(peakAt(rh)) <= 8.07, `park cooling must hold at rh ${rh}`);
  }
});

test('the heatwave overlay widens that defect rather than causing it', () => {
  /* From the rh-60 fallback every heatwave is fine, which is what the first
     draft measured and over-claimed from. Compounding an extreme overlay onto
     an already-dry reading is what breaks it. */
  for (const heatTairC of [38, 42, 45, 48]) {
    assert.ok(vegBelowAirOf(peakAt(60, { heatTairC })) <= 4, `from a 60% base, ${heatTairC} C must stay physical`);
    assert.ok(parkDropOf(peakAt(60, { heatTairC })) <= 8.07, `park cooling must hold at ${heatTairC} C`);
  }
  assert.ok(vegBelowAirOf(peakAt(16, { heatTairC: 48 })) > 4,
    'the dry-base + extreme-heatwave corner is known to violate; if it stops, the model changed');
});

test('night is not the binding phase — nightLatent cuts the ET term by an order of magnitude', () => {
  for (const rh of [20, 30, 60]) {
    const day = peakAt(rh);
    const night = M.currentParams({ live: { tAir: 32, rh, wind: 3, cloud: 0 }, phase: 'night', path: '2025', iv: ZERO_IV });
    assert.ok(night.L < day.L / 5, `night ET must be far below day ET at rh ${rh}`);
    assert.ok(vegBelowAirOf(night) <= 4, `the bar must hold at night at rh ${rh}`);
  }
});

test('Explore and Compare gate evapotranspiration identically', () => {
  /* These two forcings are separate functions with separate call sites, and this
     codebase has already been bitten once by them drifting — currentParamsForReference
     carries a comment about omitting the storage term making the views "disagree at
     night by ~1.7 K, and only one of them would be right". The humidity ramp is the
     same hazard: capping one copy and not the other would make Compare and Explore
     model different physics in dry air, silently and only for dry days. */
  for (const rh of [10, 22, 33, 45, 60, 85]) {
    const explore = M.currentParams({
      live: { tAir: 32, rh, wind: 3, cloud: 0 }, phase: 'peak', path: '2025', iv: ZERO_IV,
    });
    const compare = M.currentParamsForReference(
      { tAir: 32, rh, wind: 3, cloud: 0 }, 'peak', ZERO_IV,
    );
    assert.ok(Math.abs(explore.L - compare.L) < 1e-12,
      `at rh ${rh} Explore L=${explore.L} and Compare L=${compare.L} must be the same physics`);
  }
});

test('the shipped constants match the calibration run they came from', async () => {
  /* Q and STORE_NIGHT are candidate G's fitted values from fit-ward-scale.py.
     Capping the humidity ramp changed what that script trains on, so both were
     re-fitted and re-adopted — a model calibrated against one shape and executed
     with another is not calibrated. Nothing checked that correspondence before,
     which is exactly why it went unnoticed until a mutation test asked. */
  const fit = await read('data/calibration/ward-scale-fit.json');
  const g = fit.candidates.find((c) => c.key === 'G');
  assert.ok(g, 'candidate G is the one the shipped constants come from');
  assert.ok(Math.abs(g.fitted.q_day - DEFAULT_PARAMS.Q) < 5e-4,
    `shipped Q ${DEFAULT_PARAMS.Q} has drifted from candidate G's ${g.fitted.q_day} — re-run fit-ward-scale.py or explain why`);
  assert.ok(Math.abs(g.fitted.release_base - STORE_NIGHT) < 5e-4,
    `shipped STORE_NIGHT ${STORE_NIGHT} has drifted from candidate G's ${g.fitted.release_base}`);
  // l_et is bounded, not fitted — it must still be the constant §4.2.1 chose.
  assert.equal(g.fitted.l_et, DEFAULT_PARAMS.L, 'the fit must be run with the shipped L');
});

/* ————— the sun-up physical bar —————
   Pre-registered 2026-08-09 and applied to BOTH instruments. Two-thirds of the
   apparent ECOSTRESS-vs-Landsat disagreement was three ward-scenes where the
   observed surface sat further below the air than evapotranspiration can take it.
   These pin the rule, its control, and the fact that it never sees a residual. */

const SUN_UP = 0.5, MAX_BELOW_AIR_K = 4;
const dayRows = OBS.rows.filter((r) => r.phase === 'day');

test('no committed ward-scene has a sun-up surface implausibly far below air', () => {
  const bad = dayRows.filter((r) => r.sun > SUN_UP && (r.lst_mean_c - r.tAir) < -MAX_BELOW_AIR_K);
  assert.deepEqual(bad.map((r) => `${r.date}/${r.ward}`), [],
    'validate-model publishes 4 K as the bound for a FULLY vegetated surface at maximum ET; '
    + 'a part-built ward cannot beat it, so a sun-up row below it is a contaminated observation');
});

test('the bar is recorded in the artefact, with what it rejected', () => {
  const bar = OBS.sun_up_physical_bar;
  assert.ok(bar, 'the acceptance rule must travel with the data it shaped');
  assert.equal(bar.sun_up, SUN_UP);
  assert.equal(bar.max_below_air_K, MAX_BELOW_AIR_K);
  assert.match(bar.applies_to, /both instruments/i);
  assert.ok(bar.rejected_ecostress > 0, 'a rule that rejected nothing would not have been worth adding');
});

test('LANDSAT IS THE CONTROL — it must lose nothing to this bar', () => {
  /* This is what keeps the rule from being outlier-dropping. Landsat's stricter
     QA chain (ST_QA <= 3.0 K plus CFMask) already yields 0 unphysical scenes, so
     the bar is not merely a threshold tight enough to remove awkward data. If
     Landsat ever starts failing it, either the bar or that QA chain has moved and
     both are load-bearing. */
  const lan = dayRows.filter((r) => r.sensor === 'landsat');
  assert.ok(lan.length > 150, 'the control needs the full Landsat archive to mean anything');
  const worst = Math.min(...lan.map((r) => r.lst_mean_c - r.tAir));
  assert.ok(worst > -MAX_BELOW_AIR_K,
    `worst Landsat surface-minus-air is ${worst.toFixed(2)} K; Landsat has always cleared this bar`);
});

test('the rule BEHAVES as specified — run the Python, do not read it', () => {
  /* Source-scanning could not tell a working guard from a deleted one, and could
     not see the sun gate at all. Execute the function instead. */
  const cases = [
    // [lst, tAir, sun, accepted?, why]
    [22.3, 34.3, 0.82, false, 'sun up and 12 K below air is a cloud top, not a surface'],
    [27.1, 34.3, 0.82, false, 'sun up and 7 K below air is still past the bar'],
    [32.3, 34.3, 0.82, true, 'sun up and 2 K below air is ordinary evapotranspiration'],
    [22.3, 34.3, 0.10, true, 'THE SUN GATE: after sunset a surface legitimately falls below air'],
    [40.0, 34.3, 0.82, true, 'a surface above air is the normal daytime case'],
  ];
  const py = [
    'import importlib.util, sys, json',
    "sys.path.insert(0, 'scripts')",
    "spec = importlib.util.spec_from_file_location('bwo', 'scripts/build-ward-observations.py')",
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    `print(json.dumps([m.physical_daytime(a, b, c) for a, b, c in ${JSON.stringify(cases.map((c) => c.slice(0, 3)))}]))`,
  ].join('\n');
  const out = execFileSync('python3', ['-c', py], { cwd: ROOT, encoding: 'utf8' });
  const got = JSON.parse(out.trim().split('\n').pop());
  cases.forEach(([, , , want, why], i) => assert.equal(got[i], want, why));
});

test('both ingest paths actually call the rule', () => {
  /* A guard that exists but is never invoked is decoration. */
  const src = readFileSync(join(ROOT, 'scripts/build-ward-observations.py'), 'utf8');
  const calls = src.match(/if not physical_daytime\(/g) ?? [];
  assert.equal(calls.length, 2,
    'the bar must be applied on the ECOSTRESS path AND the Landsat path — the second is the control');
});

test('the rule reads only observations, never the model', () => {
  /* Non-circularity, pinned as source. A rule that consulted a residual or a
     fitted constant could launder a fitted result into an acceptance criterion. */
  const src = readFileSync(join(ROOT, 'scripts/build-ward-observations.py'), 'utf8');
  const start = src.indexOf('def physical_daytime');
  assert.ok(start > 0, 'physical_daytime must exist in the builder');
  // stop at the next top-level definition, so the assertion sees the function
  // and nothing after it
  const rest = src.slice(start + 1);
  const end = rest.search(/\n(?:def |[A-Z_]+ *=|#: )/);
  const fn = rest.slice(0, end > 0 ? end : 700);
  assert.match(fn, /lst_mean_c/);
  assert.match(fn, /t_air_c/);
  // Strip the docstring before scanning. The prose explains WHY the rule ignores
  // fitted values, so scanning it would match the very words it exists to disclaim.
  const code = fn.split('"""').filter((_, i) => i % 2 === 0).join('');
  assert.doesNotMatch(code, /predict|resid|rmse|fitted|_physics/,
    'physical_daytime must not reach for the model — that is what makes it non-circular');
});
