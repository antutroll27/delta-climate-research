import assert from 'node:assert/strict';
import test from 'node:test';

import { createSheetManager } from '../../src/scripts/climate-engine/streaming/sheet-manager.ts';
import { MAX_ATTEMPTS, PLATE_AFTER_MS } from '../../src/scripts/climate-engine/streaming/sheet-budgets.ts';
import { SKIP_FAST_MS, STAGE_WEIGHTS } from '../../src/scripts/climate-engine/loader-progress.ts';
import {
  FIRST_ENTRY_MIN_MS, QUICK_RISE_MS, REVEAL_DELAY_MS, RISE_MS, STAGE_OF_LEVEL, TILE_STAGES,
  createLoaderModel, initialLoaderState, isVisible, nextLoaderWakeMs, progressOf, reduceLoader, retryEventOf, riseValue,
  sheetLabel, sheetParts, showsPlate, showsRise, showsSweep, stagesOf,
} from '../../src/scripts/climate-engine/streaming/loader-model.ts';

/* THE LOADER IS A PURE MODEL OVER THE MANAGER'S COMMANDS. Most tests feed it literal command sequences; `City` below plays
   the page against the REAL sheet manager so the commands are the ones the manager really emits, in its order. */

const loader = (sheet, phase) => ({ type: 'loader', sheet, phase });
const cmd = (atMs, command) => ({ type: 'command', atMs, command });
const stage = (atMs, sheet, st) => ({ type: 'stage', atMs, sheet, stage: st });
const run = (state, ...events) => events.reduce(reduceLoader, state);
/** An "already inside the city" model: design A. */
const inCity = () => initialLoaderState({ firstEntry: false });

test('a rise is drawn REVEAL_DELAY_MS after its command, announced once, and is design A inside the city', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')));
  assert.equal(s.mode, 'rise');
  assert.equal(s.design, 'A');
  assert.equal(isVisible(s, 400), false);
  assert.equal(isVisible(s, 400 + REVEAL_DELAY_MS - 1), false);
  assert.equal(isVisible(s, 400 + REVEAL_DELAY_MS), true);
  assert.equal(s.status.seq, 0, 'nothing said while nothing is on screen');
  const shown = run(s, { type: 'tick', atMs: 400 + REVEAL_DELAY_MS });
  assert.deepEqual({ text: shown.status.text, kind: shown.status.kind, seq: shown.status.seq }, { text: 'Loading F4 · Oost.', kind: 'polite', seq: 1 });
  const again = run(shown, { type: 'tick', atMs: 5000 });
  assert.equal(again.status.seq, 1, 'announced once, not on every tick');
  assert.equal(showsRise(again, 5000), true);
  assert.equal(showsPlate(again, 5000), false, 'no plate before the manager asks for it');
});

test('FAST PATH: a load that ends inside the reveal delay never shows anything and never says anything', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')), cmd(400 + REVEAL_DELAY_MS - 1, loader('F4', 'end')));
  assert.equal(s.mode, 'idle');
  assert.equal(s.status.seq, 0);
  assert.equal(s.lastEnd.shown, false);
  assert.equal(showsRise(s, 600), false);
  assert.equal(showsPlate(s, 600), false);
  assert.equal(nextLoaderWakeMs(s, 500), null);
});

test('FAST PATH: an end with no loader at all (the manager never showed one) is ignored', () => {
  const s = run(inCity(), cmd(300, loader('F4', 'end')));
  assert.equal(s.mode, 'idle');
  assert.equal(s.lastEnd, null);
  assert.equal(s.status.seq, 0);
});

test('the plate arrives with the manager plate phase, at once, on top of the rise', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')), cmd(PLATE_AFTER_MS, loader('F4', 'plate')));
  assert.equal(s.mode, 'plate');
  assert.equal(showsPlate(s, PLATE_AFTER_MS), true);
  assert.equal(showsRise(s, PLATE_AFTER_MS), true, 'A stays under the plate');
});

test('a plate command straight from idle (a retarget into a long wait) is visible immediately', () => {
  const s = run(inCity(), cmd(2000, loader('G4', 'plate')));
  assert.equal(isVisible(s, 2000), true);
  assert.equal(run(s, { type: 'tick', atMs: 2000 }).status.text, `Loading ${sheetLabel('G4')}.`);
});

test('progress is the real stage weights, monotonic, and stages seen in the quiet phase are not lost', () => {
  let s = inCity();
  assert.equal(progressOf(s), 0);
  s = run(s, stage(50, 'F4', 'massing'), stage(300, 'F4', 'ward'));          // BEFORE the manager shows anything
  s = run(s, cmd(400, loader('F4', 'rise')));
  assert.deepEqual(stagesOf(s), ['massing', 'ward']);
  assert.ok(Math.abs(progressOf(s) - (STAGE_WEIGHTS.shell + STAGE_WEIGHTS.ward)) < 1e-9);
  const seen = [];
  for (const st of ['surface', 'vector', 'sim']) { s = run(s, stage(900, 'F4', st)); seen.push(progressOf(s)); }
  assert.deepEqual(seen, [...seen].sort((a, b) => a - b), 'never goes backwards');
  assert.ok(Math.abs(seen.at(-1) - 1) < 1e-9);
  s = run(s, stage(1000, 'F4', 'ward'));                                      // a repeat changes nothing
  assert.equal(progressOf(s), seen.at(-1));
});

test('the preview plate at 40%: footprints and surface done is 45% of the weight, the bar is not a clock', () => {
  const s = run(inCity(), stage(0, 'E4', 'massing'), stage(0, 'E4', 'ward'), cmd(400, loader('E4', 'rise')));
  assert.ok(Math.abs(progressOf(s) - 0.45) < 1e-9);
  assert.equal(progressOf(run(s, { type: 'tick', atMs: 60_000 })), progressOf(s), 'a minute later, with no event, the progress has not moved');
});

test('stage events for another sheet do not move this sheet', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')), stage(450, 'D4', 'ward'));
  assert.equal(progressOf(s, 'F4'), 0);
  assert.equal(progressOf(s, 'D4'), STAGE_WEIGHTS.ward);
});

test('end: says ready once, only because it was seen, and clears the sheet stages', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')), { type: 'tick', atMs: 600 }, stage(700, 'F4', 'ward'), cmd(1500, loader('F4', 'end')));
  assert.equal(s.mode, 'idle');
  assert.equal(s.status.text, 'F4 · Oost is ready.');
  assert.equal(s.status.seq, 2);
  assert.deepEqual(stagesOf(s, 'F4'), []);
  assert.deepEqual(s.lastEnd, { atMs: 1500, shown: true });
});

test('CANCELLED LOAD: a retarget follows the new sheet, a cancel drops the abandoned sheet stages, going home ends it', () => {
  let s = run(inCity(), stage(10, 'F4', 'massing'), stage(20, 'F4', 'ward'), cmd(400, loader('F4', 'rise')), { type: 'tick', atMs: 560 });
  assert.equal(s.sheet, 'F4');
  s = run(s, cmd(700, loader('D4', 'rise')));                                  // the manager retargets
  assert.equal(s.sheet, 'D4');
  assert.equal(s.mode, 'rise');
  assert.equal(s.status.text, `Loading ${sheetLabel('D4')}.`, 'the new sheet is announced');
  s = run(s, cmd(700, { type: 'cancel', requestId: 7, sheet: 'F4', level: 'lod0' }));
  assert.deepEqual(stagesOf(s, 'F4'), [], 'an abandoned load does not keep its progress');
  assert.equal(progressOf(s), 0, 'the bar now follows D4');
  s = run(s, cmd(900, loader('E4', 'end')));                                   // back on the displayed sheet: end names that sheet
  assert.equal(s.mode, 'idle');
  assert.equal(showsRise(s, 1000), false);
  s = run(s, stage(1100, 'F4', 'surface'));                                    // a late event from the cancelled load
  assert.equal(s.mode, 'idle', 'a stale stage never reopens the loader');
});

test('a cancelled load that never became visible leaves no trace', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')), cmd(450, { type: 'cancel', requestId: 1, sheet: 'F4', level: 'lod0' }), cmd(480, loader('E4', 'end')));
  assert.equal(s.status.seq, 0);
  assert.equal(s.lastEnd.shown, false);
});

test('only lod0 cancels and evictions touch the stages', () => {
  let s = run(inCity(), stage(0, 'F4', 'massing'), stage(0, 'F4', 'ward'));
  s = run(s, cmd(1, { type: 'cancel', requestId: 1, sheet: 'F4', level: 'halo' }));
  assert.deepEqual(stagesOf(s, 'F4'), ['massing', 'ward']);
  s = run(s, cmd(2, { type: 'evict', sheet: 'F4', level: 'lod1', reason: 'lru' }));
  assert.deepEqual(stagesOf(s, 'F4'), ['ward']);
  s = run(s, cmd(3, { type: 'evict', sheet: 'F4', level: 'lod0', reason: 'lru' }));
  assert.deepEqual(stagesOf(s, 'F4'), []);
});

test('tracked stage sets are bounded', () => {
  let s = inCity();
  for (const code of ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1']) s = run(s, stage(0, code, 'ward'));
  let n = 0; for (const code of ['A1', 'B1', 'C1', 'D1', 'E1', 'F1', 'G1', 'H1']) if (stagesOf(s, code).length) n += 1;
  assert.ok(n <= 6, `${n} sets kept`);
});

test('unrelated manager commands are ignored whole', () => {
  const before = inCity();
  const after = run(before,
    cmd(1, { type: 'load', requestId: 1, sheet: 'F4', level: 'lod0', priority: 'high' }),
    cmd(2, { type: 'solve', sheet: 'F4', haloLoaded: true, upgrade: false, neighbours: [] }),
    cmd(3, { type: 'refuse', sheet: 'ZZ', reason: 'unknown-sheet' }),
    cmd(4, { type: 'dispose-mesh', sheet: 'F4' }));
  assert.equal(after.mode, 'idle');
  assert.equal(after.status.seq, 0);
});

// ── failure and retry ──────────────────────────────────────────────────────────────────────────────────────────

test('FAILURE: shows at once, announces assertively, and Retry becomes the manager retry event', () => {
  let s = run(inCity(), cmd(400, loader('F4', 'rise')), cmd(PLATE_AFTER_MS, loader('F4', 'plate')), stage(1300, 'F4', 'massing'));
  s = run(s, cmd(12_000, { type: 'failure', sheet: 'F4', level: 'lod0', attempts: MAX_ATTEMPTS }));
  assert.equal(s.mode, 'failed');
  assert.equal(showsPlate(s, 12_000), true);
  assert.equal(s.status.kind, 'assertive');
  assert.equal(s.status.text, 'F4 · Oost could not be loaded. Retry is available.');
  assert.deepEqual(retryEventOf(s), { type: 'retry', sheet: 'F4', level: 'lod0' });
  assert.deepEqual(stagesOf(s, 'F4'), [], 'a retry starts from nothing');
  s = run(s, { type: 'retry', atMs: 13_000 });
  assert.equal(s.mode, 'plate', 'retrying goes back to the plate: the manager loader is still in its plate phase');
  assert.equal(s.failure, null);
  assert.equal(retryEventOf(s), null, 'nothing left to retry');
  assert.equal(s.status.text, 'Loading F4 · Oost.');
  s = run(s, cmd(14_000, loader('F4', 'end')));
  assert.equal(s.mode, 'idle');
  assert.equal(s.status.text, 'F4 · Oost is ready.');
});

test('FAILURE with no loader ever shown (a failed neighbour reported as current) still shows, and is never silent', () => {
  const s = run(inCity(), cmd(9000, { type: 'failure', sheet: 'G4', level: 'lod0', attempts: 3 }));
  assert.equal(s.mode, 'failed');
  assert.equal(isVisible(s, 9000), true);
  assert.equal(s.status.kind, 'assertive');
});

test('retry while not failed does nothing; failure then selecting another sheet leaves the failure', () => {
  const idle = run(inCity(), { type: 'retry', atMs: 5 });
  assert.equal(idle.mode, 'idle');
  let s = run(inCity(), cmd(9000, { type: 'failure', sheet: 'G4', level: 'lod0', attempts: 3 }));
  s = run(s, cmd(9500, loader('F4', 'plate')));
  assert.equal(s.mode, 'plate');
  assert.equal(s.failure, null);
  assert.equal(s.sheet, 'F4');
});

test('failure then the manager ends the loader (user went back): idle, and not announced as ready', () => {
  let s = run(inCity(), cmd(9000, { type: 'failure', sheet: 'G4', level: 'lod0', attempts: 3 }));
  const seq = s.status.seq;
  s = run(s, cmd(9100, loader('E4', 'end')));
  assert.equal(s.mode, 'idle');
  assert.equal(s.status.seq, seq, 'no "ready" after a failure');
});

// ── first entry: design C ──────────────────────────────────────────────────────────────────────────────────────

test('FIRST ENTRY is design C and may not end before 1.5 s of being on screen; the next load is A with no minimum', () => {
  let s = run(initialLoaderState(), cmd(400, loader('E4', 'rise')));
  assert.equal(s.design, 'C');
  s = run(s, { type: 'tick', atMs: 550 });
  assert.equal(showsSweep(s, 550), true);
  assert.equal(showsRise(s, 550), false, 'C replaces the A furniture');
  s = run(s, cmd(900, loader('E4', 'end')));
  assert.equal(s.mode, 'rise', 'held');
  assert.equal(s.endPending, true);
  assert.equal(nextLoaderWakeMs(s, 900), 550 + FIRST_ENTRY_MIN_MS);
  s = run(s, { type: 'tick', atMs: 550 + FIRST_ENTRY_MIN_MS - 1 });
  assert.equal(s.mode, 'rise');
  s = run(s, { type: 'tick', atMs: 550 + FIRST_ENTRY_MIN_MS });
  assert.equal(s.mode, 'idle');
  assert.equal(s.status.text, 'E4 · Canal Ring is ready.');
  s = run(s, cmd(2100, { type: 'make-current', sheet: 'E4', outgoing: null, outgoingMesh: 'none' }));
  s = run(s, cmd(5000, loader('F4', 'rise')), cmd(5300, loader('F4', 'end')), cmd(5600, loader('F4', 'rise')), { type: 'tick', atMs: 5800 });
  assert.equal(s.design, 'A');
  s = run(s, cmd(5900, loader('F4', 'end')));
  assert.equal(s.mode, 'idle', 'in-app moves have no minimum (D8)');
});

test('FIRST ENTRY: the plate still comes at 1.2 s, on top of the sweep; a fast first entry shows nothing and uses up the first-entry', () => {
  let s = run(initialLoaderState(), cmd(400, loader('E4', 'rise')), cmd(PLATE_AFTER_MS, loader('E4', 'plate')));
  assert.equal(showsPlate(s, PLATE_AFTER_MS), true);
  assert.equal(showsSweep(s, PLATE_AFTER_MS), true);

  let fast = run(initialLoaderState(), cmd(100, { type: 'make-current', sheet: 'E4', outgoing: null, outgoingMesh: 'none' }));
  assert.equal(fast.entered, true);
  fast = run(fast, cmd(9000, loader('F4', 'rise')));
  assert.equal(fast.design, 'A', 'a later slow move is not a first entry');
});

test('FIRST ENTRY whose end lands before the sweep was ever visible: no hold, no flash', () => {
  const s = run(initialLoaderState(), cmd(400, loader('E4', 'rise')), cmd(500, loader('E4', 'end')));
  assert.equal(s.mode, 'idle');
  assert.equal(s.endPending, false);
});

test('a failure ends the first-entry minimum: the retry is never held back', () => {
  const s = run(initialLoaderState(), cmd(400, loader('E4', 'rise')), { type: 'tick', atMs: 550 }, cmd(700, { type: 'failure', sheet: 'E4', level: 'lod0', attempts: 3 }));
  assert.equal(s.mode, 'failed');
  assert.equal(s.endPending, false);
});

test('reset starts a new city: first entry again, everything dropped', () => {
  let s = run(inCity(), cmd(400, loader('F4', 'rise')), stage(450, 'F4', 'ward'));
  s = run(s, { type: 'reset', atMs: 500, firstEntry: true });
  assert.equal(s.mode, 'idle');
  assert.equal(s.entered, false);
  assert.deepEqual(stagesOf(s, 'F4'), []);
  assert.equal(run(s, cmd(900, loader('E4', 'rise'))).design, 'C');
});

// ── the rise (the renderer's grow uniform) ─────────────────────────────────────────────────────────────────────

test('RISE PLAN: long after a visible loader, short after a cached swap, none under reduced motion', () => {
  const swap = (s, t) => run(s, cmd(t, { type: 'make-current', sheet: 'F4', outgoing: 'E4', outgoingMesh: 'none' }));
  // loader on screen when the sheet lands
  let s = run(inCity(), cmd(400, loader('F4', 'rise')), { type: 'tick', atMs: 600 });
  s = swap(s, 2000);
  assert.deepEqual(s.rise, { startMs: 2000, durationMs: RISE_MS, afterLoader: true });
  // the manager's end in the same batch, BEFORE make-current
  s = run(inCity(), cmd(400, loader('F4', 'rise')), { type: 'tick', atMs: 600 }, cmd(2000, loader('F4', 'end')));
  s = swap(s, 2000);
  assert.equal(s.rise.afterLoader, true);
  assert.equal(s.rise.durationMs, RISE_MS);
  // a cached swap: nothing was shown
  s = swap(inCity(), 3000);
  assert.deepEqual(s.rise, { startMs: 3000, durationMs: QUICK_RISE_MS, afterLoader: false });
  // reduced motion
  s = swap(run(inCity(), { type: 'reduced-motion', atMs: 0, reduced: true }), 3000);
  assert.equal(s.rise.durationMs, 0);
  assert.equal(riseValue(s.rise, 3000), 1, 'no rise: already risen');
});

test('riseValue is linear 0..1 from the start, clamped, and 1 with no plan', () => {
  const plan = { startMs: 1000, durationMs: 2000, afterLoader: true };
  assert.equal(riseValue(plan, 500), 0);
  assert.equal(riseValue(plan, 2000), 0.5);
  assert.equal(riseValue(plan, 9999), 1);
  assert.equal(riseValue(null, 5), 1);
});

// ── wakes ──────────────────────────────────────────────────────────────────────────────────────────────────────

test('nextLoaderWakeMs names the reveal, then nothing', () => {
  const s = run(inCity(), cmd(400, loader('F4', 'rise')));
  assert.equal(nextLoaderWakeMs(s, 400), 400 + REVEAL_DELAY_MS);
  assert.equal(nextLoaderWakeMs(run(s, { type: 'tick', atMs: 600 }), 600), null);
  assert.equal(nextLoaderWakeMs(inCity(), 0), null);
});

test('the wrapper keeps state and the labels are the sheet table labels', () => {
  const m = createLoaderModel({ firstEntry: false });
  m.dispatch(cmd(400, loader('E4', 'rise')));
  assert.equal(m.state().mode, 'rise');
  assert.equal(m.nextWakeMs(400), 400 + REVEAL_DELAY_MS);
  assert.equal(sheetLabel('E4'), 'E4 · Canal Ring');
  assert.deepEqual(sheetParts('E4'), { code: 'E4', name: 'Canal Ring' });
  assert.equal(sheetLabel(null), '');
});

test('the level-to-stage map covers the levels the manager loads', () => {
  assert.deepEqual(STAGE_OF_LEVEL, { lod1: 'massing', lod0: 'ward', halo: null });
  assert.deepEqual([...TILE_STAGES], ['massing', 'ward', 'surface', 'vector', 'sim']);
});

// ── against the REAL manager ───────────────────────────────────────────────────────────────────────────────────

/** The page: a real manager, every command forwarded to the loader model, loads answered when the test says so. */
class City {
  constructor(options = { firstEntry: false }) {
    this.m = createSheetManager('full');
    this.loader = createLoaderModel(options);
    this.t = 0;
    this.pending = new Map();
    this.commands = [];
  }
  event(e) {
    const cmds = this.m.dispatch({ ...e, atMs: this.t });
    for (const c of cmds) {
      this.commands.push(c);
      if (c.type === 'load') this.pending.set(`${c.sheet}/${c.level}`, c.requestId);
      if (c.type === 'cancel') this.pending.delete(`${c.sheet}/${c.level}`);
      this.loader.dispatch({ type: 'command', atMs: this.t, command: c });
    }
    // the executor re-arms a timer from nextWakeMs; a tick at that moment is what the page does
    return cmds;
  }
  at(ms) { this.t = ms; return this; }
  tick() { return this.event({ type: 'tick' }); }
  /** Finish a level, and report the real stage that means. */
  land(sheet, level) {
    const id = this.pending.get(`${sheet}/${level}`);
    assert.ok(id !== undefined, `no pending ${sheet}/${level}`);
    this.pending.delete(`${sheet}/${level}`);
    const st = STAGE_OF_LEVEL[level];
    if (st !== null) this.loader.dispatch({ type: 'stage', atMs: this.t, sheet, stage: st });
    return this.event({ type: 'load-finished', requestId: id });
  }
  fail(sheet, level) {
    const id = this.pending.get(`${sheet}/${level}`);
    this.pending.delete(`${sheet}/${level}`);
    return this.event({ type: 'load-failed', requestId: id, reason: 'test' });
  }
  get state() { return this.loader.state(); }
  /** Was anything of the loader ever drawn? Sampled at every command boundary the test steps through. */
  visibleNow() { return isVisible(this.state, this.t); }
}

function openAt(code) {
  const c = new City({ firstEntry: false });
  c.event({ type: 'start', sheet: code });
  c.land(code, 'lod0'); c.land(code, 'halo');
  for (const key of [...c.pending.keys()]) { const [s, l] = key.split('/'); c.land(s, l); }
  return c;
}

test('REAL MANAGER, fast path: a sheet ready inside the manager window never shows the loader', () => {
  const c = openAt('E4');
  c.at(10_000).event({ type: 'select', sheet: 'F4' });
  let ever = false;
  for (const dt of [50, 140, 260]) { c.at(10_000 + dt).tick(); ever ||= c.visibleNow(); }
  c.at(10_000 + 300).land('F4', 'lod0');
  ever ||= c.visibleNow();
  assert.equal(ever, false);
  assert.equal(c.state.mode, 'idle');
  assert.equal(c.state.status.seq, 0, 'and nothing was announced');
  assert.equal(c.state.rise.afterLoader, false);
  assert.equal(c.state.rise.durationMs, QUICK_RISE_MS);
});

test('REAL MANAGER, between the manager window and the reveal delay: still nothing drawn', () => {
  const c = openAt('E4');
  c.at(10_000).event({ type: 'select', sheet: 'F4' });
  c.at(10_000 + SKIP_FAST_MS).tick();
  assert.equal(c.state.mode, 'rise');
  assert.equal(c.visibleNow(), false);
  c.at(10_000 + SKIP_FAST_MS + REVEAL_DELAY_MS - 20).land('F4', 'lod0');
  assert.equal(c.state.mode, 'idle');
  assert.equal(c.state.status.seq, 0);
  assert.equal(c.state.lastEnd.shown, false);
});

test('REAL MANAGER, slow load: rise, plate, real stages, end; the plate never appears before 1.2 s', () => {
  const c = openAt('E4');
  c.at(20_000).event({ type: 'select', sheet: 'F4' });
  c.loader.dispatch({ type: 'stage', atMs: c.t, sheet: 'F4', stage: 'massing' });     // F4 was a grey neighbour: massing was on screen
  c.at(20_000 + 450).tick();
  assert.equal(c.state.mode, 'rise');
  c.at(20_000 + 700).tick();
  assert.equal(showsRise(c.state, c.t), true);
  assert.equal(showsPlate(c.state, c.t), false);
  assert.equal(progressOf(c.state), STAGE_WEIGHTS.shell);
  c.at(20_000 + PLATE_AFTER_MS - 1).tick();
  assert.equal(showsPlate(c.state, c.t), false);
  c.at(20_000 + PLATE_AFTER_MS).tick();
  assert.equal(showsPlate(c.state, c.t), true);
  c.at(20_000 + 3000).land('F4', 'lod0');
  assert.equal(c.state.mode, 'idle');
  assert.equal(c.state.status.text, 'F4 · Oost is ready.');
  assert.equal(c.state.rise.durationMs, RISE_MS);
  assert.equal(c.state.rise.afterLoader, true);
});

test('REAL MANAGER, cancelled load: F4 then D4 then back to E4 leaves the loader idle with no stale stages', () => {
  const c = openAt('E4');
  c.at(30_000).event({ type: 'select', sheet: 'F4' });
  c.loader.dispatch({ type: 'stage', atMs: c.t, sheet: 'F4', stage: 'ward' });
  c.at(30_700).tick();
  assert.equal(c.state.sheet, 'F4');
  c.at(30_800).event({ type: 'select', sheet: 'D4' });
  assert.equal(c.state.sheet, 'D4', 'a shown loader follows the retarget');
  assert.deepEqual(stagesOf(c.state, 'F4'), [], 'the manager cancelled F4 lod0, so its stage is gone');
  c.at(31_000).event({ type: 'select', sheet: 'E4' });
  assert.equal(c.state.mode, 'idle');
  assert.equal(showsRise(c.state, c.t), false);
});

test('REAL MANAGER, failure and retry: three attempts, one failure report, Retry makes the manager load again', () => {
  const c = openAt('E4');
  c.at(40_000).event({ type: 'select', sheet: 'F4' });
  c.at(40_000 + 700).tick();
  c.at(40_000 + 1300).tick();
  assert.equal(showsPlate(c.state, c.t), true);
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    c.fail('F4', 'lod0');
    if (attempt < MAX_ATTEMPTS) { c.at(c.m.nextWakeMs(c.t)).tick(); assert.ok(c.pending.has('F4/lod0'), 'retried by the manager itself'); }
  }
  assert.equal(c.state.mode, 'failed');
  assert.equal(c.state.failure.attempts, MAX_ATTEMPTS);
  const ev = retryEventOf(c.state);
  assert.deepEqual(ev, { type: 'retry', sheet: 'F4', level: 'lod0' });
  c.loader.dispatch({ type: 'retry', atMs: c.t });
  const cmds = c.event(ev);                                                    // what the host sends the manager
  assert.deepEqual(cmds.map((x) => [x.type, x.sheet, x.level]), [['load', 'F4', 'lod0']]);
  assert.equal(c.state.mode, 'plate');
  c.land('F4', 'lod0');
  assert.equal(c.state.mode, 'idle');
});

test('a user who goes elsewhere after a failure and comes back is not left on a dead plate', () => {
  const c = openAt('E4');
  c.at(50_000).event({ type: 'select', sheet: 'F4' });
  c.at(50_700).tick(); c.at(51_300).tick();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) { c.fail('F4', 'lod0'); if (attempt < MAX_ATTEMPTS) c.at(c.m.nextWakeMs(c.t)).tick(); }
  assert.equal(c.state.mode, 'failed');
  c.at(c.t + 1000).event({ type: 'select', sheet: 'E4' });
  assert.equal(c.state.mode, 'idle', 'the manager ended the loader when the user went home');
});
