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

/**
 * The page's handle on the Compare worker.
 *
 * Demotion is the contract that matters: if the worker cannot be constructed, or
 * errors later, every run — including the ones already in flight — is transparently
 * re-issued on the main thread. A caller never learns which side solved it.
 */
export interface PairedScenarioClient {
  run(state: PairedScenarioState, options?: PairedRunOptions): Promise<PairedResult>;
  dispose(): void;
}

export function createPairedScenarioClient(options: PairedScenarioClientOptions = {}): PairedScenarioClient {
  let worker: WorkerLike | null = null;
  let sequence = 0;
  let disposed = false;
  let demoted = false;
  const pendingRuns = new Map<number, PendingRun>();
  const assets = new Map<string, WardRenderAsset>();

  function rememberAssets(wire: PairedWireResult): void {
    for (const ward of [wire.a, wire.b]) {
      if (ward.renderAsset) assets.set(ward.renderAsset.key, ward.renderAsset);
    }
  }

  function handleMessage(message: PairedWorkerResponse): void {
    const pending = pendingRuns.get(message.requestId);
    if (!pending) return;
    if (message.type === 'progress') {
      pending.onStage?.(message.stage);
      return;
    }
    pendingRuns.delete(message.requestId);
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
      rememberAssets(message.result);
      pending.resolve(fromPairedWireResult(message.result, assets));
    } catch (error) {
      pending.reject(error as Error);
    }
  }

  function demote(): void {
    if (demoted || disposed) return;
    demoted = true;
    if (worker) {
      worker.removeEventListener('message', onMessage as EventListener);
      worker.removeEventListener('error', onError as EventListener);
      worker.terminate();
      worker = null;
    }
    const orphaned = [...pendingRuns.values()];
    pendingRuns.clear();
    for (const pending of orphaned) {
      pending.signal?.removeEventListener('abort', pending.abort!);
      if (pending.signal?.aborted) {
        pending.reject(abortError());
        continue;
      }
      (options.fallback ?? defaultFallback)(pending.state, pending.signal)
        .then(pending.resolve, pending.reject);
    }
  }

  const onMessage = (event: MessageEvent<PairedWorkerResponse>) => handleMessage(event.data);
  const onError = () => demote();

  try {
    worker = (options.workerFactory ?? (() => new Worker(new URL('./paired-worker.ts', import.meta.url), { type: 'module' })))();
    worker.addEventListener('message', onMessage as EventListener);
    worker.addEventListener('error', onError as EventListener);
  } catch {
    demoted = true;
  }

  return {
    run(state, runOptions = {}) {
      if (disposed) return Promise.reject(new Error('Paired scenario client disposed.'));
      if (runOptions.signal?.aborted) return Promise.reject(abortError());
      if (demoted || !worker) return (options.fallback ?? defaultFallback)(state, runOptions.signal);
      const requestId = ++sequence;
      const generation = requestId;
      return new Promise<PairedResult>((resolve, reject) => {
        const pending: PendingRun = { generation, state, resolve, reject, signal: runOptions.signal, onStage: runOptions.onStage };
        const abort = () => {
          worker?.postMessage({ type: 'cancel', requestId });
        };
        pending.abort = abort;
        runOptions.signal?.addEventListener('abort', abort, { once: true });
        pendingRuns.set(requestId, pending);
        worker!.postMessage({
          type: 'run',
          requestId,
          generation,
          state,
          knownAssetKeys: [...assets.keys()],
        });
      });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [requestId, pending] of pendingRuns) {
        worker?.postMessage({ type: 'cancel', requestId });
        pending.signal?.removeEventListener('abort', pending.abort!);
        pending.reject(new Error('Paired scenario client disposed.'));
      }
      pendingRuns.clear();
      if (worker) {
        worker.postMessage({ type: 'dispose' });
        worker.removeEventListener('message', onMessage as EventListener);
        worker.removeEventListener('error', onError as EventListener);
        worker.terminate();
        worker = null;
      }
      assets.clear();
    },
  };
}
