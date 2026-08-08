import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALL_GREEN_REFERENCE,
  DEFAULT_PARAMS,
  HEAT_METRICS_VERSION,
  STORE_NIGHT,
  allGreenReferenceC,
  equilibriumC,
  greenReferenceContrastC,
} from '../../src/scripts/climate-engine/types.ts';

test('the all-green reference delegates to the declared equilibrium cell', () => {
  const params = { ...DEFAULT_PARAMS, store: 0 };
  assert.equal(
    allGreenReferenceC(params),
    equilibriumC(params, ALL_GREEN_REFERENCE.albedo, ALL_GREEN_REFERENCE.vegetation, ALL_GREEN_REFERENCE.built),
  );
  assert.equal(greenReferenceContrastC(42, params), 42 - allGreenReferenceC(params));
});

test('the retained all-green reference includes storage omitted by the legacy formula', () => {
  const params = { ...DEFAULT_PARAMS, sun: 0, store: STORE_NIGHT, wind: 1.2 };
  const k = params.kRad + params.h * params.wind;
  const legacy = (params.S * 0.75 * params.sun - params.L + params.kRad * params.tSky
    + params.h * params.wind * params.tAir) / k;
  assert.ok(Math.abs(allGreenReferenceC(params) - legacy - params.store / k) < 1e-10);
});

test('derived heat evidence identifies the corrected metric contract', () => {
  assert.equal(HEAT_METRICS_VERSION, 'heat-metrics-v2');
});
