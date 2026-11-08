/**
 * host-executor.ts — carries out the sheet manager's commands, and feeds it the events that come back.
 *
 * The manager (sheet-manager.ts) is a pure reducer: events in, commands out. This is the thin shell around it that owns
 * what a reducer cannot: the clock, the timer behind `nextWakeMs`, one AbortController per request in flight, and the
 * rule that a reply for a cancelled request is dropped. It owns no fetch, no worker, no GL and no DOM either; every one
 * of those is a PORT the page supplies (streaming-host/city-stream.ts), which is what lets node drive the whole loop with
 * a fake clock and a fake network and check the exact order of effects.
 *
 *   dispatch(event) --> reducer --> commands --> ports ... --> (later) load-finished / load-failed --> dispatch(...)
 *
 * SERIAL BY CONSTRUCTION. A port may answer synchronously (a cache hit), and an event dispatched from inside a command's
 * effect would otherwise interleave with the rest of that command batch. Events are queued and drained one at a time, so
 * the commands of one transition are always carried out, in order, before the next transition begins.
 *
 * A FAILING PORT NEVER STOPS THE BATCH. An effect that throws is reported to `onError` and the remaining commands still
 * run; a `load` that throws becomes a `load-failed` for its request, exactly as a rejected promise does.
 */
import type { ExploreDeviceTier } from '../explore/runtime-budget.ts';
import type { ManagerCommand, ManagerEvent, Level, Priority, SheetManager } from './sheet-manager.ts';
import type { SheetCode } from '../scope/sheets.ts';

export interface LoadJob {
  readonly requestId: number;
  readonly sheet: SheetCode;
  readonly level: Level;
  readonly priority: Priority;
  /** Aborted when the manager cancels the request. A port that honours it should reject with an AbortError; either way
   *  the executor ignores the outcome of an aborted request. */
  readonly signal: AbortSignal;
}

type Of<T extends ManagerCommand['type']> = Extract<ManagerCommand, { type: T }>;

export interface ExecutorPorts {
  /** Monotonic milliseconds (performance.now in the page). */
  now(): number;
  /** Run `fn` after `delayMs`; returns the cancel function. */
  schedule(delayMs: number, fn: () => void): () => void;
  /** Fetch and prepare one level of one sheet. Resolve = ready, reject = failed. */
  load(job: LoadJob): Promise<void>;
  reprioritise(command: Of<'reprioritise'>): void;
  evict(command: Of<'evict'>): void;
  makeCurrent(command: Of<'make-current'>): void;
  disposeMesh(command: Of<'dispose-mesh'>): void;
  rebuildMesh(command: Of<'rebuild-mesh'>): void;
  loader(command: Of<'loader'>): void;
  solve(command: Of<'solve'>): void;
  failure(command: Of<'failure'>): void;
  refuse(command: Of<'refuse'>): void;
  /** A port threw. Optional: the default is console.warn. */
  onError?(error: unknown, command: ManagerCommand): void;
}

/** Every command type the executor handles, so a new one is a compile error here rather than a silent no-op. */
function assertNever(x: never): never { throw new Error(`Unhandled command ${JSON.stringify(x)}`); }

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

/** Events the page sends; `atMs` is stamped here so a caller cannot get the clock wrong. */
export type PageEvent =
  | { readonly type: 'start'; readonly sheet: SheetCode }
  | { readonly type: 'select'; readonly sheet: string }
  | { readonly type: 'camera'; readonly lon: number; readonly lat: number; readonly gesturing: boolean; readonly headingDeg: number | null }
  | { readonly type: 'retry'; readonly sheet: SheetCode; readonly level: Level }
  | { readonly type: 'opened'; readonly sheet: SheetCode }
  | { readonly type: 'open-failed'; readonly sheet: SheetCode }
  | { readonly type: 'handover-done' }
  | { readonly type: 'tier-changed'; readonly tier: ExploreDeviceTier }
  | { readonly type: 'network-changed'; readonly network: 'fast' | 'constrained' }
  | { readonly type: 'memory-pressure'; readonly level: 'none' | 'moderate' | 'critical' };

export interface SheetExecutor {
  /** Send the manager an event from the page. */
  send(event: PageEvent): void;
  /** Cancel every request, the timer, and stop reacting to late replies. */
  dispose(): void;
  /** Requests currently in flight (for tests and the status line). */
  inFlight(): number;
}

export function createExecutor(manager: SheetManager, ports: ExecutorPorts): SheetExecutor {
  const controllers = new Map<number, AbortController>();
  const queue: ManagerEvent[] = [];
  let draining = false;
  let cancelTimer: (() => void) | null = null;
  let disposed = false;

  const warn = (error: unknown, command: ManagerCommand): void => {
    if (ports.onError) ports.onError(error, command);
    else console.warn(`sheet executor: ${command.type} failed`, error);
  };

  const guard = (command: ManagerCommand, effect: () => void): void => {
    try { effect(); } catch (error) { warn(error, command); }
  };

  const start = (command: Of<'load'>): void => {
    const controller = new AbortController();
    controllers.set(command.requestId, controller);
    const job: LoadJob = { requestId: command.requestId, sheet: command.sheet, level: command.level, priority: command.priority, signal: controller.signal };
    const settle = (event: ManagerEvent): void => {
      if (disposed || controller.signal.aborted || controllers.get(command.requestId) !== controller) return;   // cancelled: drop it
      controllers.delete(command.requestId);
      enqueue(event);
    };
    let pending: Promise<void>;
    try { pending = ports.load(job); } catch (error) { pending = Promise.reject(error); }
    pending.then(
      () => settle({ type: 'load-finished', atMs: ports.now(), requestId: command.requestId }),
      (error: unknown) => {
        if (isAbort(error) && controller.signal.aborted) return;
        settle({ type: 'load-failed', atMs: ports.now(), requestId: command.requestId, reason: error instanceof Error ? error.message : String(error) });
      },
    );
  };

  const run = (command: ManagerCommand): void => {
    switch (command.type) {
      case 'load': guard(command, () => start(command)); break;
      case 'cancel': controllers.get(command.requestId)?.abort(); controllers.delete(command.requestId); break;
      case 'reprioritise': guard(command, () => ports.reprioritise(command)); break;
      case 'evict': guard(command, () => ports.evict(command)); break;
      case 'make-current':                                     // a port that cannot even start the open has failed it
        try { ports.makeCurrent(command); }
        catch (error) { warn(error, command); queue.push({ type: 'open-failed', atMs: ports.now(), sheet: command.sheet }); }
        break;
      case 'dispose-mesh': guard(command, () => ports.disposeMesh(command)); break;
      case 'rebuild-mesh': guard(command, () => ports.rebuildMesh(command)); break;
      case 'loader': guard(command, () => ports.loader(command)); break;
      case 'solve': guard(command, () => ports.solve(command)); break;
      case 'failure': guard(command, () => ports.failure(command)); break;
      case 'refuse': guard(command, () => ports.refuse(command)); break;
      default: assertNever(command);
    }
  };

  const rearm = (): void => {
    cancelTimer?.();
    cancelTimer = null;
    if (disposed) return;
    const now = ports.now();
    const wake = manager.nextWakeMs(now);
    if (wake === null) return;
    /* THE TICK IS STAMPED NO EARLIER THAN THE WAKE TIME IT WAS SET FOR. A host timer may fire a fraction of a millisecond EARLY (Node and
       browsers both round); the manager would then see a tick just short of the wake time and do nothing, and `rearm` would find that wake
       time already behind it and set no timer, so the loader's reveal stalled until the next unrelated event (seen in the integration
       test: a 400 ms quiet window ending at 991 ms). The timer WAS due; saying so costs nothing. */
    cancelTimer = ports.schedule(Math.max(0, wake - now), () => { cancelTimer = null; enqueue({ type: 'tick', atMs: Math.max(ports.now(), wake) }); });
  };

  const drain = (): void => {
    if (draining) return;
    draining = true;
    try {
      for (let event = queue.shift(); event !== undefined && !disposed; event = queue.shift()) {
        for (const command of manager.dispatch(event)) run(command);
      }
    } finally {
      draining = false;
    }
    rearm();
  };

  function enqueue(event: ManagerEvent): void {
    if (disposed) return;
    queue.push(event);
    drain();
  }

  return {
    send(event: PageEvent): void { enqueue({ ...event, atMs: ports.now() } as ManagerEvent); },
    dispose(): void {
      disposed = true;
      cancelTimer?.(); cancelTimer = null;
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
      queue.length = 0;
    },
    inFlight: () => controllers.size,
  };
}
