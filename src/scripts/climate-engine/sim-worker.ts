/// <reference lib="webworker" />
import { TsHeatSim } from './sim-ts';
import {
  assertHeatRequest,
  type HeatSimRequest,
  type HeatSimSnapshot,
  type HeatWorkerRequest,
  type HeatWorkerResponse,
} from './sim-protocol';
import { CANONICAL_GRID_VERSION } from './types';

let sim: TsHeatSim | null = null;
let current: HeatSimRequest | null = null;
let disposed = false;

function snapshot(request: HeatSimRequest): HeatSimSnapshot {
  if (!sim) throw new Error('The CPU simulation has not been initialised.');
  return {
    generation: request.generation,
    backend: 'ts-worker',
    field: sim.temperature().slice(),
    stats: sim.stats(request.thresholdC),
    gridVersion: CANONICAL_GRID_VERSION,
  };
}

function respond(message: HeatWorkerResponse): void {
  if (message.type === 'snapshot') {
    self.postMessage(message, [message.snapshot.field.buffer]);
  } else self.postMessage(message);
}

export function handleHeatWorkerMessage(message: HeatWorkerRequest): void {
  if (disposed || message.type === 'dispose') {
    disposed = true;
    sim?.dispose(); sim = null; current = null;
    return;
  }
  try {
    if (message.type === 'reset') {
      assertHeatRequest(message.request);
      sim?.dispose();
      sim = new TsHeatSim();
      current = message.request;
      sim.reset(current.grid, current.layers, current.params);
      sim.step(1, current.settleSteps);
      respond({ type: 'snapshot', requestId: message.requestId, snapshot: snapshot(current) });
      return;
    }
    if (!current || message.generation !== current.generation || !sim) return;
    sim.step(1, message.steps);
    respond({ type: 'snapshot', requestId: message.requestId, snapshot: snapshot(current) });
  } catch (error) {
    const generation = message.type === 'reset' ? message.request.generation : message.generation;
    respond({ type: 'failure', requestId: message.requestId, generation, message: 'CPU simulation could not complete.' });
    console.warn('heat simulation worker failure', error);
  }
}

self.addEventListener('message', (event: MessageEvent<HeatWorkerRequest>) => handleHeatWorkerMessage(event.data));
