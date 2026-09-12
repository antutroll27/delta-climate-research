import type { RoadsData, WardData } from '../heat-map-model.ts';
import type { DeliveredQuantities } from '../scenario/coverage.ts';
import type { PairedScenarioState } from '../scenario/scenario-state.ts';
import { requireGrid, HEAT_METRICS_VERSION } from '../types.ts';
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
  /** Which admitted (grid, ward size) pair produced this — see ADMITTED_GRIDS. */
  gridVersion: string;
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
  /* Both fields are sized against A's ward, and the two checks divide the work
     by era. TODAY no two admitted pairs share an `n`, so a mixed-grid pair
     cannot reach the gridVersion comparison below: B's field length will not
     match A's grid and THIS check throws, naming A's size — the only size it
     can vouch for. Once a coarse tier lands (192 cells over a 2800 m ward, the
     case ADMITTED_GRIDS anticipates) two pairs DO share an `n`, the lengths
     agree, and the gridVersion comparison becomes the one that catches it. */
  const expect = requireGrid(result.a.wardData.sizeM).n;
  if (result.a.field.length !== expect * expect || result.b.field.length !== expect * expect) {
    throw new Error(`The paired result does not match the ${result.a.wardData.sizeM} m ward's admitted grid.`);
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
