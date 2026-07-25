import { CANONICAL_GRID_N, CANONICAL_GRID_VERSION, type SimLayers, type SimParams } from '../types.ts';
import { TsHeatSim } from '../sim-ts.ts';
import {
  applyInterventions,
  buildSpatial,
  computeCost,
  currentParamsForReference,
  RESET_BURST,
  type Ambient,
  type RoadsData,
  type WardData,
} from '../heat-map-model.ts';
import { loadWard } from '../ward-loader.ts';
import { rasterWardBase } from '../ward-raster.ts';
import { WARDS, type WardId } from '../wards.ts';
import { coverageToInterventions, deliveredQuantities, type DeliveredQuantities } from '../scenario/coverage.ts';
import type { PairedScenarioState } from '../scenario/scenario-state.ts';
import { resolveReferenceForcing, type CompareReferenceForcing } from './reference-forcing.ts';

export type MetricValue =
  | { state: 'evaluated'; value: number; unit: 'percent' | 'percentage-points' }
  | { state: 'not-evaluated'; reason: string };

export interface ReleaseEvidence {
  forcingId: string;
  forcingStatus: CompareReferenceForcing['status'];
  modelVersion: 'heat-model-v1';
  gridVersion: typeof CANONICAL_GRID_VERSION;
  dataVersion: 'ward-geometry-v1';
  stockBasis: 'modelled-stock-v1';
  backendVersion: 'ts-v1';
  screening: true;
}

export interface WardScenarioResult {
  ward: WardId;
  wardData: WardData;
  roads: RoadsData;
  field: Float32Array;
  baselineMeanC: number;
  scenarioMeanC: number;
  coolingC: number;
  baselineHotAreaPct: MetricValue;
  scenarioHotAreaPct: MetricValue;
  hotAreaChangePp: MetricValue;
  ruralContrastC: number;
  capitalCost: number;
  delivered: DeliveredQuantities;
  evidence: ReleaseEvidence;
}

export interface PairedResult {
  a: WardScenarioResult;
  b: WardScenarioResult;
  forcing: CompareReferenceForcing;
  settledAt: string;
  contract: 'paired-coverage-v1';
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Scenario run superseded.', 'AbortError');
}

function runField(layers: SimLayers, params: SimParams, sizeM: number) {
  const sim = new TsHeatSim();
  sim.reset({ n: CANONICAL_GRID_N, cellMeters: sizeM / CANONICAL_GRID_N }, layers, params);
  sim.step(1, RESET_BURST);
  const stats = sim.stats(40);
  const field = sim.temperature().slice();
  sim.dispose();
  return { stats, field };
}

function ruralContrast(params: SimParams, meanC: number): number {
  const k = params.kRad + params.h * params.wind;
  const rural = (params.S * 0.75 * params.sun - params.L + params.kRad * params.tSky
    + params.h * params.wind * params.tAir) / k;
  return meanC - rural;
}

function hotMetric(value: number, phase: PairedScenarioState['phase']): MetricValue {
  return phase === 'peak'
    ? { state: 'evaluated', value: value * 100, unit: 'percent' }
    : { state: 'not-evaluated', reason: 'The retained phase does not evaluate the >40°C threshold.' };
}

async function runWard(
  id: WardId,
  state: PairedScenarioState,
  forcing: CompareReferenceForcing,
  signal?: AbortSignal,
): Promise<WardScenarioResult> {
  assertNotAborted(signal);
  const loaded = await loadWard(id, signal);
  assertNotAborted(signal);
  const base = rasterWardBase(loaded.ward, WARDS[id].vegetationBaseline);
  const spatial = buildSpatial(loaded.ward, base, loaded.roads);
  const interventions = coverageToInterventions(state.coverage);
  const phase = state.phase === 'peak' ? 'peak' : 'night';
  const forcingValues: Ambient = forcing.values[state.phase];
  const baselineParams = currentParamsForReference(forcingValues, phase, { trees: 0, roof: 0, parks: 0, facades: 0 });
  const scenarioParams = currentParamsForReference(forcingValues, phase, interventions);
  const baseline = runField(base, baselineParams, loaded.ward.sizeM);
  assertNotAborted(signal);
  const scenarioLayers = applyInterventions(base, interventions, spatial);
  const scenario = runField(scenarioLayers, scenarioParams, loaded.ward.sizeM);
  assertNotAborted(signal);
  const baselineHot = hotMetric(baseline.stats.fracAbove, state.phase);
  const scenarioHot = hotMetric(scenario.stats.fracAbove, state.phase);
  const hotAreaChange: MetricValue = baselineHot.state === 'evaluated' && scenarioHot.state === 'evaluated'
    ? { state: 'evaluated', value: scenarioHot.value - baselineHot.value, unit: 'percentage-points' }
    : { state: 'not-evaluated', reason: 'The retained phase does not evaluate hot-area change.' };
  const evidence: ReleaseEvidence = {
    forcingId: forcing.id,
    forcingStatus: forcing.status,
    modelVersion: 'heat-model-v1',
    gridVersion: CANONICAL_GRID_VERSION,
    dataVersion: 'ward-geometry-v1',
    stockBasis: 'modelled-stock-v1',
    backendVersion: 'ts-v1',
    screening: true,
  };
  return {
    ward: id,
    wardData: loaded.ward,
    roads: loaded.roads,
    field: scenario.field,
    baselineMeanC: baseline.stats.meanC,
    scenarioMeanC: scenario.stats.meanC,
    coolingC: baseline.stats.meanC - scenario.stats.meanC,
    baselineHotAreaPct: baselineHot,
    scenarioHotAreaPct: scenarioHot,
    hotAreaChangePp: hotAreaChange,
    ruralContrastC: ruralContrast(scenarioParams, scenario.stats.meanC),
    capitalCost: computeCost(interventions, spatial),
    delivered: deliveredQuantities(state.coverage, spatial),
    evidence,
  };
}

export async function runPairedScenario(state: PairedScenarioState, signal?: AbortSignal): Promise<PairedResult> {
  if (state.a === state.b) throw new Error('A valid comparison requires two distinct wards.');
  const forcing = resolveReferenceForcing(state.forcing);
  if (!forcing) throw new Error('The requested reference forcing record is unavailable.');
  const a = await runWard(state.a, state, forcing, signal);
  const b = await runWard(state.b, state, forcing, signal);
  if (a.evidence.forcingId !== b.evidence.forcingId || a.evidence.gridVersion !== b.evidence.gridVersion) {
    throw new Error('The paired result failed its shared analytical contract.');
  }
  return { a, b, forcing, settledAt: new Date().toISOString(), contract: 'paired-coverage-v1' };
}
