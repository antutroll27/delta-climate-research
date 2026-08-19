import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { ACCURACY } from '../../src/scripts/climate-engine/accuracy.ts';

/* accuracy.ts is hand-maintained, and it feeds the headline error bars on
   /uncertainty and every ward API payload. It had no artefact behind it and no
   freshness guard, so when the model was re-fitted the constants stayed put and
   the published night band ended up BELOW the measured out-of-sample error.
   Nothing failed; an audit found it.

   These tests do not demand equality — recalibrating peak would make daytime
   out-measure night and qualify as quantitative, which model-accuracy.json's own
   `pending_recalibration` reserves for a reviewed human change. They enforce the
   SAFETY DIRECTION instead: whatever the artefact says, the published band may
   overstate our error but must never understate it. */
const art = JSON.parse(readFileSync('data/calibration/model-accuracy.json', 'utf8')).ward_scale.strata;

const PHASE_STRATUM = { night: 'night', peak: 'peak_ecostress' };

test('the published band never understates the artefact\'s out-of-sample error', () => {
  for (const [phase, stratum] of Object.entries(PHASE_STRATUM)) {
    const measured = art[stratum]?.loo_overpass_rmse_K;
    assert.ok(typeof measured === 'number', `${stratum}: no loo_overpass_rmse_K in the artefact`);
    assert.ok(ACCURACY[phase].bandK >= measured,
      `${phase}: published band ±${ACCURACY[phase].bandK} K is BELOW the measured leave-one-overpass-out error ${measured} K`);
  }
});

test('the leave-one-overpass-out figure we publish is the one the artefact measured', () => {
  for (const [phase, stratum] of Object.entries(PHASE_STRATUM)) {
    assert.equal(ACCURACY[phase].looOverpassRmseK, art[stratum].loo_overpass_rmse_K,
      `${phase}: accuracy.ts has drifted from model-accuracy.json`);
  }
});

test('a pending recalibration is declared, not silently carried', () => {
  const ws = JSON.parse(readFileSync('data/calibration/model-accuracy.json', 'utf8')).ward_scale;
  // peak's constants knowingly predate the current evidence set. That is a
  // defensible choice; carrying it WITHOUT saying so is not.
  if (ACCURACY.peak.n !== art.peak_ecostress.n_scenes) {
    assert.ok(ws.pending_recalibration,
      'peak n disagrees with the artefact, so model-accuracy.json must declare pending_recalibration');
    assert.match(JSON.stringify(ws.pending_recalibration), /reviewed change/i);
  }
});
