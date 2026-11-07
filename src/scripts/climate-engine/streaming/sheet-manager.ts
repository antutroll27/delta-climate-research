/**
 * sheet-manager.ts — which sheets of a streamed city are loaded, loading or gone, as a pure state machine.
 *
 * EVENTS IN, COMMANDS OUT, NOTHING ELSE. `reduce(config, state, event)` returns the next state and the commands the host
 * (the page, later) must carry out: fetch this, cancel that, free this, swap the mesh, show the loader, solve. The machine
 * owns no timer, no fetch, no GL and no DOM; the host feeds it a monotonic `atMs` on every event and a `tick` whenever
 * `nextWakeMs` says something is due. That is what lets node test every transition, and the exact order of commands.
 *
 * THE SHAPE OF A SHEET. Three levels per sheet, each its own little state:
 *   lod0  the full bundle (footprints, trees, roads, surface...), and from it the merged mesh. The current sheet only,
 *         plus recently visited ones while the LRU allows.
 *   lod1  grey block massing, for the neighbour ring. Small.
 *   halo  the neighbours' solver ground for the 504-cell halo solve (halo-solve.ts). Small; always travels with lod0.
 * A level is `absent`, `loading`, `ready`, `evicted` (was ready, freed) or `failed`.
 *
 * WHERE THE USER IS. `current` is the sheet the user is IN (intent, set the moment they choose or cross a seam).
 * `displayed` is the sheet whose mesh is on screen; the two differ while the new sheet loads, which is exactly the span a
 * loader covers. `outgoing` is the old mesh kept for a cross-fade (tier `full`, only if the GPU ceiling allows both) until
 * the host says `handover-done`. On other tiers the old mesh is disposed first, then the new one is built.
 *
 * MOVING. (1) `select`: the index map, the switcher or Shift+arrow: immediate. (2) `camera`: the map centre crossing a
 * seam. It switches only when the centre is at least `hysteresisM` (200 m) INSIDE the new sheet, measured to that sheet's
 * nearest edge, and the gesture has been over for `idleMs` (400 ms). Going back needs 200 m the other way, so hovering on a
 * seam never flaps, and a pan across a skipped or outside cell never asks for it.
 *
 * LOADING. `reconcile` is declarative: it computes what SHOULD be resident (current lod0 + halo at high priority; then,
 * once the current lod0 is ready, the ring's lod1 and ONE heading-prefetched lod0 at low priority), compares it with what
 * is, and emits the difference: cancels first (a stale load is cancelled, and its late `load-finished` is ignored), then
 * evictions, then loads. A prefetch never evicts anything (it only fills a free slot) and never runs on a constrained
 * network, under memory pressure, or on a tier whose policy says `none`. Skipped and outside cells are never requested:
 * the ring is built from the topology's shipping sheets only.
 *
 * FAILURE. A failed level is retried by itself after `RETRY_BACKOFF_MS`, then left; an exhausted level of the CURRENT sheet
 * is reported once (`failure`) and waits for an explicit `retry`.
 */
import type { ExploreDeviceTier } from '../explore/runtime-budget.ts';
import { SKIP_FAST_MS } from '../loader-progress.ts';
import type { SheetCode } from '../scope/sheets.ts';
import {
  CROSSING, MAX_ATTEMPTS, PLATE_AFTER_MS, RETRY_BACKOFF_MS, SHEET_BUDGETS, lod0MeshMB,
  type NetworkClass, type TierBudget,
} from './sheet-budgets.ts';
import { lruVictims, type LruEntry } from './sheet-cache.ts';
import {
  AMSTERDAM_TOPOLOGY, DIRECTIONS, EDGE_DIRECTIONS, directionOfHeading, headingFan, isEdgeDirection,
  type Direction, type SheetTopology,
} from './sheet-topology.ts';

// ── vocabulary ──────────────────────────────────────────────────────────────

export type Level = 'lod0' | 'halo' | 'lod1';
export type Priority = 'high' | 'low';
export type MemoryPressure = 'none' | 'moderate' | 'critical';

export type LevelEntry =
  | { readonly status: 'absent' }
  | { readonly status: 'loading'; readonly requestId: number; readonly priority: Priority; readonly sinceMs: number; readonly attempts: number }
  | { readonly status: 'ready'; readonly usedSeq: number; readonly sinceMs: number }
  | { readonly status: 'evicted' }
  | { readonly status: 'failed'; readonly attempts: number; readonly atMs: number };

export type SheetEntry = Readonly<Record<Level, LevelEntry>>;

export type LoaderPhase = 'quiet' | 'rise' | 'plate';

export interface ManagerState {
  readonly tier: ExploreDeviceTier;
  readonly network: NetworkClass;
  readonly pressure: MemoryPressure;
  /** Where the user is. */
  readonly current: SheetCode | null;
  /** Whose lod0 mesh is on screen. */
  readonly displayed: SheetCode | null;
  /** The previous mesh, kept for a cross-fade until `handover-done`. */
  readonly outgoing: SheetCode | null;
  /** The sheet the last `solve` was issued for (reset when `current` changes). */
  readonly solved: SheetCode | null;
  readonly heading: Direction | null;
  /** Camera crossings are live only once the camera has been seen inside `current`: after a `select` the camera is still
   *  over the old sheet, and must not drag the user straight back to it. */
  readonly armed: boolean;
  /** The last camera event said a gesture is on (pointer down, inertia, a flyTo). A held pointer sends no motion, so this
   *  flag, not silence, is what keeps a crossing from firing mid-gesture. */
  readonly gesturing: boolean;
  readonly camera: { readonly lon: number; readonly lat: number } | null;
  readonly lastMotionMs: number;
  readonly loader: { readonly sheet: SheetCode; readonly sinceMs: number; readonly phase: LoaderPhase } | null;
  readonly sheets: ReadonlyMap<SheetCode, SheetEntry>;
  /** LRU clock. */
  readonly seq: number;
  readonly nextRequestId: number;
}

export type ManagerEvent =
  | { readonly type: 'start'; readonly atMs: number; readonly sheet: SheetCode }
  | { readonly type: 'select'; readonly atMs: number; readonly sheet: string }
  | { readonly type: 'camera'; readonly atMs: number; readonly lon: number; readonly lat: number;
      /** pointer down, inertia running, or a flyTo in progress */
      readonly gesturing: boolean;
      /** pan direction, or the map bearing when still; null = unknown (the last one stands) */
      readonly headingDeg: number | null }
  | { readonly type: 'tick'; readonly atMs: number }
  | { readonly type: 'load-finished'; readonly atMs: number; readonly requestId: number }
  | { readonly type: 'load-failed'; readonly atMs: number; readonly requestId: number; readonly reason: string }
  | { readonly type: 'retry'; readonly atMs: number; readonly sheet: SheetCode; readonly level: Level }
  | { readonly type: 'handover-done'; readonly atMs: number }
  | { readonly type: 'tier-changed'; readonly atMs: number; readonly tier: ExploreDeviceTier }
  | { readonly type: 'network-changed'; readonly atMs: number; readonly network: NetworkClass }
  | { readonly type: 'memory-pressure'; readonly atMs: number; readonly level: MemoryPressure };

export type EvictReason = 'lru' | 'distance' | 'budget' | 'pressure' | 'tier' | 'promoted' | 'with-lod0';

export interface HaloNeighbour {
  readonly dir: Direction;
  /** null where the cell does not ship (skipped or outside): the halo asset covers it, or the edge rule does. */
  readonly sheet: SheetCode | null;
}

export type ManagerCommand =
  | { readonly type: 'load'; readonly requestId: number; readonly sheet: SheetCode; readonly level: Level; readonly priority: Priority }
  | { readonly type: 'reprioritise'; readonly requestId: number; readonly sheet: SheetCode; readonly level: Level; readonly priority: Priority }
  | { readonly type: 'cancel'; readonly requestId: number; readonly sheet: SheetCode; readonly level: Level }
  | { readonly type: 'evict'; readonly sheet: SheetCode; readonly level: Level; readonly reason: EvictReason }
  /** Build/show `sheet`'s mesh. `outgoingMesh` says what happens to the previous sheet's mesh. */
  | { readonly type: 'make-current'; readonly sheet: SheetCode; readonly outgoing: SheetCode | null;
      readonly outgoingMesh: 'none' | 'keep-until-handover' | 'dispose-now' }
  | { readonly type: 'dispose-mesh'; readonly sheet: SheetCode }
  | { readonly type: 'loader'; readonly sheet: SheetCode; readonly phase: 'rise' | 'plate' | 'end' }
  /** Solve `sheet` on its halo. `haloLoaded` false = the halo asset failed for good: solve on the edge rule. */
  | { readonly type: 'solve'; readonly sheet: SheetCode; readonly haloLoaded: boolean; readonly neighbours: readonly HaloNeighbour[] }
  | { readonly type: 'refuse'; readonly sheet: string; readonly reason: 'unknown-sheet' }
  | { readonly type: 'failure'; readonly sheet: SheetCode; readonly level: Level; readonly attempts: number };

export interface Transition {
  readonly state: ManagerState;
  readonly commands: readonly ManagerCommand[];
}

export interface ManagerConfig {
  readonly topology: SheetTopology;
  readonly budgets: Readonly<Record<ExploreDeviceTier, TierBudget>>;
  readonly hysteresisM: number;
  readonly idleMs: number;
  /** Requests allowed in flight at low priority at once. */
  readonly lowInFlight: number;
}

export const DEFAULT_CONFIG: ManagerConfig = Object.freeze({
  topology: AMSTERDAM_TOPOLOGY, budgets: SHEET_BUDGETS, hysteresisM: CROSSING.hysteresisM, idleMs: CROSSING.idleMs, lowInFlight: 2,
});

export function initialState(tier: ExploreDeviceTier, network: NetworkClass = 'fast'): ManagerState {
  return Object.freeze({
    tier, network, pressure: 'none', current: null, displayed: null, outgoing: null, solved: null, heading: null, armed: false, gesturing: false, camera: null,
    lastMotionMs: 0, loader: null, sheets: new Map(), seq: 0, nextRequestId: 1,
  });
}

// ── small helpers ───────────────────────────────────────────────────────────

const ABSENT: LevelEntry = Object.freeze({ status: 'absent' });
const BLANK: SheetEntry = Object.freeze({ lod0: ABSENT, halo: ABSENT, lod1: ABSENT });

function assertNever(x: never): never { throw new Error(`Unhandled ${JSON.stringify(x)}`); }

/** A mutable working copy of the state; frozen again on the way out. */
interface Draft {
  tier: ExploreDeviceTier; network: NetworkClass; pressure: MemoryPressure;
  current: SheetCode | null; displayed: SheetCode | null; outgoing: SheetCode | null; solved: SheetCode | null;
  heading: Direction | null; armed: boolean; gesturing: boolean; camera: { lon: number; lat: number } | null; lastMotionMs: number;
  loader: { sheet: SheetCode; sinceMs: number; phase: LoaderPhase } | null;
  sheets: Map<SheetCode, SheetEntry>; seq: number; nextRequestId: number;
}

const draftOf = (s: ManagerState): Draft => ({ ...s, camera: s.camera && { ...s.camera }, loader: s.loader && { ...s.loader }, sheets: new Map(s.sheets) });

function freeze(d: Draft): ManagerState {
  return Object.freeze({ ...d, camera: d.camera && Object.freeze({ ...d.camera }), loader: d.loader && Object.freeze({ ...d.loader }) });
}

export const levelOf = (s: ManagerState | Draft, code: SheetCode, level: Level): LevelEntry => (s.sheets.get(code) ?? BLANK)[level];

function put(d: Draft, code: SheetCode, level: Level, entry: LevelEntry): void {
  d.sheets.set(code, Object.freeze({ ...(d.sheets.get(code) ?? BLANK), [level]: entry }));
}

const isResident = (e: LevelEntry): boolean => e.status === 'ready' || e.status === 'loading';

function touch(d: Draft, code: SheetCode): void {
  d.seq += 1;
  const e = levelOf(d, code, 'lod0');
  if (e.status === 'ready') put(d, code, 'lod0', { ...e, usedSeq: d.seq });
}

/** Every (sheet, level) that is loading, with its entry. */
function inFlight(d: Draft): Array<{ sheet: SheetCode; level: Level; entry: Extract<LevelEntry, { status: 'loading' }> }> {
  const out: Array<{ sheet: SheetCode; level: Level; entry: Extract<LevelEntry, { status: 'loading' }> }> = [];
  for (const [sheet, e] of d.sheets) {
    for (const level of ['lod0', 'halo', 'lod1'] as const) {
      const entry = e[level];
      if (entry.status === 'loading') out.push({ sheet, level, entry });
    }
  }
  return out;
}

// ── the memory model ───────────────────────────────────────────────────────

/**
 * Estimated GPU megabytes of the page: the baseline, the displayed (and outgoing) sheet's merged mesh, and every LOD1
 * mesh that is resident or on its way. A model for budget decisions, not a measurement (see sheet-budgets.ts).
 */
export function gpuMB(cfg: ManagerConfig, s: ManagerState | Draft): number {
  const b = cfg.budgets[s.tier];
  let mb = b.baselineMB;
  for (const code of new Set([s.displayed, s.outgoing])) if (code !== null) mb += lod0MeshMB(s.tier, cfg.topology.buildings(code));
  for (const [, e] of s.sheets) if (isResident(e.lod1)) mb += b.lod1MeshMB;
  return mb;
}

interface Limits { readonly maxLod0: number; readonly ring: 'ring8' | 'edge4' | 'none'; readonly prefetch: boolean }

/** The tier's budget, narrowed by memory pressure and network. */
function limitsOf(cfg: ManagerConfig, d: Draft): Limits {
  const b = cfg.budgets[d.tier];
  if (d.pressure === 'critical') return { maxLod0: 1, ring: 'none', prefetch: false };
  const moderate = d.pressure === 'moderate';
  return {
    maxLod0: moderate ? Math.max(1, b.maxLod0Sheets - 1) : b.maxLod0Sheets,
    ring: moderate ? 'edge4' : b.ring,
    prefetch: !moderate && b.prefetch === 'heading-lod0' && d.network === 'fast',
  };
}

// ── what should be resident ────────────────────────────────────────────────

interface Want { readonly sheet: SheetCode; readonly level: Level; readonly priority: Priority }

/** Ring directions, edge neighbours first and the heading's first of those, corners last: the order a budget trims from the end. */
function ringOrder(shape: 'ring8' | 'edge4', heading: Direction | null): Direction[] {
  const dirs = shape === 'edge4' ? [...EDGE_DIRECTIONS] : [...DIRECTIONS];
  const rank = (dir: Direction): number => (isEdgeDirection(dir) ? 0 : 10) + (dir === heading ? -1 : 0);
  return dirs.sort((a, b) => rank(a) - rank(b));
}

function retryable(e: LevelEntry, now: number): boolean {
  if (e.status === 'absent' || e.status === 'evicted') return true;
  if (e.status === 'failed') return e.attempts < MAX_ATTEMPTS && now >= e.atMs + RETRY_BACKOFF_MS[e.attempts - 1]!;
  return false;
}

function wantedLevels(cfg: ManagerConfig, d: Draft, now: number): Want[] {
  const cur = d.current;
  if (cur === null) return [];
  const wants: Want[] = [{ sheet: cur, level: 'lod0', priority: 'high' }, { sheet: cur, level: 'halo', priority: 'high' }];
  if (levelOf(d, cur, 'lod0').status !== 'ready') return wants;               // the ring and prefetch wait for the real load
  const limits = limitsOf(cfg, d);
  const b = cfg.budgets[d.tier];

  if (limits.ring !== 'none') {
    const meshMB = [...new Set([d.displayed, d.outgoing])].reduce<number>((mb, code) => mb + (code === null ? 0 : lod0MeshMB(d.tier, cfg.topology.buildings(code))), 0);
    const room = Math.max(0, Math.floor((b.gpuCeilingMB - b.baselineMB - meshMB) / b.lod1MeshMB));
    const ring: Want[] = [];
    for (const dir of ringOrder(limits.ring, d.heading)) {
      const n = cfg.topology.neighbour(cur, dir);
      if (n !== null) ring.push({ sheet: n, level: 'lod1', priority: 'low' });
    }
    wants.push(...ring.slice(0, room));
  }

  if (limits.prefetch && d.heading !== null) {
    const fan = headingFan(d.heading).map((dir) => cfg.topology.neighbour(cur, dir)).filter((c): c is SheetCode => c !== null);
    const resident = [...d.sheets.values()].filter((e) => isResident(e.lod0)).length;
    const flying = fan.find((c) => levelOf(d, c, 'lod0').status === 'loading');
    const next = flying ?? (resident < limits.maxLod0 ? fan.find((c) => retryable(levelOf(d, c, 'lod0'), now)) : undefined);
    if (next !== undefined) wants.push({ sheet: next, level: 'lod0', priority: 'low' }, { sheet: next, level: 'halo', priority: 'low' });
  }
  /* A halo asset travels with its lod0: any other sheet that holds (or is fetching) a bundle holds its halo too, so a
     prefetched sheet can become current and solve without another round trip. */
  for (const [sheet, e] of d.sheets) {
    if (sheet !== cur && isResident(e.lod0) && !wants.some((w) => w.sheet === sheet && w.level === 'halo')) wants.push({ sheet, level: 'halo', priority: 'low' });
  }
  return wants;
}

// ── reconcile ──────────────────────────────────────────────────────────────

function reconcile(cfg: ManagerConfig, d: Draft, now: number, out: ManagerCommand[], hint: EvictReason | null): void {
  swapIfReady(cfg, d, out);
  runLoader(d, now, out);
  const wants = wantedLevels(cfg, d, now);
  const wanted = new Set(wants.map((w) => `${w.sheet}/${w.level}`));
  const pinned = new Set<SheetCode>([d.current, d.displayed, d.outgoing].filter((c): c is SheetCode => c !== null));

  // 1. cancel what is no longer wanted; re-rank what became urgent
  for (const f of inFlight(d)) {
    if (!wanted.has(`${f.sheet}/${f.level}`)) {
      out.push({ type: 'cancel', requestId: f.entry.requestId, sheet: f.sheet, level: f.level });
      put(d, f.sheet, f.level, ABSENT);
      continue;
    }
    const want = wants.find((w) => w.sheet === f.sheet && w.level === f.level)!;
    if (want.priority !== f.entry.priority) {
      out.push({ type: 'reprioritise', requestId: f.entry.requestId, sheet: f.sheet, level: f.level, priority: want.priority });
      put(d, f.sheet, f.level, { ...f.entry, priority: want.priority });
    }
  }

  // 2. evict (before any load: free first, then build)
  const limits = limitsOf(cfg, d);
  const evict = (sheet: SheetCode, level: Level, reason: EvictReason): void => {
    put(d, sheet, level, { status: 'evicted' });
    out.push({ type: 'evict', sheet, level, reason });
  };
  const cur = d.current;
  const shape = limits.ring;
  const ringOf = (code: SheetCode | null): SheetCode[] => code === null || shape === 'none' ? []
    : ringOrder(shape, d.heading).map((dir) => cfg.topology.neighbour(code, dir)).filter((c): c is SheetCode => c !== null);
  /* What massing may stay: the ring of what is on screen, the ring of where the user is going, and the target itself until
     its real mesh replaces it. Everything else is freed. */
  const keep = new Set<SheetCode>([...ringOf(d.displayed), ...ringOf(cur), ...(shape === 'none' || cur === null ? [] : [cur])]);
  const reasonOf = (): EvictReason => hint ?? (d.pressure !== 'none' ? 'pressure' : 'distance');
  for (const [sheet, e] of [...d.sheets]) {
    if (e.lod1.status !== 'ready') continue;
    if (sheet === d.displayed) evict(sheet, 'lod1', 'promoted');             // its massing is replaced by the real mesh
    else if (!keep.has(sheet)) evict(sheet, 'lod1', reasonOf());
  }
  while (gpuMB(cfg, d) > cfg.budgets[d.tier].gpuCeilingMB) {                 // over the ceiling: shed massing, farthest first
    const victim = [...ringOf(cur)].reverse().find((c) => levelOf(d, c, 'lod1').status === 'ready')
      ?? [...d.sheets].find(([, e]) => e.lod1.status === 'ready')?.[0];
    if (victim === undefined) break;
    evict(victim, 'lod1', 'budget');
  }
  const lod0Entries: LruEntry[] = [];
  for (const [sheet, e] of d.sheets) {
    if (isResident(e.lod0)) {
      lod0Entries.push({ key: sheet, bytes: 0, usedSeq: e.lod0.status === 'ready' ? e.lod0.usedSeq : Infinity, pinned: pinned.has(sheet) || e.lod0.status === 'loading' });
    }
  }
  for (const sheet of lruVictims(lod0Entries, { maxEntries: limits.maxLod0, maxBytes: Infinity })) {
    evict(sheet as SheetCode, 'lod0', hint ?? (d.pressure !== 'none' ? 'pressure' : 'lru'));
  }
  for (const [sheet, e] of [...d.sheets]) {                                  // a halo outlives neither its lod0 nor a switch away
    if (!isResident(levelOf(d, sheet, 'lod0')) && sheet !== d.current) {
      if (e.halo.status === 'loading') { out.push({ type: 'cancel', requestId: e.halo.requestId, sheet, level: 'halo' }); put(d, sheet, 'halo', ABSENT); }
      else if (e.halo.status === 'ready') evict(sheet, 'halo', 'with-lod0');
    }
  }

  // 3. solve once the displayed sheet has its halo, or has certainly lost it
  if (cur !== null && d.displayed === cur && d.solved !== cur) {
    const halo = levelOf(d, cur, 'halo');
    const haloGone = halo.status === 'failed' && halo.attempts >= MAX_ATTEMPTS;
    if (halo.status === 'ready' || haloGone) {
      d.solved = cur;
      out.push({ type: 'solve', sheet: cur, haloLoaded: halo.status === 'ready',
        neighbours: DIRECTIONS.map((dir) => ({ dir, sheet: cfg.topology.neighbour(cur, dir) })) });
    }
  }

  // 4. load what is wanted and not here, high priority first, within the low-priority lane. Re-derived: the evictions above
  //    changed what is resident, and a freed bundle's halo must not be asked for again in the same breath.
  const loads = wantedLevels(cfg, d, now);
  let low = inFlight(d).filter((f) => f.entry.priority === 'low').length;
  for (const w of [...loads.filter((x) => x.priority === 'high'), ...loads.filter((x) => x.priority === 'low')]) {
    const e = levelOf(d, w.sheet, w.level);
    if (!retryable(e, now)) continue;
    if (w.priority === 'low') { if (low >= cfg.lowInFlight) continue; low += 1; }
    const attempts = e.status === 'failed' ? e.attempts + 1 : 1;
    const requestId = d.nextRequestId++;
    put(d, w.sheet, w.level, { status: 'loading', requestId, priority: w.priority, sinceMs: now, attempts });
    out.push({ type: 'load', requestId, sheet: w.sheet, level: w.level, priority: w.priority });
  }

}

/** Show the new mesh once its lod0 is ready. */
function swapIfReady(cfg: ManagerConfig, d: Draft, out: ManagerCommand[]): void {
  const cur = d.current;
  if (cur === null || cur === d.displayed || levelOf(d, cur, 'lod0').status !== 'ready') return;
  if (d.outgoing !== null) out.push({ type: 'dispose-mesh', sheet: d.outgoing });         // a hand-over that never finished
  const previous = d.displayed;
  d.displayed = cur;
  d.outgoing = null;
  let outgoingMesh: 'none' | 'keep-until-handover' | 'dispose-now' = 'none';
  if (previous !== null) {
    const both = { ...d, outgoing: previous };
    const keep = cfg.budgets[d.tier].crossFade && gpuMB(cfg, both) <= cfg.budgets[d.tier].gpuCeilingMB;
    outgoingMesh = keep ? 'keep-until-handover' : 'dispose-now';
    if (keep) d.outgoing = previous;
  }
  out.push({ type: 'make-current', sheet: cur, outgoing: previous, outgoingMesh });
  touch(d, cur);
}

/** The loader's quiet -> rise -> plate -> end, driven by elapsed time only. */
function runLoader(d: Draft, now: number, out: ManagerCommand[]): void {
  const cur = d.current;
  if (cur !== null && d.displayed !== cur) {
    if (d.loader === null) d.loader = { sheet: cur, sinceMs: now, phase: 'quiet' };
    else if (d.loader.sheet !== cur) {
      d.loader.sheet = cur;
      if (d.loader.phase !== 'quiet') out.push({ type: 'loader', sheet: cur, phase: d.loader.phase });   // the shown loader retargets
    }
    const waited = now - d.loader.sinceMs;
    if (d.loader.phase === 'quiet' && waited >= SKIP_FAST_MS) { d.loader.phase = 'rise'; out.push({ type: 'loader', sheet: cur, phase: 'rise' }); }
    if (d.loader.phase === 'rise' && waited >= PLATE_AFTER_MS) { d.loader.phase = 'plate'; out.push({ type: 'loader', sheet: cur, phase: 'plate' }); }
  } else if (d.loader !== null) {
    if (d.loader.phase !== 'quiet' && cur !== null) out.push({ type: 'loader', sheet: cur, phase: 'end' });  // never shown = never ended
    d.loader = null;
  }
}

// ── moving ────────────────────────────────────────────────────────────────

function beginSwitch(d: Draft, target: SheetCode, cameraIsThere: boolean): void {
  if (d.current === target) return;
  d.current = target;
  d.armed = cameraIsThere;
  d.solved = null;
  touch(d, target);
}

/** The sheet a camera crossing would switch to, and when it becomes allowed to. Null while there is none. */
function pendingCrossing(cfg: ManagerConfig, d: Draft): { readonly target: SheetCode; readonly readyAtMs: number } | null {
  if (d.current === null || d.camera === null || !d.armed || d.gesturing) return null;
  const cell = cfg.topology.locate(d.camera.lon, d.camera.lat);
  const target = cfg.topology.codeAt(cell.i, cell.j);
  if (target === null || target === d.current) return null;
  if (cfg.topology.depthInto(cell.i, cell.j, d.camera.lon, d.camera.lat) < cfg.hysteresisM) return null;
  return { target, readyAtMs: d.lastMotionMs + cfg.idleMs };
}

function considerCrossing(cfg: ManagerConfig, d: Draft, now: number): void {
  const p = pendingCrossing(cfg, d);
  if (p !== null && now >= p.readyAtMs) beginSwitch(d, p.target, true);
}

// ── the reducer ────────────────────────────────────────────────────────────

/** Metres the camera must move between two events to count as motion on its own (a flyTo with no pointer down). */
const MOTION_EPSILON_M = 0.5;

export function reduce(cfg: ManagerConfig, state: ManagerState, event: ManagerEvent): Transition {
  const d = draftOf(state);
  const out: ManagerCommand[] = [];
  const now = event.atMs;

  switch (event.type) {
    case 'start':
      if (!cfg.topology.has(event.sheet)) { out.push({ type: 'refuse', sheet: event.sheet, reason: 'unknown-sheet' }); break; }
      d.current = null; d.displayed = null; d.outgoing = null; d.solved = null; d.loader = null;
      d.lastMotionMs = now;
      beginSwitch(d, event.sheet, false);
      break;
    case 'select':
      if (!cfg.topology.has(event.sheet)) out.push({ type: 'refuse', sheet: event.sheet, reason: 'unknown-sheet' });
      else beginSwitch(d, event.sheet, false);
      break;
    case 'camera': {
      const prev = d.camera;
      const movedM = prev === null ? Infinity : Math.hypot((event.lon - prev.lon) * 67_977, (event.lat - prev.lat) * 110_540);
      d.camera = { lon: event.lon, lat: event.lat };
      const wasGesturing = d.gesturing;                                   // the moment a gesture ends is motion too
      d.gesturing = event.gesturing;
      if (event.headingDeg !== null) d.heading = directionOfHeading(event.headingDeg) ?? d.heading;
      if (event.gesturing || wasGesturing || movedM > MOTION_EPSILON_M) d.lastMotionMs = now;
      if (d.current !== null) {
        const here = cfg.topology.locate(event.lon, event.lat);
        if (cfg.topology.codeAt(here.i, here.j) === d.current) d.armed = true;
      }
      considerCrossing(cfg, d, now);
      break;
    }
    case 'tick':
      considerCrossing(cfg, d, now);
      break;
    case 'load-finished': case 'load-failed': {
      const hit = inFlight(d).find((f) => f.entry.requestId === event.requestId);
      if (hit === undefined) break;                                         // a cancelled or unknown request: stale, ignored
      if (event.type === 'load-finished') {
        d.seq += 1;
        /* A bundle nobody has stood in yet (a prefetch) ranks below every visited one: if room is needed, the guess goes
           before the sheet the user may walk back to. It earns a real rank when it becomes current (`touch`). */
        const speculative = hit.level === 'lod0' && hit.sheet !== d.current;
        put(d, hit.sheet, hit.level, { status: 'ready', usedSeq: speculative ? 0 : d.seq, sinceMs: now });
      } else {
        put(d, hit.sheet, hit.level, { status: 'failed', attempts: hit.entry.attempts, atMs: now });
        if (hit.sheet === d.current && hit.entry.attempts >= MAX_ATTEMPTS) {
          out.push({ type: 'failure', sheet: hit.sheet, level: hit.level, attempts: hit.entry.attempts });
        }
      }
      break;
    }
    case 'retry': {
      if (levelOf(d, event.sheet, event.level).status === 'failed') put(d, event.sheet, event.level, ABSENT);
      break;
    }
    case 'handover-done':
      if (d.outgoing !== null) { out.push({ type: 'dispose-mesh', sheet: d.outgoing }); d.outgoing = null; }
      break;
    case 'tier-changed': {
      d.tier = event.tier;
      if (d.outgoing !== null && !cfg.budgets[d.tier].crossFade) { out.push({ type: 'dispose-mesh', sheet: d.outgoing }); d.outgoing = null; }
      break;
    }
    case 'network-changed': d.network = event.network; break;
    case 'memory-pressure': d.pressure = event.level; break;
    default: assertNever(event);
  }

  reconcile(cfg, d, now, out, event.type === 'tier-changed' ? 'tier' : null);
  return { state: freeze(d), commands: out };
}

/**
 * The next time AFTER `nowMs` that something time-based comes due: the loader's rise or plate, a retry after a failure, a
 * camera crossing waiting out its idle time. Null when nothing is. A host that sets one timeout from this needs no polling tick.
 */
export function nextWakeMs(cfg: ManagerConfig, state: ManagerState, nowMs: number): number | null {
  const d = draftOf(state);
  const due: number[] = [];
  if (d.loader !== null) {
    if (d.loader.phase === 'quiet') due.push(d.loader.sinceMs + SKIP_FAST_MS);
    if (d.loader.phase !== 'plate') due.push(d.loader.sinceMs + PLATE_AFTER_MS);
  }
  for (const [, e] of d.sheets) {
    for (const level of ['lod0', 'halo', 'lod1'] as const) {
      const entry = e[level];
      if (entry.status === 'failed' && entry.attempts < MAX_ATTEMPTS) due.push(entry.atMs + RETRY_BACKOFF_MS[entry.attempts - 1]!);
    }
  }
  const crossing = pendingCrossing(cfg, d);
  if (crossing !== null) due.push(crossing.readyAtMs);
  const ahead = due.filter((t) => t > nowMs);
  return ahead.length === 0 ? null : Math.min(...ahead);
}

// ── a convenience wrapper for a host that wants one object ────────────────

export interface SheetManager {
  /** Feed an event; returns the commands to carry out, in order. */
  dispatch(event: ManagerEvent): readonly ManagerCommand[];
  state(): ManagerState;
  nextWakeMs(nowMs: number): number | null;
}

export function createSheetManager(tier: ExploreDeviceTier, network: NetworkClass = 'fast', cfg: ManagerConfig = DEFAULT_CONFIG): SheetManager {
  let state = initialState(tier, network);
  return {
    dispatch(event) { const t = reduce(cfg, state, event); state = t.state; return t.commands; },
    state: () => state,
    nextWakeMs: (nowMs) => nextWakeMs(cfg, state, nowMs),
  };
}
