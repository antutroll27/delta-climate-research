import assert from 'node:assert/strict';
import test from 'node:test';

import { assertDcUrsLogic, GOLDEN } from '../../src/scripts/climate-engine/dc-urs.ts';
import {
  applyScenario, areaScale, assertScenarioLogic, REFERENCE_WARD_M,
} from '../../src/scripts/climate-engine/dc-urs-scenario.ts';

/* THE ENGINE'S OWN SELF-CHECKS, WHICH NOTHING CALLED. assertDcUrsLogic and
   assertScenarioLogic were written, exported and never run by any test: a gate
   that cannot fail because it never executes. */
test('the DC-URS engine self-check holds', () => { assertDcUrsLogic(); });
test('the scenario self-check holds on every golden ward', () => {
  for (const g of GOLDEN) assertScenarioLogic(g.inputs);
});

const IV = { trees: 30, roof: 40, parks: 4, facades: 5 };
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

/* A 1400 m ward is the reference the gains were sized for, so it must be scored
   exactly as before the area scaling existed. Values are pinned by hand from
   SCENARIO, not recomputed by the code under test. */
test('a 1400 m ward moves exactly as before', () => {
  const base = GOLDEN[0].inputs;
  assert.deepEqual(applyScenario(base, IV, undefined, REFERENCE_WARD_M), applyScenario(base, IV));
  const r = applyScenario(base, IV);
  close(r.inputs.fvc.value, 0.12 + 0.6 * 0.12 + 0.4 * 0.06 + (5 / 15) * 0.01, 'fvc');
  close(r.inputs.albedo.value, 0.15 + 0.4 * 0.10, 'albedo');
  close(r.inputs.distCoolM.value, 800 - 0.4 * 220, 'distCoolM');
});

/* Bengaluru's wards are 2800 m, four times the area: the same package of trees,
   parks and roofs moves a ward mean a quarter as far. */
test('a 2800 m ward moves a quarter as far', () => {
  const base = GOLDEN[0].inputs;
  assert.equal(areaScale(2800), 0.25);
  const r = applyScenario(base, IV, undefined, 2800);
  close(r.inputs.fvc.value, 0.12 + 0.25 * (0.6 * 0.12 + 0.4 * 0.06 + (5 / 15) * 0.01), 'fvc');
  close(r.inputs.albedo.value, 0.15 + 0.25 * 0.4 * 0.10, 'albedo');
  close(r.inputs.distCoolM.value, 800 - 0.25 * 0.4 * 220, 'distCoolM');
  assert.equal(r.active, true, 'a scaled plan is still an active plan');
});

test('a ward size that is not positive is refused, not scored', () => {
  assert.throws(() => areaScale(0), RangeError);
  assert.throws(() => areaScale(Number.NaN), RangeError);
});
