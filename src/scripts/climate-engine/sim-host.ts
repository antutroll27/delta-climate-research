import { WebGl2HeatSim } from './sim-gpu-webgl2';
import { TsHeatSim } from './sim-ts';
import {
  assertHeatRequest, type ExploreBackend, type HeatSimHost, type HeatSimRequest,
  type HeatSimSnapshot, type HeatWorkerResponse,
} from './sim-protocol';
import { CANONICAL_GRID_VERSION } from './types';

/**
 * The three engines behind `HeatSimHost`, in demotion order:
 * `gpu-webgl2 → ts-worker → ts-main`. They share an interface and nothing else —
 * no base class, no common helper — so each is a factory closing over its own
 * state rather than a class. State held in a closure is genuinely private;
 * TypeScript's `private` is erased at runtime.
 *
 * The ladder itself lives in heat-map-app's `demoteSimHost`.
 */

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;
export type WorkerFactory = () => WorkerLike;

function makeSnapshot(backend: ExploreBackend, request: HeatSimRequest, sim: Pick<TsHeatSim, 'temperature' | 'stats'>): HeatSimSnapshot {
  return {
    generation: request.generation,
    backend,
    field: sim.temperature().slice(),
    stats: sim.stats(request.thresholdC),
    gridVersion: CANONICAL_GRID_VERSION,
  };
}

const defaultWorker: WorkerFactory = () => new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' });

/**
 * Solves off the main thread. The factory argument is the test seam: pass a fake
 * worker and the whole protocol is drivable from node — see
 * tests/unit/heat-map-sim-host.test.mjs.
 */
export function createWorkerHost(factory: WorkerFactory = defaultWorker): HeatSimHost {
  let sequence = 0;
  let active: HeatSimRequest | null = null;
  let disposed = false;
  let advancing: Promise<HeatSimSnapshot | null> | null = null;
  const pending = new Map<number, { resolve: (value: HeatSimSnapshot | null) => void; reject: (error: Error) => void }>();

  const failAll = (error: Error) => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };

  const onMessage = (event: MessageEvent<HeatWorkerResponse>) => {
    const data = event.data;
    const waiting = pending.get(data.requestId);
    if (!waiting) return;
    pending.delete(data.requestId);
    if (data.type === 'failure') { waiting.reject(new Error(data.message)); return; }
    if (!active || data.snapshot.generation !== active.generation) { waiting.resolve(null); return; }
    waiting.resolve(data.snapshot);
  };
  const onError = () => failAll(new Error('CPU simulation worker unavailable.'));

  const worker = factory();
  worker.addEventListener('message', onMessage as EventListener);
  worker.addEventListener('error', onError as EventListener);

  type CallPayload =
    | (Omit<HeatSimRequest, 'layers'> & { type: 'reset'; layers: HeatSimRequest['layers'] })
    | { type: 'advance'; generation: number; steps: number; thresholdC: number };

  const call = (payload: CallPayload): Promise<HeatSimSnapshot | null> => {
    if (disposed) return Promise.reject(new Error('CPU simulation host disposed.'));
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(requestId, { resolve, reject });
      if (payload.type === 'reset') {
        // Structured cloning protects the committed arrays from transfer detachment.
        const { type: _type, ...request } = payload;
        worker.postMessage({ type: 'reset', requestId, request });
      } else {
        const { type: _type, ...advance } = payload;
        worker.postMessage({ type: 'advance', requestId, ...advance });
      }
    });
  };

  return {
    backend: 'ts-worker',

    async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
      assertHeatRequest(request);
      /* Latched BEFORE the await, so a caller that resets twice in one tick
         leaves the second generation active and the first one superseded. */
      active = request;
      const snapshot = await call({ type: 'reset', ...request });
      if (!snapshot) throw new Error('CPU simulation result was superseded.');
      return snapshot;
    },

    advance(generation: number, steps: number): Promise<HeatSimSnapshot | null> {
      if (!active || generation !== active.generation || disposed) return Promise.resolve(null);
      /* Coalescing: a second advance rides the one in flight rather than
         queueing a redundant solve. The latch MUST clear on rejection too —
         otherwise every later advance returns the same dead promise and the
         field freezes for the session with no error. */
      if (advancing) return advancing;
      advancing = call({ type: 'advance', generation, steps, thresholdC: active.thresholdC })
        .finally(() => { advancing = null; });
      return advancing;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      worker.postMessage({ type: 'dispose' });
      worker.removeEventListener('message', onMessage as EventListener);
      worker.removeEventListener('error', onError as EventListener);
      worker.terminate();
      failAll(new Error('CPU simulation host disposed.'));
    },
  };
}

/** What the GPU host needs of a solver — the seam that makes its guards testable. */
export type GpuSimFactory = (canvas: HTMLCanvasElement) => Pick<WebGl2HeatSim, 'reset' | 'step' | 'temperature' | 'stats' | 'dispose'>;

/**
 * Solves on the GPU. Context loss is latched rather than thrown at, so the app
 * can demote on the next call instead of dying inside an event handler.
 *
 * `makeSim` exists because a real WebGL2 context cannot be had in node, and the
 * guards below — the latch, the generation check, the disposal order — are
 * ordinary logic that should not need a GPU to test. Production passes nothing.
 * The real WebGl2HeatSim integration is covered headed, in
 * tests/e2e/heat-map-sim-backend.spec.ts.
 */
export function createGpuHost(canvas: HTMLCanvasElement, makeSim: GpuSimFactory = (c) => new WebGl2HeatSim(c)): HeatSimHost {
  let active: HeatSimRequest | null = null;
  let disposed = false;
  let contextLost = false;

  const onContextLost = (event: Event) => { event.preventDefault(); contextLost = true; };
  const sim = makeSim(canvas);
  canvas.addEventListener('webglcontextlost', onContextLost);

  return {
    backend: 'gpu-webgl2',

    async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
      if (disposed || contextLost) throw new Error('GPU simulation host unavailable.');
      assertHeatRequest(request);
      active = request;
      sim.reset(request.grid, request.layers, request.params);
      sim.step(1, request.settleSteps);
      return makeSnapshot('gpu-webgl2', request, sim);
    },

    async advance(generation: number, steps: number): Promise<HeatSimSnapshot | null> {
      /* Throwing on a lost context is what triggers demotion; returning null
         here would look like an ordinary stale frame and strand the page on a
         dead backend. Order matters — this check precedes the disposed one. */
      if (contextLost) throw new Error('GPU simulation context lost.');
      if (disposed || !active || generation !== active.generation) return null;
      sim.step(1, steps);
      return makeSnapshot('gpu-webgl2', active, sim);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      sim.dispose();
    },
  };
}

/** The last rung: solves on the main thread and never animates. */
export function createStaticHost(): HeatSimHost {
  const sim = new TsHeatSim();
  let active: HeatSimRequest | null = null;
  let disposed = false;

  return {
    backend: 'ts-main',

    async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
      if (disposed) throw new Error('Static CPU simulation host disposed.');
      assertHeatRequest(request);
      active = request;
      sim.reset(request.grid, request.layers, request.params);
      // Yield around bounded batches: this path is only for blocked workers.
      for (let left = request.settleSteps; left > 0; left -= 24) {
        sim.step(1, Math.min(left, 24));
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (disposed || active !== request) throw new Error('Static CPU simulation superseded.');
      }
      return makeSnapshot('ts-main', request, sim);
    },

    async advance(): Promise<HeatSimSnapshot | null> { return null; },

    dispose(): void { if (!disposed) { disposed = true; sim.dispose(); } },
  };
}
