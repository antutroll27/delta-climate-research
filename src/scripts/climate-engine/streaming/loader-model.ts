/**
 * loader-model.ts — the whole-city loading screen as a pure state machine (city-streaming P4).
 *
 * WHAT DRIVES IT. Only what the sheet manager says (`loader` rise / plate / end, `failure`, plus `cancel`, `evict` and
 * `make-current` for bookkeeping) and the real stage events the host reports as each level lands. There is no clock of
 * its own that invents progress: `progressOf` is `loader-progress.ts` over the stages that actually completed, and the
 * bar the view draws only ever trails it. Time enters in exactly two places, both named below: the short REVEAL_DELAY
 * before a rise is drawn (so a load that finishes just after the manager's fast-path window still flashes nothing), and
 * the first-entry minimum (founder D8: 1.5 s, first entry only).
 *
 * THE THREE DESIGNS (founder D2, 2026-11-07):
 *   A  rise in place   the default. No overlay: a hairline frame, a code tag, a step list; the buildings rise (a uniform).
 *   B  sheet plate     the manager's `plate` phase (PLATE_AFTER_MS = 1.2 s). Sits on top of A; also carries the failure.
 *   C  lidar sweep     the FIRST load of a city in a session only. Adds a survey sweep under the plate and holds 1.5 s.
 *
 * PURE: no DOM, no timers, no GL. tests/unit/loader-model.test.mjs runs every transition in node.
 */
import type { Level, ManagerCommand } from './sheet-manager.ts';
import { createProgress, type Stage as ProgressStage } from '../loader-progress.ts';
import { sheetByCode, type SheetCode } from '../scope/sheets.ts';

// ── constants (each one a decision, not a tuning knob to wiggle) ───────────────────────────────────────────────

/** A rise is only DRAWN this long after the manager's `rise` command (which itself comes at SKIP_FAST_MS = 400 ms). A sheet
 *  that lands within it is a fast path: nothing was ever on screen, so nothing flashes. */
export const REVEAL_DELAY_MS = 150;
/** Founder D8: the minimum time the loading screen stays up on the FIRST entry into a city. In-app moves have none. */
export const FIRST_ENTRY_MIN_MS = 1_500;
/** The building rise when a loader was on screen: the page's existing grow length (heat-map-app GROW_MS). */
export const RISE_MS = 1_900;
/** The rise when nothing was shown (a cached swap): still a rise, never a pop, but short. */
export const QUICK_RISE_MS = 700;
/** Stage sets kept for sheets other than the one on screen (cancelled loads resume from them if the data is still held). */
const MAX_TRACKED_SHEETS = 6;

// ── stages ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** PLAN 5.2: `massing` (LOD1 already on screen), `ward` (footprints parsed and extruded in the worker), `surface`, `vector`
 *  (roads, water, trees) and `sim` (the first solver burst). They are `loader-progress.ts`'s five, with `shell` read as `massing`. */
export const TILE_STAGES = ['massing', 'ward', 'surface', 'vector', 'sim'] as const;
export type TileStage = (typeof TILE_STAGES)[number];

const PROGRESS_STAGE: Readonly<Record<TileStage, ProgressStage>> = Object.freeze({
  massing: 'shell', ward: 'ward', surface: 'surface', vector: 'vector', sim: 'sim',
});

/** The stage each manager level finishing means. `lod0` finishing is the footprints; the host reports the sub-steps of the
 *  bundle (`surface`, `vector`) and the first solve (`sim`) itself. */
export const STAGE_OF_LEVEL: Readonly<Record<Level, TileStage | null>> = Object.freeze({ lod1: 'massing', lod0: 'ward', halo: null });

export const STAGE_LABEL: Readonly<Record<TileStage, string>> = Object.freeze({
  massing: 'Massing', ward: 'Footprints', surface: 'Surface', vector: 'Roads · water · trees', sim: 'Heat solve',
});

/** Facts that arrive with the data, shown beside their stage on the plate. Every field optional: a row without one shows a tick. */
export interface SheetFacts {
  readonly buildings?: number;
  readonly terrainMinM?: number;
  readonly terrainMaxM?: number;
  readonly surfaceScenes?: number;
  readonly trees?: number;
}

// ── state ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type LoaderMode = 'idle' | 'rise' | 'plate' | 'failed';
export type LoaderDesign = 'A' | 'C';

export interface LoaderFailure {
  readonly sheet: SheetCode;
  readonly level: Level;
  readonly attempts: number;
}

export interface LoaderStatus {
  readonly text: string;
  /** failures are announced assertively, everything else politely */
  readonly kind: 'polite' | 'assertive';
  /** increments on every announcement, so the view can re-announce identical text */
  readonly seq: number;
}

export interface RisePlan {
  /** when the rise starts (host clock), and how long it lasts; 0 = no motion (reduced motion) */
  readonly startMs: number;
  readonly durationMs: number;
  /** a loader was on screen for this arrival */
  readonly afterLoader: boolean;
}

export interface LoaderState {
  readonly mode: LoaderMode;
  readonly sheet: SheetCode | null;
  readonly design: LoaderDesign;
  /** when the command that left `idle` arrived */
  readonly sinceMs: number | null;
  /** when the loader becomes visible: `sinceMs + REVEAL_DELAY_MS` for a rise, `sinceMs` for a plate or a failure */
  readonly visibleAtMs: number | null;
  /** the loader has been announced (it was visible at least once) */
  readonly announced: boolean;
  /** an `end` arrived but the first-entry minimum is still running */
  readonly endPending: boolean;
  /** no earlier than this the first-entry loader may end */
  readonly holdUntilMs: number | null;
  /** the first load of this city has already been through make-current: later loads are design A */
  readonly entered: boolean;
  readonly reducedMotion: boolean;
  readonly failure: LoaderFailure | null;
  readonly stages: ReadonlyMap<SheetCode, readonly TileStage[]>;
  readonly facts: ReadonlyMap<SheetCode, SheetFacts>;
  readonly status: LoaderStatus;
  readonly rise: RisePlan | null;
  /** the last `end`: when, and whether the loader had been visible */
  readonly lastEnd: { readonly atMs: number; readonly shown: boolean } | null;
}

export interface LoaderOptions {
  /** True (the default) until the city's first load has been through. */
  readonly firstEntry?: boolean;
  readonly reducedMotion?: boolean;
}

export function initialLoaderState(options: LoaderOptions = {}): LoaderState {
  return Object.freeze({
    mode: 'idle', sheet: null, design: 'A', sinceMs: null, visibleAtMs: null, announced: false, endPending: false, holdUntilMs: null,
    entered: options.firstEntry === false, reducedMotion: options.reducedMotion === true, failure: null,
    stages: new Map(), facts: new Map(), status: Object.freeze({ text: '', kind: 'polite', seq: 0 }), rise: null, lastEnd: null,
  });
}

// ── events ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type LoaderEvent =
  /** Any manager command; the ones the loader does not care about are ignored, so the host can forward them all. */
  | { readonly type: 'command'; readonly atMs: number; readonly command: ManagerCommand }
  /** A real stage finished for `sheet`. Safe to send before the loader is shown (the quiet phase) and for any sheet. */
  | { readonly type: 'stage'; readonly atMs: number; readonly sheet: SheetCode; readonly stage: TileStage }
  | { readonly type: 'facts'; readonly atMs: number; readonly sheet: SheetCode; readonly facts: SheetFacts }
  /** The person pressed Retry. The host then sends the manager's `retry` event (see `retryEventOf`). */
  | { readonly type: 'retry'; readonly atMs: number }
  | { readonly type: 'tick'; readonly atMs: number }
  /** A new city (or a restart): drop everything. `firstEntry` true = the next load is design C. */
  | { readonly type: 'reset'; readonly atMs: number; readonly firstEntry: boolean }
  | { readonly type: 'reduced-motion'; readonly atMs: number; readonly reduced: boolean };

// ── helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** "E4 · Canal Ring". An unknown code (should not happen) falls back to the code itself. */
export function sheetLabel(code: SheetCode | null): string {
  if (code === null) return '';
  return sheetByCode(code)?.label ?? code;
}
/** "E4" and "Canal Ring" apart, for the plate's big code and its name line. */
export function sheetParts(code: SheetCode): { readonly code: string; readonly name: string } {
  const label = sheetLabel(code);
  const dot = label.indexOf(' · ');
  return dot < 0 ? { code, name: '' } : { code: label.slice(0, dot), name: label.slice(dot + 3) };
}

/** Real progress, 0..1, monotonic for a given set of stages (loader-progress.ts). Nothing here is ever printed as a percentage. */
export function progressOf(state: LoaderState, sheet: SheetCode | null = state.sheet): number {
  if (sheet === null) return 0;
  const p = createProgress();
  for (const stage of state.stages.get(sheet) ?? []) p.complete(PROGRESS_STAGE[stage]);
  return p.value();
}

export function stagesOf(state: LoaderState, sheet: SheetCode | null = state.sheet): readonly TileStage[] {
  return sheet === null ? [] : state.stages.get(sheet) ?? [];
}

/** Is anything of the loader on screen at `nowMs`? A rise is drawn only REVEAL_DELAY_MS after its command. */
export function isVisible(state: LoaderState, nowMs: number): boolean {
  return state.mode !== 'idle' && state.visibleAtMs !== null && nowMs >= state.visibleAtMs;
}

/** The plate (B) is up: the manager's plate phase, or a failure. Design C's sweep is separate (`showsSweep`). */
export function showsPlate(state: LoaderState, nowMs: number): boolean {
  return (state.mode === 'plate' || state.mode === 'failed') && isVisible(state, nowMs);
}
export function showsRise(state: LoaderState, nowMs: number): boolean {
  return (state.mode === 'rise' || state.mode === 'plate') && state.design === 'A' && isVisible(state, nowMs);
}
export function showsSweep(state: LoaderState, nowMs: number): boolean {
  return (state.mode === 'rise' || state.mode === 'plate') && state.design === 'C' && isVisible(state, nowMs);
}

/** The manager event that a Retry press becomes (`PageEvent` in host-executor.ts adds `atMs` itself). Null when nothing failed. */
export function retryEventOf(state: LoaderState): { readonly type: 'retry'; readonly sheet: SheetCode; readonly level: Level } | null {
  return state.failure === null ? null : { type: 'retry', sheet: state.failure.sheet, level: state.failure.level };
}

/** 0..1 for the building rise (the renderer's `grow` uniform; the shader eases each building by its own delay). */
export function riseValue(plan: RisePlan | null, nowMs: number): number {
  if (plan === null || plan.durationMs <= 0) return 1;
  return Math.max(0, Math.min(1, (nowMs - plan.startMs) / plan.durationMs));
}

/** The next time something time-based comes due, or null. A host that sets one timeout from this needs no polling tick. */
export function nextLoaderWakeMs(state: LoaderState, nowMs: number): number | null {
  const due: number[] = [];
  if (state.mode !== 'idle' && !state.announced && state.visibleAtMs !== null) due.push(state.visibleAtMs);
  if (state.endPending && state.holdUntilMs !== null) due.push(state.holdUntilMs);
  const ahead = due.filter((t) => t > nowMs);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

// ── the reducer ─────────────────────────────────────────────────────────────────────────────────────────────────

type Draft = { -readonly [K in keyof LoaderState]: LoaderState[K] };

const say = (d: Draft, text: string, kind: LoaderStatus['kind'] = 'polite'): void => {
  d.status = Object.freeze({ text, kind, seq: d.status.seq + 1 });
};

function setStages(d: Draft, sheet: SheetCode, next: readonly TileStage[] | null): void {
  const m = new Map(d.stages);
  m.delete(sheet);                                   // re-insert = newest, so the oldest are the ones that fall out
  if (next !== null && next.length > 0) m.set(sheet, next);
  while (m.size > MAX_TRACKED_SHEETS) m.delete(m.keys().next().value as SheetCode);
  d.stages = m;
}

/** Time-based transitions: the loader becoming visible, and the first-entry minimum running out. Idempotent. */
function settle(d: Draft, now: number): void {
  if (d.mode !== 'idle' && !d.announced && d.visibleAtMs !== null && now >= d.visibleAtMs) {
    d.announced = true;
    if (d.mode === 'failed') say(d, `${sheetLabel(d.sheet)} could not be loaded. Retry is available.`, 'assertive');
    else say(d, `Loading ${sheetLabel(d.sheet)}.`);
  }
  if (d.endPending && d.holdUntilMs !== null && now >= d.holdUntilMs) finish(d, now);
}

/** The loader is over. Said aloud only if it was ever on screen: a fast path stays silent as well as invisible. */
function finish(d: Draft, now: number): void {
  const shown = d.announced;
  if (shown && d.mode !== 'failed') say(d, `${sheetLabel(d.sheet)} is ready.`);
  if (d.sheet !== null) setStages(d, d.sheet, null);
  d.lastEnd = { atMs: now, shown };
  d.mode = 'idle'; d.sinceMs = null; d.visibleAtMs = null; d.announced = false; d.endPending = false; d.holdUntilMs = null; d.failure = null;
}

function command(d: Draft, c: ManagerCommand, now: number): void {
  switch (c.type) {
    case 'loader': {
      if (c.phase === 'end') {
        if (d.mode === 'idle') return;                                      // never shown, so never ended
        if (d.design === 'C' && d.announced && d.visibleAtMs !== null && now < d.visibleAtMs + FIRST_ENTRY_MIN_MS) {
          d.endPending = true; d.holdUntilMs = d.visibleAtMs + FIRST_ENTRY_MIN_MS;   // D8: first entry only
          return;
        }
        finish(d, now);
        return;
      }
      if (d.mode === 'idle') {
        d.design = d.entered ? 'A' : 'C';
        d.sinceMs = now;
        d.visibleAtMs = c.phase === 'plate' ? now : now + REVEAL_DELAY_MS;
        d.announced = false; d.endPending = false; d.holdUntilMs = null; d.failure = null;
      } else if (d.mode === 'failed') {
        d.failure = null; d.announced = false; d.sinceMs = now; d.visibleAtMs = now;          // the manager moved on from the failure
      } else if (d.sheet !== c.sheet && d.announced) {
        d.announced = false;                                                // a retarget re-announces the new sheet
        d.visibleAtMs = now;
      }
      d.mode = c.phase;                                                     // 'rise' | 'plate'
      d.sheet = c.sheet;
      if (c.phase === 'plate' && d.visibleAtMs !== null && d.visibleAtMs > now) d.visibleAtMs = now;   // the plate is never held back
      return;
    }
    case 'failure': {
      if (d.mode === 'idle') { d.design = d.entered ? 'A' : 'C'; }
      d.mode = 'failed'; d.sheet = c.sheet; d.failure = { sheet: c.sheet, level: c.level, attempts: c.attempts };
      d.sinceMs = now; d.visibleAtMs = now; d.announced = false; d.endPending = false; d.holdUntilMs = null;
      setStages(d, c.sheet, null);                                          // a retry starts clean
      return;
    }
    case 'cancel': {
      if (c.level === 'lod0') setStages(d, c.sheet, null);
      return;
    }
    case 'evict': {
      const have = d.stages.get(c.sheet);
      if (have === undefined) return;
      if (c.level === 'lod0') setStages(d, c.sheet, have.filter((s) => s === 'massing'));
      else if (c.level === 'lod1') setStages(d, c.sheet, have.filter((s) => s !== 'massing'));
      return;
    }
    case 'make-current': {
      const shownNow = d.mode !== 'idle' && d.visibleAtMs !== null && now >= d.visibleAtMs;
      const justEnded = d.lastEnd !== null && Math.abs(d.lastEnd.atMs - now) <= 50 && d.lastEnd.shown;
      const afterLoader = shownNow || justEnded;
      d.rise = Object.freeze({ startMs: now, durationMs: d.reducedMotion ? 0 : afterLoader ? RISE_MS : QUICK_RISE_MS, afterLoader });
      d.entered = true;
      return;
    }
    default: return;                                                        // load, reprioritise, solve, refuse, dispose-mesh, rebuild-mesh
  }
}

export function reduceLoader(state: LoaderState, event: LoaderEvent): LoaderState {
  const d: Draft = { ...state };
  const now = event.atMs;
  settle(d, now);
  switch (event.type) {
    case 'command': command(d, event.command, now); break;
    case 'stage': {
      const have = d.stages.get(event.sheet) ?? [];
      if (!have.includes(event.stage)) setStages(d, event.sheet, TILE_STAGES.filter((s) => s === event.stage || have.includes(s)));
      break;
    }
    case 'facts': {
      const m = new Map(d.facts); m.set(event.sheet, { ...m.get(event.sheet), ...event.facts });
      while (m.size > MAX_TRACKED_SHEETS) m.delete(m.keys().next().value as SheetCode);
      d.facts = m;
      break;
    }
    case 'retry': {
      if (d.mode !== 'failed' || d.failure === null) break;
      d.mode = 'plate'; d.failure = null; d.sinceMs = now; d.visibleAtMs = now; d.announced = false;   // the manager's loader is still in its plate phase
      break;
    }
    case 'tick': break;
    case 'reset': {
      const keepReduced = d.reducedMotion;
      Object.assign(d, initialLoaderState({ firstEntry: event.firstEntry, reducedMotion: keepReduced }), { status: Object.freeze({ text: '', kind: 'polite', seq: d.status.seq }) });
      break;
    }
    case 'reduced-motion': d.reducedMotion = event.reduced; break;
    default: { const never: never = event; throw new Error(`unhandled loader event ${JSON.stringify(never)}`); }
  }
  settle(d, now);
  return Object.freeze(d);
}

// ── a stateful wrapper for hosts that want one object (and for the view) ───────────────────────────────────────

export interface LoaderModel {
  dispatch(event: LoaderEvent): LoaderState;
  state(): LoaderState;
  nextWakeMs(nowMs: number): number | null;
}

export function createLoaderModel(options: LoaderOptions = {}): LoaderModel {
  let state = initialLoaderState(options);
  return {
    dispatch(event) { state = reduceLoader(state, event); return state; },
    state: () => state,
    nextWakeMs: (nowMs) => nextLoaderWakeMs(state, nowMs),
  };
}
