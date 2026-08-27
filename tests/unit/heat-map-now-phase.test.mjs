import assert from 'node:assert/strict';
import test from 'node:test';

import { currentParams, SUN_LIT } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';
import { solarElevationFactor } from '../../src/scripts/climate-engine/sky.ts';
import {
  ACCURACY, TRANSITION_HOURS, TRANSITION_RMSE_K, isTransitionHour,
} from '../../src/scripts/climate-engine/accuracy.ts';

const AMBIENT = { tAir: 27.6, rh: 96, wind: 2.1, cloud: 95, feels: 34.2 };
const IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
/* The scope constants the physics now takes as a parameter — read from the shipped
   registry, not re-typed here, so a drifted registry fails these tests too. */
const CLIMATE = resolve('in/kolkata/ballygunge').climate;
const scenario = (over) => ({ live: AMBIENT, phase: 'peak', path: '2025', climate: CLIMATE, iv: IV, ...over });

test('the canonical peak applies noon sun regardless of when you look', () => {
  // This is the incoherence "now" exists to sit beside, not a defect to fix:
  // the 13:00 view is a SCENARIO, so it uses full insolation whatever the hour.
  // Pinning it here means a future edit cannot quietly make the scenario
  // time-dependent and change what the published peak figure refers to.
  const p = currentParams(scenario({ sunNow: null }));
  assert.ok(p.sun > 0, 'peak must carry a shortwave term');
  assert.equal(p.tAir, AMBIENT.tAir, 'peak takes the observed air temperature as-is');
  assert.ok(!p.store, 'peak carries no nocturnal storage release');
});

test('"now" after dark runs night physics on the OBSERVED air temperature', () => {
  const p = currentParams(scenario({ sunNow: 0 }));
  assert.equal(p.sun, 0, 'no sun below the horizon');
  assert.ok(p.store && p.store > 0, 'night must release stored heat');
  // The canonical 22:00 view subtracts 2.5 K as a "retained conditions"
  // convention. "Now" must NOT: the reading and the hour describe the same
  // moment, so inventing a 2.5 K drop would be modelling a different one.
  assert.equal(p.tAir, AMBIENT.tAir, '"now" uses the air temperature as observed');
  const retained = currentParams(scenario({ phase: 'night', sunNow: null }));
  assert.ok(retained.tAir < p.tAir, 'the retained convention is the one that shifts air');
});

test('"now" in daylight scales the sun by real elevation, not a flat 1', () => {
  const noon = currentParams(scenario({ sunNow: solarElevationFactor(12, 100) }));
  const mid = currentParams(scenario({ sunNow: solarElevationFactor(9, 100) }));
  assert.ok(noon.sun > mid.sun, '9am must carry less shortwave than noon');
  assert.ok(mid.sun > 0, '9am is daylight');
  assert.ok(!mid.store, 'daylight carries no storage release');
});

test('the day/night branch follows the sun across the seasons', () => {
  // A fixed clock hour would be wrong at the solstices: Kolkata's sunrise moves
  // ~40 min across the year. Both of these are 06:00 local solar.
  const june = solarElevationFactor(6, 172);   // near summer solstice
  const dec = solarElevationFactor(6, 355);    // near winter solstice
  assert.ok(june > dec, 'the sun is higher at 06:00 in June than in December');
  // The threshold must actually separate them, which a clock cutoff cannot.
  assert.ok(june > SUN_LIT && dec < SUN_LIT,
    `SUN_LIT=${SUN_LIT} should split June (${june.toFixed(3)}) from December (${dec.toFixed(3)})`);
});

test('the sunrise window is flagged, and its published band is not claimed there', () => {
  const [lo, hi] = TRANSITION_HOURS;
  assert.ok(isTransitionHour(lo), 'the window is inclusive at its start');
  assert.ok(isTransitionHour((lo + hi) / 2), 'the middle of the window is in it');
  assert.ok(!isTransitionHour(hi), 'the window is exclusive at its end');
  assert.ok(!isTransitionHour(13), 'midday is covered by the peak figure');
  assert.ok(!isTransitionHour(2), 'the small hours are covered by the night figure');

  // The whole point of flagging it: the measured error there is far worse than
  // either published band, so quoting one would understate it.
  assert.ok(TRANSITION_RMSE_K > ACCURACY.peak.bandK,
    'a flagged window must be worse than the daytime band, or it needs no flag');
  assert.ok(TRANSITION_RMSE_K > ACCURACY.night.bandK);

  // Landsat's 10:30 anchor is 2.25 K out-of-sample; shading it would overstate
  // the caveat, so the window must end before it.
  assert.ok(hi <= 10.39, 'the window must stop short of the validated 10:30 stratum');
});
