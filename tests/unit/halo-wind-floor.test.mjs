import assert from 'node:assert/strict';
import test from 'node:test';

import { currentParams, currentParamsForReference } from '../../src/scripts/climate-engine/heat-map-model.ts';
import { resolve } from '../../src/scripts/climate-engine/scope/resolve.ts';

/* THE HALO'S MARGIN DEPENDS ON A WIND FLOOR. City-streaming P0 (P0-RESULTS.md, note 2) measured the seam error of a
   tiled solve against a contiguous one: at the production calm floor (wind 0.3, lambda 73 m) a 60-cell halo leaves
   0.010 K against the 0.05 K pass mark, a 4x margin; with the wind forced to 0 (lambda 115 m) even 72 cells leave
   0.087 K and fail. So the pass holds ONLY while every route to a SimParams clamps wind at 0.3 or above. These two
   builders are the routes; if a third appears it must be added here. Nothing builds a halo yet: this pins the
   precondition before anything can. */

const CLIMATE = resolve('nl/amsterdam/canal-ring').climate;
const IV = { trees: 0, roof: 0, parks: 0, facades: 0 };
const WIND_READINGS = [0, 0.001, 0.3, 0.89, 0.9, 1, 2.4, 7.5, 8, 40, 1000, -3, -1e9];
const FLOOR = 0.3, CEILING = 2.5;

const live = (wind) => ({ tAir: 18, rh: 70, wind, cloud: 40, feels: 17 });

test('currentParams never lets wind fall below 0.3, in any phase, branch or reading', () => {
  let cases = 0;
  for (const wind of WIND_READINGS) {
    for (const phase of ['peak', 'night']) {
      for (const heatTairC of [null, 35]) {
        for (const sunNow of [undefined, 0.8, 0]) {                  // plain scenario, "now" lit, "now" dark
          for (const wet of [0, 1]) {
            const p = currentParams({ live: { ...live(wind), observed: { wet } }, phase, path: '2025', iv: IV, climate: CLIMATE,
              heatTairC, sunNow, clock: { month: 7, hour: 13 } });
            assert.ok(p.wind >= FLOOR && p.wind <= CEILING, `wind reading ${wind} gave p.wind = ${p.wind} (${phase}, heat ${heatTairC}, sunNow ${sunNow}, wet ${wet})`);
            cases++;
          }
        }
      }
    }
  }
  /* no live feed at all: the model's own default wind */
  for (const phase of ['peak', 'night']) {
    const p = currentParams({ live: null, phase, path: '2025', iv: IV, climate: CLIMATE, clock: { month: 7, hour: 13 } });
    assert.ok(p.wind >= FLOOR && p.wind <= CEILING, `no live feed: p.wind = ${p.wind}`);
    cases++;
  }
  assert.ok(cases === 314, `${cases} cases`);
});

test('currentParamsForReference (Compare) never lets wind fall below 0.3 either', () => {
  for (const wind of WIND_READINGS) {
    for (const phase of ['peak', 'night']) {
      const p = currentParamsForReference(live(wind), phase, IV);
      assert.ok(p.wind >= FLOOR && p.wind <= CEILING, `wind reading ${wind} gave p.wind = ${p.wind} (${phase})`);
    }
  }
});

test('the floor is the calm wind the P0 experiment ran at: a 0 m/s reading becomes exactly 0.3', () => {
  assert.equal(currentParams({ live: live(0), phase: 'peak', path: '2025', iv: IV, climate: CLIMATE, clock: { month: 7, hour: 13 } }).wind, FLOOR);
  assert.equal(currentParamsForReference(live(0), 'night', IV).wind, FLOOR);
});
