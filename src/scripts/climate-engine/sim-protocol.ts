import {
  gridFor,
  isAdmittedGrid,
  type GridSpec,
  type SimLayers,
  type SimParams,
  type SimStats,
} from './types';

export type ExploreBackend = 'gpu-webgl2' | 'ts-worker' | 'ts-main';

export interface HeatSimRequest {
  generation: number;
  grid: GridSpec;
  /**
   * The ward's analysis footprint, metres.
   *
   * THE CONTRACT IS THE PAIR, so the request has to carry both halves. `grid`
   * alone cannot tell 384 cells over a 2800 m ward (7.29 m, admitted) from 384
   * over a 1400 m one (3.65 m, described by no calibration here) — both produce
   * arrays of exactly the right length. Nor can the size be recovered from
   * `cellMeters`, which is why this is a field and not a derivation: callers
   * have rounded that number (7.29 for 1400/192).
   */
  sizeM: number;
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
   *  A literal type here could only name Kolkata's; `isCurrentSnapshot` checks
   *  it against the ward size the caller asked for. */
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
  /* THE WHOLE GATE NOW: the pair, not the grid. `isAdmittedGrid` checks that
     `n` belongs to this ward size AND that `cellMeters` is the metres those two
     imply — so a non-finite or zero cell size is refused here too, and the
     separate cell-size branch this replaces is gone. That is deliberate: a cell
     size disagreeing with sizeM/n is not a lesser fault, it is the same one.

     THE WORDING IS LOAD-BEARING. compare/paired-worker.ts classifies failures
     by matching message TEXT, so this string and that regex move together. */
  if (!isAdmittedGrid(request.grid, request.sizeM))
    throw new RangeError(
      `Grid ${request.grid.n} does not pair with a ${request.sizeM} m ward. `
      + 'A mismatched pair produces arrays of the right length and models a cell '
      + 'size no calibration describes.');
  for (const layer of [request.layers.albedo, request.layers.veg, request.layers.built, request.layers.water]) {
    if (layer.length !== count) throw new RangeError(`Heat layers must hold ${count} cells — one per cell of this ward's admitted grid.`);
  }
  if (!Number.isInteger(request.settleSteps) || request.settleSteps < 0) throw new RangeError('Invalid settle step count.');
  if (!Number.isFinite(request.thresholdC)) throw new RangeError('Invalid heat threshold.');
}

/**
 * Is this snapshot the one the caller is waiting for — right generation, and
 * solved on the grid THIS ward's size admits?
 *
 * THE GRID HALF WAS WEAKENED WHEN THE SECOND PAIR LANDED. It had been equality
 * against the one canonical version. It became `ADMITTED_GRIDS.some(...)`,
 * which asks "is this any grid we admit" rather than "is this the grid I asked
 * for" — so a 2800 m Bengaluru field reads as current for a 1400 m Kolkata
 * view, both versions being admitted. `sizeM` is the ward the caller is asking
 * about, so equality against that size's version is the honest check.
 *
 * `gridFor` rather than `gridVersion` only so an unadmitted size answers
 * `false` instead of throwing out of a predicate.
 */
export function isCurrentSnapshot(
  snapshot: HeatSimSnapshot, generation: number, sizeM: number,
): boolean {
  return snapshot.generation === generation && snapshot.gridVersion === gridFor(sizeM)?.version;
}
