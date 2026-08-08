import type { PairedScenarioState } from '../scenario/scenario-state.ts';
import {
  fromPairedWireResult,
  type PairedJobStage,
  type PairedResult,
  type PairedWireResult,
  type PairedWorkerResponse,
  type WardRenderAsset,
} from './paired-protocol.ts';

type WorkerLike = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener' | 'removeEventListener'>;

interface PendingRun {
  generation: number;
  state: PairedScenarioState;
  resolve: (result: PairedResult) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
  onStage?: (stage: PairedJobStage) => void;
}

export interface PairedRunOptions {
  signal?: AbortSignal;
  onStage?: (stage: PairedJobStage) => void;
}

export interface PairedScenarioClientOptions {
  workerFactory?: () => WorkerLike;
  fallback?: (state: PairedScenarioState, signal?: AbortSignal) => Promise<PairedResult>;
}

function abortError(): Error {
  return new DOMException('Scenario run superseded.', 'AbortError');
}

async function defaultFallback(state: PairedScenarioState, signal?: AbortSignal): Promise<PairedResult> {
  const module = await import('./paired-runner.ts');
  return module.runPairedScenario(state, signal);
}

export class PairedScenarioClient {
  private worker: WorkerLike | null = null;
  private sequence = 0;
  private disposed = false;
  private demoted = false;
  private pending = new Map<number, PendingRun>();
  private assets = new Map<string, WardRenderAsset>();
  private onMessage = (event: MessageEvent<PairedWorkerResponse>) => this.handleMessage(event.data);
  private onError = () => this.demote();

  constructor(private options: PairedScenarioClientOptions = {}) {
    try {
      this.worker = (options.workerFactory ?? (() => new Worker(new URL('./paired-worker.ts', import.meta.url), { type: 'module' })))();
      this.worker.addEventListener('message', this.onMessage as EventListener);
      this.worker.addEventListener('error', this.onError as EventListener);
    } catch {
      this.demoted = true;
    }
  }

  private rememberAssets(wire: PairedWireResult): void {
    for (const ward of [wire.a, wire.b]) {
      if (ward.renderAsset) this.assets.set(ward.renderAsset.key, ward.renderAsset);
    }
  }

  private handleMessage(message: PairedWorkerResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onStage?.(message.stage);
      return;
    }
    this.pending.delete(message.requestId);
    pending.signal?.removeEventListener('abort', pending.abort!);
    if (message.type === 'cancelled') {
      pending.reject(abortError());
      return;
    }
    if (message.type === 'failure') {
      pending.reject(new Error(message.message));
      return;
    }
    try {
      this.rememberAssets(message.result);
      pending.resolve(fromPairedWireResult(message.result, this.assets));
    } catch (error) {
      pending.reject(error as Error);
    }
  }

  private demote(): void {
    if (this.demoted || this.disposed) return;
    this.demoted = true;
    if (this.worker) {
      this.worker.removeEventListener('message', this.onMessage as EventListener);
      this.worker.removeEventListener('error', this.onError as EventListener);
      this.worker.terminate();
      this.worker = null;
    }
    const pendingRuns = [...this.pending.values()];
    this.pending.clear();
    for (const pending of pendingRuns) {
      pending.signal?.removeEventListener('abort', pending.abort!);
      if (pending.signal?.aborted) {
        pending.reject(abortError());
        continue;
      }
      (this.options.fallback ?? defaultFallback)(pending.state, pending.signal)
        .then(pending.resolve, pending.reject);
    }
  }

  run(state: PairedScenarioState, options: PairedRunOptions = {}): Promise<PairedResult> {
    if (this.disposed) return Promise.reject(new Error('Paired scenario client disposed.'));
    if (options.signal?.aborted) return Promise.reject(abortError());
    if (this.demoted || !this.worker) return (this.options.fallback ?? defaultFallback)(state, options.signal);
    const requestId = ++this.sequence;
    const generation = requestId;
    return new Promise<PairedResult>((resolve, reject) => {
      const pending: PendingRun = { generation, state, resolve, reject, signal: options.signal, onStage: options.onStage };
      const abort = () => {
        this.worker?.postMessage({ type: 'cancel', requestId });
      };
      pending.abort = abort;
      options.signal?.addEventListener('abort', abort, { once: true });
      this.pending.set(requestId, pending);
      this.worker!.postMessage({
        type: 'run',
        requestId,
        generation,
        state,
        knownAssetKeys: [...this.assets.keys()],
      });
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [requestId, pending] of this.pending) {
      this.worker?.postMessage({ type: 'cancel', requestId });
      pending.signal?.removeEventListener('abort', pending.abort!);
      pending.reject(new Error('Paired scenario client disposed.'));
    }
    this.pending.clear();
    if (this.worker) {
      this.worker.postMessage({ type: 'dispose' });
      this.worker.removeEventListener('message', this.onMessage as EventListener);
      this.worker.removeEventListener('error', this.onError as EventListener);
      this.worker.terminate();
      this.worker = null;
    }
    this.assets.clear();
  }
}
