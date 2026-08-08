import assert from 'node:assert/strict';
import test from 'node:test';

import { CANONICAL_GRID_VERSION, HEAT_METRICS_VERSION } from '../../src/scripts/climate-engine/types.ts';
import { fromPairedWireResult, toPairedWireResult } from '../../src/scripts/climate-engine/compare/paired-protocol.ts';

const ward = (id) => ({
  ward: id,
  wardData: { center: [0, 0], sizeM: 1400, count: 0, b: [] },
  roads: { ways: [] },
  field: new Float32Array(192 * 192).fill(33),
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
    forcingId: 'delta-screening-reference-v1', forcingStatus: 'fallback-reference', modelVersion: 'heat-model-v1',
    gridVersion: CANONICAL_GRID_VERSION, dataVersion: 'ward-geometry-v1', stockBasis: 'modelled-stock-v1',
    backendVersion: 'ts-worker-v1', metricsVersion: HEAT_METRICS_VERSION, screening: true,
  },
});

test('paired wire results transfer static render assets only once per known key', () => {
  const result = {
    a: ward('ballygunge'), b: ward('baruipur'),
    forcing: { id: 'delta-screening-reference-v1', status: 'fallback-reference', label: 'Reference', source: 'test', referenceLocation: null, referenceDate: null, values: {} },
    settledAt: '2026-01-01T00:00:00.000Z', contract: 'paired-coverage-v1',
  };
  const first = toPairedWireResult(result, new Set());
  assert.ok(first.a.renderAsset);
  assert.ok(first.b.renderAsset);
  const assets = new Map([[first.a.assetKey, first.a.renderAsset], [first.b.assetKey, first.b.renderAsset]]);
  const full = fromPairedWireResult(first, assets);
  assert.equal(full.a.wardData.sizeM, 1400);
  const second = toPairedWireResult(result, new Set(assets.keys()));
  assert.equal(second.a.renderAsset, undefined);
  assert.equal(second.b.renderAsset, undefined);
});
