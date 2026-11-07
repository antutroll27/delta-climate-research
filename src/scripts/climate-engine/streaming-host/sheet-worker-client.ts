/**
 * sheet-worker-client.ts — promise-based access to the sheet worker, spawned ONCE and early (the first worker prototype
 * took 1.0-1.3 s from spawn to first message, mostly fetching the chunk with three.js in it; spawning at stream start hides
 * that behind the page's own load, P0 section 2).
 *
 * Requests queue inside the worker, one at a time, in the order sent. An aborted request is not interrupted (a worker job
 * cannot be); its reply is dropped, which is cheap because the heavy buffers are Transferables.
 */
import type { SimLayers } from '../types.ts';
import type { Spatial } from '../heat-map-model.ts';
import type { TerrainField } from '../terrain.ts';
import type { ExploreDeviceTier } from '../explore/runtime-budget.ts';
import type { MassingMesh, PackedMesh } from '../streaming/prism-mesh.ts';
import type { BevelMesh } from './bevel-core.ts';
import type { SurfaceInput, WorkerReply, WorkerRequest } from './sheet-worker-protocol.ts';

export interface Prepared { readonly base: SimLayers; readonly spatial: Spatial; readonly buildings: number; readonly ms: number }

export interface SheetWorker {
  prepare(key: string, wardText: string, roadsText: string | null, means: { fvc: number; albedo: number }, surface: SurfaceInput | null, signal?: AbortSignal): Promise<Prepared>;
  mesh(key: string, wardText: string, tier: ExploreDeviceTier, terrain: TerrainField | null, ao: { n: number; nearM: number } | null, signal?: AbortSignal): Promise<{ mesh: PackedMesh | BevelMesh; ao: Uint8Array | null; ms: number }>;
  massing(key: string, wardText: string, signal?: AbortSignal): Promise<{ mesh: MassingMesh; ms: number }>;
  forget(key: string): void;
  dispose(): void;
}

export function spawnSheetWorker(): SheetWorker {
  const worker = new Worker(new URL('./sheet-worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  const waiting = new Map<number, { resolve: (reply: WorkerReply) => void; reject: (error: Error) => void }>();
  worker.onmessage = (event: MessageEvent<WorkerReply>): void => {
    const w = waiting.get(event.data.id);
    if (w === undefined) return;
    waiting.delete(event.data.id);
    if (event.data.op === 'failed') w.reject(new Error(event.data.message)); else w.resolve(event.data);
  };
  worker.onerror = (event): void => {
    const error = new Error(event.message || 'sheet worker failed');
    for (const w of waiting.values()) w.reject(error);
    waiting.clear();
  };

  const call = (build: (id: number) => WorkerRequest, transfer: ArrayBuffer[], signal?: AbortSignal): Promise<WorkerReply> => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('aborted', 'AbortError')); return; }
    const id = nextId++;
    const abort = (): void => { waiting.delete(id); reject(new DOMException('aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    waiting.set(id, {
      resolve: (reply) => { signal?.removeEventListener('abort', abort); resolve(reply); },
      reject: (error) => { signal?.removeEventListener('abort', abort); reject(error); },
    });
    worker.postMessage(build(id), transfer);
  });

  return {
    async prepare(key, wardText, roadsText, means, surface, signal) {
      /* The surface arrays are COPIED in, not transferred: the page keeps them for the app's own surface cache. */
      const reply = await call((id) => ({ op: 'prepare', id, key, wardText, roadsText, means, surface }), [], signal);
      if (reply.op !== 'prepared') throw new Error(`unexpected reply ${reply.op}`);
      return reply;
    },
    async mesh(key, wardText, tier, terrain, ao, signal) {
      const reply = await call((id) => ({ op: 'mesh', id, key, wardText, tier, terrain, ao }), [], signal);
      if (reply.op !== 'meshed') throw new Error(`unexpected reply ${reply.op}`);
      return reply;
    },
    async massing(key, wardText, signal) {
      const reply = await call((id) => ({ op: 'massing', id, key, wardText }), [], signal);
      if (reply.op !== 'massed') throw new Error(`unexpected reply ${reply.op}`);
      return reply;
    },
    forget(key) { worker.postMessage({ op: 'forget', key } satisfies WorkerRequest); },
    dispose() {
      worker.terminate();
      const error = new Error('sheet worker disposed');
      for (const w of waiting.values()) w.reject(error);
      waiting.clear();
    },
  };
}
