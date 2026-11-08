/**
 * late-stream.ts — the page furniture's handle on a stream controller that does not exist yet.
 *
 * `startStream` builds the picker, the Area select and the loader's Retry BEFORE the controller (the controller's hooks call them), and
 * awaits the device-capability probe in between. A click in that gap used to dereference a `const` still in its temporal dead zone: a
 * ReferenceError, and on the Area select the choice was swallowed after `stopImmediatePropagation` (INT audit F6). Here the choice is
 * KEPT (the latest one wins) and handed over the moment the controller is bound. A retry has nothing to retry before any load: dropped.
 */
import type { Level } from './sheet-manager.ts';
import type { SheetCode } from '../scope/sheets.ts';

export interface ChoosableStream {
  select(code: string): void;
  retry(code: SheetCode, level: Level): void;
}

export interface LateStream extends ChoosableStream {
  /** The controller exists: pass on the choice made before it did (once), and everything after goes straight through. */
  bind(target: ChoosableStream): void;
}

export function createLateStream(): LateStream {
  let target: ChoosableStream | null = null;
  let queued: string | null = null;
  return {
    select(code) { if (target === null) queued = code; else target.select(code); },
    retry(code, level) { target?.retry(code, level); },
    bind(next) {
      target = next;
      const choice = queued;
      queued = null;
      if (choice !== null) next.select(choice);
    },
  };
}
