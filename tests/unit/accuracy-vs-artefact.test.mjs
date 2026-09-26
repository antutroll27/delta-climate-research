import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { ACCURACY } from '../../src/scripts/climate-engine/accuracy.ts';
import { DEFAULT_PARAMS, STORE_NIGHT } from '../../src/scripts/climate-engine/types.ts';
import { skyTemperatureC } from '../../src/scripts/climate-engine/sky.ts';

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

/* 2026-09-24. measure-accuracy.py overlaid the matched candidate's fitted values, its
   free-fit q_day among them, on fit-ward-scale.py's SHIP defaults, so every re-run scored
   a model that does not ship and nothing noticed. The artefact now records what it
   scored; this pins every scored constant to what ships. ratio and release_built are
   fitted too, and match only because both rail to bounds that coincide with types.ts. */
test('the accuracy artefact scores the constants that ship', () => {
  const s = JSON.parse(readFileSync('data/calibration/model-accuracy.json', 'utf8')).ward_scale.scored;
  assert.ok(s, 'model-accuracy.json must record the constants it scored');
  assert.equal(s.q_day, DEFAULT_PARAMS.Q, 'measure-accuracy scored a q_day that does not ship');
  assert.equal(s.l_et, DEFAULT_PARAMS.L, 'measure-accuracy scored an ET coefficient that does not ship');
  // The fit splits a held kRad + h by ratio = kRad/h, rounded to 4 dp in ward-scale-fit.json.
  const ratio = DEFAULT_PARAMS.kRad / DEFAULT_PARAMS.h;
  assert.ok(Math.abs(s.ratio - ratio) < 5e-5, `measure-accuracy scored kRad/h ${s.ratio}, but types.ts ships ${ratio}`);
  // The browser releases a flat STORE_NIGHT at night; it has no built-scaled term.
  assert.equal(s.release_built, 0, 'measure-accuracy scored a built-scaled night release the browser does not have');
  assert.ok(Math.abs(s.release_base - STORE_NIGHT) < 5e-4,
    `measure-accuracy scored release_base ${s.release_base}, but STORE_NIGHT ships ${STORE_NIGHT}`);
  // The browser calls skyTemperatureC with its default Brutsaert c.
  assert.equal(skyTemperatureC(28, 80, 0.3, s.c), skyTemperatureC(28, 80, 0.3),
    `measure-accuracy scored Brutsaert c ${s.c}, which is not sky.ts's default`);
});
