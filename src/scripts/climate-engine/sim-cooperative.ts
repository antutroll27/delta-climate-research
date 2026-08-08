import { TsHeatSim } from './sim-ts.ts';
import type { GridSpec, SimLayers, SimParams, SimStats } from './types.ts';

export class SimulationCancelled extends Error {
  constructor() {
    super('Simulation superseded.');
    this.name = 'AbortError';
  }
}

export interface CooperativeFieldRequest {
  grid: GridSpec;
  layers: SimLayers;
  params: SimParams;
  steps: number;
  thresholdC: number;
  signal?: AbortSignal;
  isCancelled?: () => boolean;
  maxSliceMs?: number;
  maxStepsPerSlice?: number;
  now?: () => number;
  yieldControl?: () => Promise<void>;
}

export interface CooperativeFieldResult {
  field: Float32Array;
  stats: SimStats;
}

function cancelled(request: CooperativeFieldRequest): boolean {
  return Boolean(request.signal?.aborted || request.isCancelled?.());
}

/** Yields to the task queue so a worker can receive a cancellation message. */
export function yieldToTaskQueue(): Promise<void> {
  const scheduler = (globalThis as typeof globalThis & {
    scheduler?: { yield?: () => Promise<void> };
  }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(undefined);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Executes the unchanged TypeScript solver in short task slices. The solver itself
 * remains synchronous; yielding here is what lets a worker receive cancellation.
 */
export async function runTsFieldCooperatively(request: CooperativeFieldRequest): Promise<CooperativeFieldResult> {
  const sim = new TsHeatSim();
  const now = request.now ?? (() => performance.now());
  const yieldControl = request.yieldControl ?? yieldToTaskQueue;
  const maxSliceMs = request.maxSliceMs ?? 8;
  const maxStepsPerSlice = request.maxStepsPerSlice ?? 48;
  try {
    if (!Number.isInteger(request.steps) || request.steps < 0) throw new RangeError('Invalid simulation step count.');
    if (cancelled(request)) throw new SimulationCancelled();
    sim.reset(request.grid, request.layers, request.params);
    let remaining = request.steps;
    while (remaining > 0) {
      if (cancelled(request)) throw new SimulationCancelled();
      const started = now();
      let stepped = 0;
      do {
        sim.step(1, 1);
        stepped += 1;
        remaining -= 1;
      } while (remaining > 0 && stepped < maxStepsPerSlice && now() - started < maxSliceMs);
      if (cancelled(request)) throw new SimulationCancelled();
      if (remaining > 0) await yieldControl();
    }
    if (cancelled(request)) throw new SimulationCancelled();
    return { field: sim.temperature().slice(), stats: sim.stats(request.thresholdC) };
  } finally {
    sim.dispose();
  }
}
