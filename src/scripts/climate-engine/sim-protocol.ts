import {
  CANONICAL_GRID_N,
  CANONICAL_GRID_VERSION,
  type GridSpec,
  type SimLayers,
  type SimParams,
  type SimStats,
} from './types';

export type ExploreBackend = 'gpu-webgl2' | 'ts-worker' | 'ts-main';

export interface HeatSimRequest {
  generation: number;
  grid: GridSpec;
  layers: SimLayers;
  params: SimParams;
  settleSteps: number;
  thresholdC: number;
}

export interface HeatSimSnapshot {
  generation: number;
  backend: ExploreBackend;
  field: Float32Array;
  stats: SimStats;
  gridVersion: typeof CANONICAL_GRID_VERSION;
}

export interface HeatSimHost {
  readonly backend: ExploreBackend;
  reset(request: HeatSimRequest): Promise<HeatSimSnapshot>;
  advance(generation: number, steps: number): Promise<HeatSimSnapshot | null>;
  dispose(): void;
}

export interface WorkerResetMessage {
  type: 'reset'; requestId: number; request: HeatSimRequest;
}
export interface WorkerAdvanceMessage {
  type: 'advance'; requestId: number; generation: number; steps: number; thresholdC: number;
}
export interface WorkerDisposeMessage { type: 'dispose'; }
export type HeatWorkerRequest = WorkerResetMessage | WorkerAdvanceMessage | WorkerDisposeMessage;

export interface WorkerSnapshotMessage {
  type: 'snapshot'; requestId: number; snapshot: HeatSimSnapshot;
}
export interface WorkerFailureMessage {
  type: 'failure'; requestId: number; generation: number; message: string;
}
export type HeatWorkerResponse = WorkerSnapshotMessage | WorkerFailureMessage;

export function assertHeatRequest(request: HeatSimRequest): void {
  const count = request.grid.n * request.grid.n;
  if (!Number.isInteger(request.generation) || request.generation < 0) throw new RangeError('Invalid simulation generation.');
  if (request.grid.n !== CANONICAL_GRID_N) throw new RangeError('The heat model requires the canonical grid.');
  if (!Number.isFinite(request.grid.cellMeters) || request.grid.cellMeters <= 0) throw new RangeError('Invalid heat grid cell size.');
  for (const layer of [request.layers.albedo, request.layers.veg, request.layers.built, request.layers.water]) {
    if (layer.length !== count) throw new RangeError('Heat layers must match the canonical grid.');
  }
  if (!Number.isInteger(request.settleSteps) || request.settleSteps < 0) throw new RangeError('Invalid settle step count.');
  if (!Number.isFinite(request.thresholdC)) throw new RangeError('Invalid heat threshold.');
}

export function isCurrentSnapshot(snapshot: HeatSimSnapshot, generation: number): boolean {
  return snapshot.generation === generation && snapshot.gridVersion === CANONICAL_GRID_VERSION;
}
