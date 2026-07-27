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

test('the UI figures match what measure-accuracy.py actually measured', async () => {
  // The TS module mirrors a generated JSON by hand. If someone regenerates the
  // calibration and forgets to update accuracy.ts, the site would publish an
  // accuracy claim that no longer matches its own evidence.
  const measured = JSON.parse(
    await readFile(join(ROOT, 'data/calibration/model-accuracy.json'), 'utf8'));
  for (const [phase, key] of [['night', 'night'], ['peak', 'day']]) {
    const m = measured.phases[key];
    const a = ACCURACY[phase];
    assert.equal(a.n, m.n, `${phase}: scene count drifted from the measurement`);
    assert.equal(a.ceilingRmseK, m.ceiling_rmse_K, `${phase}: ceiling drifted`);
    assert.equal(a.modelRmseK, m.model_rmse_K, `${phase}: model RMSE drifted`);
    assert.equal(a.bandK, m.reported_band_K, `${phase}: displayed band drifted`);
    assert.equal(a.confidence, m.confidence, `${phase}: confidence class drifted`);
  }
});

test('daytime is never presented as more certain than night', () => {
  assert.ok(ACCURACY.peak.bandK > ACCURACY.night.bandK);
  assert.equal(ACCURACY.peak.confidence, 'indicative');
  assert.equal(ACCURACY.night.confidence, 'quantitative');
  assert.equal(bandLabel('peak'), '± 5.0');
  assert.equal(bandLabel('night'), '± 3.5');
});
