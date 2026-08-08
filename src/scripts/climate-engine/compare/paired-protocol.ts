import type { RoadsData, WardData } from '../heat-map-model.ts';
import type { DeliveredQuantities } from '../scenario/coverage.ts';
import type { PairedScenarioState } from '../scenario/scenario-state.ts';
import { CANONICAL_GRID_VERSION, HEAT_METRICS_VERSION } from '../types.ts';
import type { WardId } from '../wards.ts';
import type { CompareReferenceForcing } from './reference-forcing.ts';

export type MetricValue =
  | { state: 'evaluated'; value: number; unit: 'percent' | 'percentage-points' }
  | { state: 'not-evaluated'; reason: string };

export type PairedBackendVersion = 'ts-worker-v1' | 'ts-main-cooperative-v1';

export interface ReleaseEvidence {
  forcingId: string;
  forcingStatus: CompareReferenceForcing['status'];
  modelVersion: 'heat-model-v1';
  gridVersion: typeof CANONICAL_GRID_VERSION;
  dataVersion: 'ward-geometry-v1';
  stockBasis: 'modelled-stock-v1';
  backendVersion: PairedBackendVersion;
  metricsVersion: typeof HEAT_METRICS_VERSION;
  screening: true;
}

export interface WardRenderAsset {
  key: string;
  wardData: WardData;
  roads: RoadsData;
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
  greenReferenceContrastC: number;
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

export type PairedJobStage =
  | 'loading-inputs'
  | 'preparing-wards'
  | 'solving-baselines'
  | 'solving-scenarios'
  | 'assembling-evidence';

export interface WardScenarioWireResult extends Omit<WardScenarioResult, 'wardData' | 'roads'> {
  assetKey: string;
  renderAsset?: WardRenderAsset;
}

export interface PairedWireResult extends Omit<PairedResult, 'a' | 'b'> {
  a: WardScenarioWireResult;
  b: WardScenarioWireResult;
}

export type PairedFailureCode = 'invalid-request' | 'input-unavailable' | 'calculation-failed' | 'contract-failed';

export type PairedWorkerRequest =
  | { type: 'run'; requestId: number; generation: number; state: PairedScenarioState; knownAssetKeys: string[] }
  | { type: 'cancel'; requestId: number }
  | { type: 'dispose' };

export type PairedWorkerResponse =
  | { type: 'progress'; requestId: number; generation: number; stage: PairedJobStage }
  | { type: 'result'; requestId: number; generation: number; result: PairedWireResult }
  | { type: 'cancelled'; requestId: number; generation: number }
  | { type: 'failure'; requestId: number; generation: number; code: PairedFailureCode; message: string };

export const PAIRED_DATA_VERSION = 'ward-geometry-v1' as const;

export function wardRenderAssetKey(ward: WardId, dataVersion = PAIRED_DATA_VERSION): string {
  return `${dataVersion}:${ward}`;
}

export function isAbortError(error: unknown): boolean {
  return (error as Error | undefined)?.name === 'AbortError';
}

export function assertPairedResult(result: PairedResult): void {
  if (result.a.ward === result.b.ward) throw new Error('A paired result requires two distinct wards.');
  if (result.a.field.length !== 192 * 192 || result.b.field.length !== 192 * 192) {
    throw new Error('The paired result does not use the canonical grid.');
  }
  const evidence = [result.a.evidence, result.b.evidence];
  if (evidence[0].forcingId !== evidence[1].forcingId
    || evidence[0].gridVersion !== evidence[1].gridVersion
    || evidence[0].modelVersion !== evidence[1].modelVersion
    || evidence[0].metricsVersion !== evidence[1].metricsVersion) {
    throw new Error('The paired result failed its shared analytical contract.');
  }
}

export function toPairedWireResult(result: PairedResult, knownAssetKeys: ReadonlySet<string>): PairedWireResult {
  const toWire = (ward: WardScenarioResult): WardScenarioWireResult => {
    const assetKey = wardRenderAssetKey(ward.ward, ward.evidence.dataVersion);
    const { wardData, roads, ...rest } = ward;
    return {
      ...rest,
      assetKey,
      ...(knownAssetKeys.has(assetKey) ? {} : { renderAsset: { key: assetKey, wardData, roads } }),
    };
  };
  return { ...result, a: toWire(result.a), b: toWire(result.b) };
}

export function fromPairedWireResult(result: PairedWireResult, assets: ReadonlyMap<string, WardRenderAsset>): PairedResult {
  const fromWire = (ward: WardScenarioWireResult): WardScenarioResult => {
    const asset = ward.renderAsset ?? assets.get(ward.assetKey);
    if (!asset || asset.key !== ward.assetKey) throw new Error(`Missing paired render asset for ${ward.ward}.`);
    const { assetKey: _assetKey, renderAsset: _renderAsset, ...rest } = ward;
    return { ...rest, wardData: asset.wardData, roads: asset.roads };
  };
  const full = { ...result, a: fromWire(result.a), b: fromWire(result.b) };
  assertPairedResult(full);
  return full;
}
