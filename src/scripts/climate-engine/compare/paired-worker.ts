/// <reference lib="webworker" />
import { isAbortError, toPairedWireResult, type PairedWorkerRequest, type PairedWorkerResponse } from './paired-protocol.ts';
import { PairedScenarioCache, runPairedScenarioCore } from './paired-core.ts';

interface ActiveJob {
  request: Extract<PairedWorkerRequest, { type: 'run' }>;
  controller: AbortController;
}

const cache = new PairedScenarioCache();
let active: ActiveJob | null = null;
let pending: Extract<PairedWorkerRequest, { type: 'run' }> | null = null;
let pumping = false;
let disposed = false;

function post(message: PairedWorkerResponse): void {
  if (message.type === 'result') {
    self.postMessage(message, [message.result.a.field.buffer, message.result.b.field.buffer]);
    return;
  }
  self.postMessage(message);
}

function failure(error: unknown): { code: 'invalid-request' | 'input-unavailable' | 'calculation-failed' | 'contract-failed'; message: string } {
  const message = (error as Error | undefined)?.message ?? '';
  if (/valid comparison|reference forcing|canonical grid/i.test(message)) return { code: 'invalid-request', message: 'The requested comparison is invalid.' };
  if (/load|surface|fetch|Unable to/i.test(message)) return { code: 'input-unavailable', message: 'Comparison inputs are unavailable.' };
  if (/contract|Missing paired/i.test(message)) return { code: 'contract-failed', message: 'The paired analytical contract could not be verified.' };
  return { code: 'calculation-failed', message: 'The paired calculation could not complete.' };
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (!disposed && pending) {
      const request = pending;
      pending = null;
      const controller = new AbortController();
      active = { request, controller };
      try {
        const result = await runPairedScenarioCore(request.state, cache, {
          signal: controller.signal,
          backendVersion: 'ts-worker-v1',
          isCancelled: () => disposed || controller.signal.aborted,
          onStage: (stage) => post({ type: 'progress', requestId: request.requestId, generation: request.generation, stage }),
        });
        if (!controller.signal.aborted && !disposed) {
          post({
            type: 'result',
            requestId: request.requestId,
            generation: request.generation,
            result: toPairedWireResult(result, new Set(request.knownAssetKeys)),
          });
        } else if (!disposed) {
          post({ type: 'cancelled', requestId: request.requestId, generation: request.generation });
        }
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          if (!disposed) post({ type: 'cancelled', requestId: request.requestId, generation: request.generation });
        } else if (!disposed) {
          const detail = failure(error);
          post({ type: 'failure', requestId: request.requestId, generation: request.generation, ...detail });
          console.warn('paired worker failure', error);
        }
      } finally {
        active = null;
      }
    }
  } finally {
    pumping = false;
    if (!disposed && pending) void pump();
  }
}

export function handlePairedWorkerMessage(message: PairedWorkerRequest): void {
  if (disposed) return;
  if (message.type === 'dispose') {
    disposed = true;
    pending = null;
    active?.controller.abort();
    cache.clear();
    return;
  }
  if (message.type === 'cancel') {
    if (pending?.requestId === message.requestId) {
      const cancelled = pending;
      pending = null;
      post({ type: 'cancelled', requestId: cancelled.requestId, generation: cancelled.generation });
    }
    if (active?.request.requestId === message.requestId) active.controller.abort();
    return;
  }
  pending = message;
  active?.controller.abort();
  void pump();
}

self.addEventListener('message', (event: MessageEvent<PairedWorkerRequest>) => handlePairedWorkerMessage(event.data));
