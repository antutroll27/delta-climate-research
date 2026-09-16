import assert from 'node:assert/strict';
import test from 'node:test';

import { createPairedScenarioCache, runPairedScenarioCore } from '../../src/scripts/climate-engine/compare/paired-core.ts';
import { assertPairedResult } from '../../src/scripts/climate-engine/compare/paired-protocol.ts';
import { classifyPairedFailure } from '../../src/scripts/climate-engine/compare/paired-worker.ts';
import { assertHeatRequest } from '../../src/scripts/climate-engine/sim-protocol.ts';
import { gridVersion, HEAT_METRICS_VERSION, requireGrid } from '../../src/scripts/climate-engine/types.ts';

/**
 * The paired worker classifies failures by matching message TEXT. A refusal
 * whose wording matches no branch falls through to `calculation-failed`, which
 * reports a REJECTED REQUEST to the visitor as a failed calculation — telling
 * them the sum broke when in fact we declined to do it.
 *
 * THAT HAS ALREADY HAPPENED ONCE ON THIS BRANCH, when `assertPairedResult`
 * stopped saying "canonical grid". Until now the only thing pinning any of this
 * wording was a single `/admitted/i` in heat-grid-pairs.test.mjs.
 *
 * EVERY MESSAGE BELOW IS PRODUCED BY CALLING THE REAL THROW SITE. Not one is a
 * copied string literal, because a copied literal drifts with the source and
 * pins nothing — it would keep passing through exactly the change it exists to
 * catch.
 */
function thrownBy(fn) {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return assert.fail('the real throw site did not throw, so this test pins nothing');
}

async function rejectedBy(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  return assert.fail('the real throw site did not reject, so this test pins nothing');
}

const N = requireGrid(1400).n;

const wardResult = (id) => ({
  ward: id,
  wardData: { center: [0, 0], sizeM: 1400, count: 0, b: [] },
  roads: { ways: [] },
  field: new Float32Array(N * N).fill(33),
  baselineMeanC: 35,
  scenarioMeanC: 33,
  coolingC: 2,
  baselineHotAreaPct: { state: 'evaluated', value: 50, unit: 'percent' },
  scenarioHotAreaPct: { state: 'evaluated', value: 20, unit: 'percent' },
  hotAreaChangePp: { state: 'evaluated', value: -30, unit: 'percentage-points' },
  greenReferenceContrastC: 4,
  capitalCost: 1,
  delivered: { treeCorridorCells: 1, roofAreaM2: 1, facadeIntensityPct: 1, requestedParkHa: 0, appliedParkHa: 0 },
  evidence: {
    forcingId: 'delta-screening-reference-v1', forcingStatus: 'fallback-reference',
    modelVersion: 'heat-model-v1', gridVersion: gridVersion(1400), dataVersion: 'ward-geometry-v1',
    stockBasis: 'modelled-stock-v1', backendVersion: 'ts-worker-v1',
    metricsVersion: HEAT_METRICS_VERSION, screening: true,
  },
});

const pairedResult = () => ({
  a: wardResult('ballygunge'),
  b: wardResult('baruipur'),
  forcing: {
    id: 'delta-screening-reference-v1', status: 'fallback-reference', label: 'Reference',
    source: 'test', referenceLocation: null, referenceDate: null, values: {},
  },
  settledAt: '2026-01-01T00:00:00.000Z',
  contract: 'paired-coverage-v1',
});

test('requireGrid refusing an unadmitted ward size is a bad request', () => {
  const error = thrownBy(() => requireGrid(900));
  assert.equal(classifyPairedFailure(error).code, 'invalid-request',
    `an unadmitted ward size is a request we declined, not a calculation that failed: ${error.message}`);
});

test('assertHeatRequest refusing a mismatched pair is a bad request', () => {
  const layer = () => new Float32Array(384 * 384);
  const error = thrownBy(() => assertHeatRequest({
    generation: 0,
    grid: { n: 384, cellMeters: 1400 / 384 },
    layers: { albedo: layer(), veg: layer(), built: layer(), water: layer() },
    params: {}, settleSteps: 0, thresholdC: 30, sizeM: 1400,
  }));
  assert.equal(classifyPairedFailure(error).code, 'invalid-request', error.message);
});

test('assertPairedResult refusing a wrongly sized field is a bad request', () => {
  const result = pairedResult();
  result.a.field = new Float32Array(9);
  const error = thrownBy(() => assertPairedResult(result));
  assert.equal(classifyPairedFailure(error).code, 'invalid-request', error.message);
});

test('assertPairedResult refusing a broken shared contract is classified as a contract failure', () => {
  const result = pairedResult();
  result.b.evidence = { ...result.b.evidence, modelVersion: 'heat-model-v2' };
  const error = thrownBy(() => assertPairedResult(result));
  assert.equal(classifyPairedFailure(error).code, 'contract-failed', error.message);
});

test('the same ward on both sides is a bad request', async () => {
  const error = await rejectedBy(() => runPairedScenarioCore(
    { a: 'ballygunge', b: 'ballygunge', forcing: 'delta-screening-reference-v1', coverage: {} },
    createPairedScenarioCache(), {}));
  assert.equal(classifyPairedFailure(error).code, 'invalid-request', error.message);
});

test('assertPairedResult refusing the same ward on both sides is a bad request', () => {
  const result = pairedResult();
  result.b = wardResult('ballygunge');
  const error = thrownBy(() => assertPairedResult(result));
  assert.match(error.message, /distinct wards/,
    `this test pins assertPairedResult's OWN refusal, not paired-core's: ${error.message}`);
  assert.equal(classifyPairedFailure(error).code, 'invalid-request',
    `declining a same-ward pair is a refusal, not a failed sum: ${error.message}`);
});

/* The fallback must stay a fallback: a genuine solver failure is still reported
   as one. A classifier that called everything a bad request would pass every
   test above and be just as wrong. */
test('an error from no known throw site still falls through to calculation-failed', () => {
  assert.equal(classifyPairedFailure(new Error('the solver diverged')).code, 'calculation-failed');
});
