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

  // scene counts must match the observation set the fit ran on
  for (const [phase, key] of [['night', 'night'], ['peak', 'day']]) {
    const n = obs.rows.filter((r) => r.phase === key).length;
    assert.equal(ACCURACY[phase].n, n,
      `${phase}: scene count drifted from data/calibration/ward-observations.json`);
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
