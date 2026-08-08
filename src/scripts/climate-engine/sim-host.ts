import { WebGl2HeatSim } from './sim-gpu-webgl2';
import { TsHeatSim } from './sim-ts';
import {
  assertHeatRequest, type ExploreBackend, type HeatSimHost, type HeatSimRequest,
  type HeatSimSnapshot, type HeatWorkerResponse,
} from './sim-protocol';
import { CANONICAL_GRID_VERSION } from './types';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;
type WorkerFactory = () => WorkerLike;

function makeSnapshot(backend: ExploreBackend, request: HeatSimRequest, sim: Pick<TsHeatSim, 'temperature' | 'stats'>): HeatSimSnapshot {
  return {
    generation: request.generation,
    backend,
    field: sim.temperature().slice(),
    stats: sim.stats(request.thresholdC),
    gridVersion: CANONICAL_GRID_VERSION,
  };
}

export class WorkerHeatSimHost implements HeatSimHost {
  readonly backend = 'ts-worker' as const;
  private worker: WorkerLike;
  private sequence = 0;
  private active: HeatSimRequest | null = null;
  private disposed = false;
  private advancing: Promise<HeatSimSnapshot | null> | null = null;
  private pending = new Map<number, { resolve: (value: HeatSimSnapshot | null) => void; reject: (error: Error) => void }>();
  private onMessage = (event: MessageEvent<HeatWorkerResponse>) => {
    const data = event.data;
    const pending = this.pending.get(data.requestId);
    if (!pending) return;
    this.pending.delete(data.requestId);
    if (data.type === 'failure') { pending.reject(new Error(data.message)); return; }
    if (!this.active || data.snapshot.generation !== this.active.generation) { pending.resolve(null); return; }
    pending.resolve(data.snapshot);
  };
  private onError = () => this.failAll(new Error('CPU simulation worker unavailable.'));

  constructor(factory: WorkerFactory = () => new Worker(new URL('./sim-worker.ts', import.meta.url), { type: 'module' })) {
    this.worker = factory();
    this.worker.addEventListener('message', this.onMessage as EventListener);
    this.worker.addEventListener('error', this.onError as EventListener);
  }

  private call(payload: Omit<HeatSimRequest, 'layers'> & { type: 'reset'; layers: HeatSimRequest['layers'] } | { type: 'advance'; generation: number; steps: number; thresholdC: number }): Promise<HeatSimSnapshot | null> {
    if (this.disposed) return Promise.reject(new Error('CPU simulation host disposed.'));
    const requestId = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      if (payload.type === 'reset') {
        // Structured cloning protects the committed arrays from transfer detachment.
        const { type: _type, ...request } = payload;
        this.worker.postMessage({ type: 'reset', requestId, request });
      } else {
        const { type: _type, ...advance } = payload;
        this.worker.postMessage({ type: 'advance', requestId, ...advance });
      }
    });
  }

  async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
    assertHeatRequest(request);
    this.active = request;
    const snapshot = await this.call({ type: 'reset', ...request });
    if (!snapshot) throw new Error('CPU simulation result was superseded.');
    return snapshot;
  }

  advance(generation: number, steps: number): Promise<HeatSimSnapshot | null> {
    if (!this.active || generation !== this.active.generation || this.disposed) return Promise.resolve(null);
    if (this.advancing) return this.advancing;
    this.advancing = this.call({ type: 'advance', generation, steps, thresholdC: this.active.thresholdC })
      .finally(() => { this.advancing = null; });
    return this.advancing;
  }

  private failAll(error: Error) {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.postMessage({ type: 'dispose' });
    this.worker.removeEventListener('message', this.onMessage as EventListener);
    this.worker.removeEventListener('error', this.onError as EventListener);
    this.worker.terminate();
    this.failAll(new Error('CPU simulation host disposed.'));
  }
}

export class GpuHeatSimHost implements HeatSimHost {
  readonly backend = 'gpu-webgl2' as const;
  private sim: WebGl2HeatSim;
  private active: HeatSimRequest | null = null;
  private disposed = false;
  private contextLost = false;
  private onContextLost = (event: Event) => { event.preventDefault(); this.contextLost = true; };
  constructor(private canvas: HTMLCanvasElement) {
    this.sim = new WebGl2HeatSim(canvas);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
  }
  async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
    if (this.disposed || this.contextLost) throw new Error('GPU simulation host unavailable.');
    assertHeatRequest(request); this.active = request;
    this.sim.reset(request.grid, request.layers, request.params);
    this.sim.step(1, request.settleSteps);
    return makeSnapshot(this.backend, request, this.sim);
  }
  async advance(generation: number, steps: number): Promise<HeatSimSnapshot | null> {
    if (this.contextLost) throw new Error('GPU simulation context lost.');
    if (this.disposed || !this.active || generation !== this.active.generation) return null;
    this.sim.step(1, steps);
    return makeSnapshot(this.backend, this.active, this.sim);
  }
  dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.sim.dispose();
    }
  }
}

export class StaticTsHeatSimHost implements HeatSimHost {
  readonly backend = 'ts-main' as const;
  private sim = new TsHeatSim();
  private active: HeatSimRequest | null = null;
  private disposed = false;
  async reset(request: HeatSimRequest): Promise<HeatSimSnapshot> {
    if (this.disposed) throw new Error('Static CPU simulation host disposed.');
    assertHeatRequest(request); this.active = request;
    this.sim.reset(request.grid, request.layers, request.params);
    // Yield around bounded batches: this path is only for blocked workers.
    for (let left = request.settleSteps; left > 0; left -= 24) {
      this.sim.step(1, Math.min(left, 24));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.disposed || this.active !== request) throw new Error('Static CPU simulation superseded.');
    }
    return makeSnapshot(this.backend, request, this.sim);
  }
  async advance(): Promise<HeatSimSnapshot | null> { return null; }
  dispose(): void { if (!this.disposed) { this.disposed = true; this.sim.dispose(); } }
}
