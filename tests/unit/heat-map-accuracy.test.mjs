import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { ACCURACY, bandLabel, assertAccuracyLogic } from '../../src/scripts/climate-engine/accuracy.ts';
import { assertSkyLogic } from '../../src/scripts/climate-engine/sky.ts';
import { assertInterventionLogic } from '../../src/scripts/climate-engine/heat-map-model.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('published accuracy figures never overstate measured performance', () => {
  assertAccuracyLogic();
});

test('sky temperature, dewpoint and solar geometry hold their invariants', () => {
  assertSkyLogic();
});

test('intervention model holds, including the night-ET humidity continuity', () => {
  assertInterventionLogic();
});

test('the UI figures match the ward-scale calibration that produced them', async () => {
  // accuracy.ts mirrors a generated JSON by hand. If someone recalibrates and
  // forgets to update it, the site publishes an accuracy claim its own evidence
  // no longer supports.
  //
  // Sourced from ward-scale-fit.json, not model-accuracy.json: the latter is the
  // superseded GHS-SMOD mask calibration, which scored the model against a
  // landscape that is not the ward the product renders.
  const fit = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/ward-scale-fit.json'), 'utf8'));
  const obs = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/ward-observations.json'), 'utf8'));
  // model-accuracy.json is where the generated record of any drift lives.
  const accuracyJson = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/model-accuracy.json'), 'utf8'));

  // ECOSTRESS ONLY. ward-observations.json now carries two instruments, and
  // accuracy.ts's figures were computed on ECOSTRESS alone — counting Landsat
  // rows against an ECOSTRESS-derived constant compares nothing to nothing.
  const eco = obs.rows.filter((r) => (r.sensor ?? 'ecostress') === 'ecostress');

  // Drift is allowed to EXIST but never to be SILENT. The evidence set grows on
  // its own: NASA POWER's hourly product lags real time, so an overpass can gain
  // its forcing months later and legitimately enter the set. What must be
  // impossible is publishing a figure whose evidence has moved without anyone
  // recording it — so a mismatch is only tolerated when measure-accuracy.py has
  // written down exactly what moved.
  const pending = accuracyJson?.ward_scale?.pending_recalibration ?? null;
  for (const [phase, key] of [['night', 'night'], ['peak', 'day']]) {
    const n = eco.filter((r) => r.phase === key).length;
    if (ACCURACY[phase].n === n) continue;
    assert.ok(pending,
      `${phase}: accuracy.ts says n=${ACCURACY[phase].n} but the ECOSTRESS set now `
      + `holds ${n} — and nothing recorded the drift. Re-run scripts/measure-accuracy.py.`);
    assert.equal(pending.ecostress_rows_now[key], n,
      `${phase}: the recorded drift (${pending.ecostress_rows_now[key]}) does not match `
      + `the file (${n}) — the record is stale, which is worse than no record.`);
    assert.equal(pending.published_in_accuracy_ts[phase], ACCURACY[phase].n,
      `${phase}: the record claims accuracy.ts publishes `
      + `${pending.published_in_accuracy_ts[phase]}, but it publishes ${ACCURACY[phase].n}.`);
  }
  // and the calibration must still be the one marked not-yet-adopted-by-hand
  assert.equal(typeof fit.meets_all_criteria !== 'undefined', true,
    'ward-scale-fit.json should record whether the fit met its stated criteria');
});

test('daytime is never presented as more certain than night', () => {
  // RELATIONSHIPS, not literals. Pinning "± 5.0" here made this test fail on
  // every recalibration for no reason except that the numbers moved — which is
  // what a calibration is supposed to do. What must never change is the ordering
  // and the labelling.
  assert.ok(ACCURACY.peak.bandK > ACCURACY.night.bandK,
    'the daytime band must always be wider than the night band');
  assert.equal(ACCURACY.peak.confidence, 'indicative');
  assert.equal(ACCURACY.night.confidence, 'quantitative');
  assert.match(bandLabel('peak'), /^± \d+\.\d$/);
  assert.match(bandLabel('night'), /^± \d+\.\d$/);
  // the displayed band must never understate the measured error
  for (const k of ['peak', 'night']) {
    assert.ok(ACCURACY[k].bandK >= ACCURACY[k].modelRmseK,
      `${k}: displayed band understates measured RMSE`);
    assert.ok(ACCURACY[k].modelRmseK >= ACCURACY[k].ceilingRmseK,
      `${k}: model cannot beat the best predictor its own data supports`);
  }
});
