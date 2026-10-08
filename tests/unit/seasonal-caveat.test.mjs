import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  SEASONAL_CAVEATS, seasonalCaveat, seasonalCaveatLine, monthSpan,
} from '../../src/scripts/climate-engine/accuracy.ts';

/* The seasonal caveat (2026-10-05). Its months and figures are read from
   data/calibration/seasonal-caveat.json, written by
   scripts/measure-displayed-vs-calibrated.py. These tests pin the RULE (which date
   shows it) and check that the page prints the artefact's numbers, not typed ones.

   Since the ventilation damping came out (PR #48) the displayed field is the
   calibrated one. Pre-monsoon Landsat is then 3.88 K, inside ±4.5, so no DAYTIME
   caveat survives. Pre-monsoon night (3.06 K against ±3.0) is the one left. */
const art = JSON.parse(readFileSync('data/calibration/seasonal-caveat.json', 'utf8'));
const full = JSON.parse(readFileSync('data/calibration/displayed-vs-calibrated.json', 'utf8'));
const PRE = 'pre-monsoon (Mar-Jun)';

test('an April night in Ballygunge carries the dry-season caveat, October does not', () => {
  const april = seasonalCaveat('ballygunge', 4, 'night');
  assert.ok(april, 'April night must carry the caveat');
  assert.equal(april.sensor, 'ECOSTRESS');
  assert.equal(seasonalCaveat('ballygunge', 10, 'night'), null);
  assert.equal(seasonalCaveat('ballygunge', 10, 'peak'), null);
});

test('no daytime caveat survives: the pre-monsoon daytime band holds for the displayed field', () => {
  for (let m = 1; m <= 12; m++) {
    assert.equal(seasonalCaveat('ballygunge', m, 'peak'), null, `month ${m} by day`);
  }
  const day = full.strata.morning_landsat.by_season[PRE].displayed_settled;
  assert.ok(day.rmse_K <= 4.5 && day.loo_overpass_rmse_K <= 4.5,
    `pre-monsoon Landsat ${day.rmse_K} / ${day.loo_overpass_rmse_K} K should sit inside ±4.5`);
});

test('the night boundaries are the months with night rows: Feb no, Mar–Apr yes, May no', () => {
  assert.equal(seasonalCaveat('baruipur', 2, 'night'), null);
  assert.ok(seasonalCaveat('baruipur', 3, 'night'));
  assert.ok(seasonalCaveat('baruipur', 4, 'night'));
  assert.equal(seasonalCaveat('baruipur', 5, 'night'), null);
});

test('wards the measurement does not cover (Bengaluru) get no caveat', () => {
  assert.equal(seasonalCaveat('whitefield', 4, 'night'), null);
});

test('the printed figures are the artefact\'s, and the artefact is the harness\'s', () => {
  assert.deepEqual(SEASONAL_CAVEATS, art.caveats);
  const night = seasonalCaveat('ballygunge', 4, 'night');
  const src = full.strata.night.by_season[PRE].displayed_settled;
  assert.equal(night.bias_K, src.bias_K);
  assert.equal(night.rmse_K, src.rmse_K);
  assert.ok(night.rmse_K > night.band_K, 'a caveat is only listed when the band fails');
  assert.equal(night.ward_68.bias_K,
    full.strata.night.ward_68_only.by_season[PRE].displayed_settled.bias_K);
  assert.equal(seasonalCaveatLine(night),
    `Dry-season reading: the modelled surface runs at night ~${src.bias_K.toFixed(1)}–${night.ward_68.bias_K.toFixed(1)} °C `
    + 'warm in Mar–Apr against ECOSTRESS');
});

test('monthSpan names a run and a gap', () => {
  assert.equal(monthSpan([3, 4, 5, 6]), 'Mar–Jun');
  assert.equal(monthSpan([4]), 'Apr');
  assert.equal(monthSpan([3, 5]), 'Mar, May');
});
