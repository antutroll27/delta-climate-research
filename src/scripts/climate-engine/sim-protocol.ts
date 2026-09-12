import {
  ADMITTED_GRIDS,
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
  /** Which admitted pair solved this field — one of ADMITTED_GRIDS' versions.
   *  A literal type here could only name Kolkata's; `isCurrentSnapshot` checks it. */
  gridVersion: string;
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
  /* HALF THE GATE, DELIBERATELY, AND ONLY UNTIL TASK 3. The contract is the
     PAIR (grid, ward size), but the request does not carry its ward size yet,
     and the size cannot be recovered from `cellMeters` because callers round it
     (7.29 for 1400/192). So this admits any grid in the set and cannot yet
     refuse 384-over-1400 — the silent case this whole change exists for. Task 3
     adds `sizeM` to the request and this becomes
     `isAdmittedGrid(request.grid, request.sizeM)`. */
  if (!ADMITTED_GRIDS.some((g) => g.n === request.grid.n)) throw new RangeError('The heat model requires the canonical grid.');
  if (!Number.isFinite(request.grid.cellMeters) || request.grid.cellMeters <= 0) throw new RangeError('Invalid heat grid cell size.');
  for (const layer of [request.layers.albedo, request.layers.veg, request.layers.built, request.layers.water]) {
    if (layer.length !== count) throw new RangeError('Heat layers must match the canonical grid.');
  }
  if (!Number.isInteger(request.settleSteps) || request.settleSteps < 0) throw new RangeError('Invalid settle step count.');
  if (!Number.isFinite(request.thresholdC)) throw new RangeError('Invalid heat threshold.');
}

export function isCurrentSnapshot(snapshot: HeatSimSnapshot, generation: number): boolean {
  return snapshot.generation === generation && ADMITTED_GRIDS.some((g) => g.version === snapshot.gridVersion);
}

/**
 * The version string for the grid a request is being solved on.
 *
 * Looked up by `n` rather than by ward size because the request does not carry
 * its size yet (see `assertHeatRequest`). Every reset path runs that assertion
 * before a snapshot exists, so this cannot miss for a live request; it throws
 * rather than inventing a version if it ever does. Task 3 replaces it with
 * `gridVersion(request.sizeM)`, which names the pair instead of half of it.
 */
export function gridVersionOf(grid: GridSpec): string {
  const g = ADMITTED_GRIDS.find((a) => a.n === grid.n);
  if (!g) throw new RangeError(`No admitted grid with ${grid.n} cells per side.`);
  return g.version;
}
