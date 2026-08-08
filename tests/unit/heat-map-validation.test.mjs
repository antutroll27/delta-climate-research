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
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import * as M from '../../src/scripts/climate-engine/heat-map-model.ts';
import { DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';

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

test('L is scaled by humidity across a factor of two, so single-point checks are not bounds', () => {
  assert.ok(Math.abs(peakAt(0).L / peakAt(100).L - 2) < 1e-9, 'evap spans 1.2x to 0.6x of the constant');
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

test('KNOWN DEFECT: the evap ramp drives the ET term past its own physical bar in dry air', () => {
  /* NOT a passing grade — a pinned defect, so it cannot widen unnoticed.
     currentParams scales L by evap = 0.6 + 0.6*(1 - rh/100), which keeps RAISING
     evapotranspiration as the air dries and has no upper anchor. Real plants do
     the opposite: stomata close under high vapour-pressure deficit and ET falls.
     Meanwhile the 4 K headroom SHRINKS as the sky dries. The two cross at about
     22% rh — and our own ward-observations archive records humidity down to
     14.1%, so this is reachable on observed weather, not only in a corner case.

     If this test fails, the crossing point has MOVED. Re-derive; do not retune
     the expectation. */
  const crossing = (() => {
    for (let rh = 100; rh >= 1; rh--) if (vegBelowAirOf(peakAt(rh)) > 4) return rh + 1;
    return 0;
  })();
  assert.ok(crossing >= 20 && crossing <= 24,
    `the bar is expected to break just below ~22% rh; measured ${crossing}%`);
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
  assert.ok(vegBelowAirOf(peakAt(22, { heatTairC: 48 })) > 4,
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
