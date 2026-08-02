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
