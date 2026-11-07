import assert from 'node:assert/strict';
import test from 'node:test';

import { AMSTERDAM_SHEET_LATTICE as L } from '../../src/data/sheets/amsterdam.ts';
import {
  DEFAULT_CONFIG, createSheetManager, gpuMB, initialState, levelOf, nextWakeMs, reduce,
} from '../../src/scripts/climate-engine/streaming/sheet-manager.ts';
import { SHEET_BUDGETS, MAX_ATTEMPTS, RETRY_BACKOFF_MS, lod0MeshMB } from '../../src/scripts/climate-engine/streaming/sheet-budgets.ts';
import { AMSTERDAM_TOPOLOGY as T, DIRECTIONS } from '../../src/scripts/climate-engine/streaming/sheet-topology.ts';

/* THE SHEET MANAGER IS A PURE STATE MACHINE, so these tests drive it with events and read commands. `Host` plays the
   page: it records what was asked, and answers load requests when the test says so. Nothing here fetches anything. */

const LON0 = L.anchor.centre.lon, LAT0 = L.anchor.centre.lat;
/** lon/lat of the point `eastM` east and `northM` north of the CENTRE of lattice cell (i, j). */
const at = (i, j, eastM = 0, northM = 0) => ({ lon: LON0 + i * L.dLon + eastM / L.mPerDegLon, lat: LAT0 + j * L.dLat + northM / L.mPerDegLat });
const cellOf = (code) => T.cell(code);

class Host {
  constructor(tier = 'full', network = 'fast', cfg = DEFAULT_CONFIG) {
    this.m = createSheetManager(tier, network, cfg);
    this.t = 0;
    this.log = [];                         // every command, in order
    this.pending = new Map();              // requestId -> { sheet, level, priority }
    this.shadow = new Map();
    this.autoOpen = true;                  // answer every make-current with `opened`
    this.opens = [];               // 'F4/lod0' -> 'loading' | 'ready': what the host believes it holds
  }
  send(event) {
    let cmds = this.m.dispatch({ ...event, atMs: this.t });
    if ((event.type === 'load-finished' || event.type === 'load-failed') && this.finished) {   // the answer lands BEFORE the commands it provoked
      const key = `${this.finished.sheet}/${this.finished.level}`;
      if (event.type === 'load-finished') this.shadow.set(key, 'ready'); else this.shadow.delete(key);
    }
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c.type === 'make-current' && this.autoOpen) {            // the page answers at once, unless a test holds it back
        this.opens.push(c.sheet);
        cmds = [...cmds, ...this.m.dispatch({ type: 'opened', sheet: c.sheet, atMs: this.t })];
      }
      this.log.push(c);
      const key = `${c.sheet}/${c.level}`;
      if (c.type === 'load') {
        assert.ok(!this.shadow.has(key), `asked to load ${key} twice (${this.shadow.get(key)})`);
        this.pending.set(c.requestId, c); this.shadow.set(key, 'loading');
      }
      if (c.type === 'cancel') { assert.equal(this.shadow.get(key), 'loading', `cancel of ${key}`); this.pending.delete(c.requestId); this.shadow.delete(key); }
      if (c.type === 'evict') { assert.equal(this.shadow.get(key), 'ready', `evict of ${key}`); this.shadow.delete(key); }
      if (c.type === 'reprioritise') assert.equal(this.shadow.get(key), 'loading');
    }
    return cmds;
  }
  at(ms) { this.t = ms; return this; }
  advance(ms) { this.t += ms; return this; }
  start(sheet) { return this.send({ type: 'start', sheet }); }
  select(sheet) { return this.send({ type: 'select', sheet }); }
  tick() { return this.send({ type: 'tick' }); }
  camera(pos, gesturing = false, headingDeg = null) { return this.send({ type: 'camera', ...pos, gesturing, headingDeg }); }
  find(sheet, level) { return [...this.pending.values()].find((c) => c.sheet === sheet && c.level === level); }
  finish(sheet, level) {
    const c = this.find(sheet, level);
    assert.ok(c, `no pending ${sheet}/${level}`);
    this.pending.delete(c.requestId);
    this.finished = c;
    return this.send({ type: 'load-finished', requestId: c.requestId });
  }
  fail(sheet, level) {
    const c = this.find(sheet, level);
    assert.ok(c, `no pending ${sheet}/${level}`);
    this.pending.delete(c.requestId);
    this.finished = c;
    return this.send({ type: 'load-failed', requestId: c.requestId, reason: 'test' });
  }
  /** Answer everything pending until nothing is, returning every command issued on the way. */
  drain() {
    const all = [];
    while (this.pending.size > 0) {
      const c = [...this.pending.values()][0];
      all.push(...this.finish(c.sheet, c.level));
    }
    return all;
  }
  state() { return this.m.state(); }
  of(type) { return this.log.filter((c) => c.type === type); }
  since(mark) { return this.log.slice(mark); }
}

/** A manager that has loaded `sheet` completely and settled. */
function settled(sheet = 'E4', tier = 'full', cfg = DEFAULT_CONFIG, network = 'fast') {
  const h = new Host(tier, network, cfg);
  h.start(sheet);
  h.drain();
  return h;
}

test('a deep link loads the current sheet and its halo at high priority, and nothing else yet', () => {
  const h = new Host('full');
  const cmds = h.start('E4');
  assert.deepEqual(cmds.map((c) => [c.type, c.sheet, c.level, c.priority]), [['load', 'E4', 'lod0', 'high'], ['load', 'E4', 'halo', 'high']]);
});

test('arrival: swap, then the ring as low-priority massing two at a time, then the solve on the halo', () => {
  const h = new Host('full');
  h.start('E4');
  const afterHalo = h.finish('E4', 'halo');
  assert.deepEqual(afterHalo, [], 'the halo alone changes nothing: the solve needs the displayed sheet');
  const cmds = h.finish('E4', 'lod0');
  assert.equal(cmds[0].type, 'make-current');
  assert.ok(cmds.some((c) => c.type === 'solve'), 'the solve follows the page\'s `opened`');
  assert.deepEqual(cmds[0], { type: 'make-current', sheet: 'E4', outgoing: null, outgoingMesh: 'none' });
  const solve = cmds.find((c) => c.type === 'solve');
  assert.equal(solve.haloLoaded, true);
  assert.deepEqual(solve.neighbours.map((n) => n.dir), [...DIRECTIONS]);
  const loads = cmds.filter((c) => c.type === 'load');
  assert.equal(loads.length, 2, 'the low-priority lane holds two at a time');
  assert.ok(loads.every((c) => c.level === 'lod1' && c.priority === 'low'));
  h.drain();
  const ring = h.of('load').filter((c) => c.level === 'lod1').map((c) => c.sheet).sort();
  assert.deepEqual(ring, DIRECTIONS.map((d) => T.neighbour('E4', d)).filter(Boolean).sort(), 'all eight neighbours of E4, each once');
});

test('no level of a skipped or outside cell is ever requested, from any starting sheet, on any tier', () => {
  for (const tier of ['full', 'balanced', 'low']) {
    for (const code of T.codes) {
      const h = new Host(tier);
      h.start(code);
      h.camera(at(...Object.values(cellOf(code))), false, 45);
      h.drain();
      for (const c of h.of('load')) assert.ok(T.has(c.sheet), `${tier}/${code} asked for ${c.sheet}`);
    }
  }
});

test('the ring is the four edge neighbours on the low tier, and a sheet with a skipped neighbour asks for fewer', () => {
  const h = settled('E4', 'low');
  const ring = h.of('load').filter((c) => c.level === 'lod1').map((c) => c.sheet).sort();
  assert.deepEqual(ring, ['D4', 'E3', 'E5', 'F4']);
  const corner = settled('B3', 'full');
  const loads = corner.of('load').filter((c) => c.level === 'lod1').map((c) => c.sheet).sort();
  assert.deepEqual(loads, ['B4', 'C3', 'C4'], 'B3 touches only three shipping sheets');
});

test('moving to a sheet that is already resident swaps at once: no loader, no fetch of its lod0', () => {
  const h = settled('E4', 'full');
  const east = h.state().sheets.has('F4');
  assert.ok(east);
  h.select('F4'); h.drain();                           // visit F4 (cold)
  const mark = h.log.length;
  h.select('E4');                                      // back: E4 is still in the LRU
  const cmds = h.since(mark);
  assert.equal(h.state().displayed, 'E4');
  assert.ok(cmds.some((c) => c.type === 'make-current' && c.sheet === 'E4'));
  assert.ok(!cmds.some((c) => c.type === 'load' && c.level === 'lod0'), 'nothing to fetch');
  assert.ok(!cmds.some((c) => c.type === 'loader'), 'ready inside the fast path: no loader at all');
});

test('the loader rises at 400 ms, becomes the plate at 1,200 ms, and ends when the sheet lands; a fast load shows nothing', () => {
  const fast = settled('E4');
  fast.select('F4');
  fast.at(fast.t + 300);
  fast.finish('F4', 'lod0');
  assert.equal(fast.of('loader').length, 0, 'under 400 ms: never shown, never ended');

  const slow = settled('E4');
  slow.select('F4');
  const t0 = slow.t;
  assert.deepEqual(slow.at(t0 + 399).tick(), []);
  assert.deepEqual(slow.at(t0 + 400).tick(), [{ type: 'loader', sheet: 'F4', phase: 'rise' }]);
  assert.deepEqual(slow.at(t0 + 1199).tick(), []);
  assert.deepEqual(slow.at(t0 + 1200).tick(), [{ type: 'loader', sheet: 'F4', phase: 'plate' }]);
  const done = slow.at(t0 + 2000).finish('F4', 'lod0');
  assert.deepEqual(done.filter((c) => c.type === 'loader'), [{ type: 'loader', sheet: 'F4', phase: 'end' }]);
  assert.equal(slow.state().loader, null);
});

test('a shown loader follows a retarget; nextWakeMs names the next phase', () => {
  const h = settled('E4');
  h.select('F4');
  const t0 = h.t;
  assert.equal(h.m.nextWakeMs(t0), t0 + 400);
  h.at(t0 + 500).tick();
  assert.equal(h.m.nextWakeMs(t0 + 500), t0 + 1200);
  const cmds = h.at(t0 + 600).select('D4');
  assert.deepEqual(cmds.filter((c) => c.type === 'loader'), [{ type: 'loader', sheet: 'D4', phase: 'rise' }]);
});

test('selecting another sheet cancels the stale load, and the late answer is ignored', () => {
  const h = settled('E4');
  h.select('G4');
  const stale = h.find('G4', 'lod0');
  assert.ok(stale);
  const cmds = h.advance(100).select('C3');
  const cancelled = cmds.filter((c) => c.type === 'cancel').map((c) => `${c.sheet}/${c.level}`).sort();
  assert.deepEqual(cancelled, ['G4/halo', 'G4/lod0']);
  assert.ok(cmds.some((c) => c.type === 'load' && c.sheet === 'C3' && c.level === 'lod0' && c.priority === 'high'));
  const before = h.state();
  const late = h.send({ type: 'load-finished', requestId: stale.requestId });
  assert.deepEqual(late, []);
  assert.equal(levelOf(h.state(), 'G4', 'lod0').status, 'absent', 'the stale answer did not mark G4 ready');
  assert.equal(h.state().current, before.current);
});

test('select refuses what is not a shipping sheet: unknown codes and skipped cells alike', () => {
  const h = settled('E4');
  assert.deepEqual(h.select('ZZ9'), [{ type: 'refuse', sheet: 'ZZ9', reason: 'unknown-sheet' }]);
  assert.ok(!T.has('A1'));
  assert.deepEqual(h.select('A1'), [{ type: 'refuse', sheet: 'A1', reason: 'unknown-sheet' }]);
  assert.equal(h.state().current, 'E4');
  assert.deepEqual(new Host().start('A1'), [{ type: 'refuse', sheet: 'A1', reason: 'unknown-sheet' }]);
});

// ── camera crossing ────────────────────────────────────────────────────────

test('a camera hovering within 200 m of a seam never switches, however long it stays or wobbles', () => {
  const h = settled('E4');
  const { i, j } = cellOf('E4');
  h.camera(at(i, j));                                            // arms the crossing
  const east = cellOf('F4');
  for (let k = 0; k < 40; k++) {
    h.advance(250);
    // alternate 190 m inside F4 and 190 m inside E4, across the seam, with the gesture over
    h.camera(k % 2 === 0 ? at(east.i, east.j, -1400 + 190) : at(i, j, 1400 - 190), false);
    h.tick();
  }
  assert.equal(h.state().current, 'E4');
  assert.equal(h.of('make-current').length, 1);
});

test('past 200 m, and only after the gesture has been over for 400 ms, the camera switches; going back needs 200 m the other way', () => {
  const h = settled('E4');
  const e4 = cellOf('E4'), f4 = cellOf('F4');
  h.camera(at(e4.i, e4.j));
  h.advance(1000);
  h.camera(at(f4.i, f4.j, -1400 + 260), true);                   // 260 m into F4, still dragging
  h.advance(5000).tick();
  assert.equal(h.state().current, 'E4', 'a pointer-down gesture never switches');
  h.camera(at(f4.i, f4.j, -1400 + 260), false);                  // let go; motion was at the last gesturing event
  h.advance(399).tick();
  assert.equal(h.state().current, 'E4', '399 ms of stillness is not enough');
  assert.equal(h.m.nextWakeMs(h.t), h.t + 1, 'the host is told when it will be');
  h.advance(1).tick();
  assert.equal(h.state().current, 'F4');
  h.drain();
  // F4 is now current; the camera is 260 m inside it. 150 m back across the seam is NOT enough to return.
  h.advance(2000);
  h.camera(at(e4.i, e4.j, 1400 - 150));
  h.advance(2000).tick();
  assert.equal(h.state().current, 'F4');
  h.camera(at(e4.i, e4.j, 1400 - 250));
  h.advance(2000).tick();
  assert.equal(h.state().current, 'E4', '250 m back is');
});

test('a camera over a skipped or outside cell never asks for it', () => {
  const h = settled('B3', 'full');
  const b3 = cellOf('B3');
  h.camera(at(b3.i, b3.j));
  for (const [di, dj] of [[-1, 0], [0, 1], [-1, 1], [-3, 0], [0, 6]]) {
    assert.notEqual(T.cellKind(b3.i + di, b3.j + dj), 'ships');
    h.advance(3000);
    h.camera(at(b3.i + di, b3.j + dj));
    h.advance(3000).tick();
    assert.equal(h.state().current, 'B3');
  }
  assert.ok(h.of('load').every((c) => T.has(c.sheet)));
});

test('a diagonal crossing is measured to the nearer edge: 250 m past one seam but 100 m past the other is not enough', () => {
  const h = settled('E4');
  const e4 = cellOf('E4'), f3 = cellOf('F3');
  h.camera(at(e4.i, e4.j));
  h.advance(1000);
  h.camera(at(f3.i, f3.j, -1400 + 250, -1400 + 100));
  h.advance(2000).tick();
  assert.equal(h.state().current, 'E4');
  h.camera(at(f3.i, f3.j, -1400 + 250, -1400 + 250));
  h.advance(500).tick();
  assert.equal(h.state().current, 'F3');
});

test('after a select the camera, still over the old sheet, does not drag the user back until it has arrived', () => {
  const h = settled('E4');
  const e4 = cellOf('E4'), f4 = cellOf('F4');
  h.camera(at(e4.i, e4.j));
  h.select('F4'); h.drain();
  for (let k = 0; k < 10; k++) { h.advance(1000); h.camera(at(e4.i, e4.j)); h.tick(); }
  assert.equal(h.state().current, 'F4', 'the camera is deep in E4 but the crossing is not armed yet');
  h.camera(at(f4.i, f4.j));                                      // the flyTo lands
  h.advance(1000);
  h.camera(at(e4.i, e4.j, 1400 - 300));                          // now a real crossing back works
  h.advance(1000).tick();
  assert.equal(h.state().current, 'E4');
});

// ── heading prefetch ────────────────────────────────────────────────────────

test('heading east prefetches the east neighbour (lod0 + halo, low), one at a time, never evicting', () => {
  const h = settled('E4', 'full');
  const mark = h.log.length;
  h.camera(at(...Object.values(cellOf('E4'))), false, 90);
  const cmds = h.since(mark);
  const loads = cmds.filter((c) => c.type === 'load');
  assert.deepEqual(loads.map((c) => [c.sheet, c.level, c.priority]), [['F4', 'lod0', 'low'], ['F4', 'halo', 'low']]);
  assert.ok(!cmds.some((c) => c.type === 'evict'));
  h.drain();
  // the fan of an east heading is e, se, ne: after F4 comes se (F5): one more, capped by the LRU (3 on full): E4 + F4 + one
  const more = h.of('load').filter((c) => c.level === 'lod0').map((c) => c.sheet);
  assert.deepEqual(more, ['E4', 'F4', 'F5']);
  assert.equal(h.of('evict').filter((c) => c.level === 'lod0').length, 0, 'prefetch fills free slots only');
});

test('a heading that leaves the fan cancels the prefetch in flight; one that stays inside it keeps it', () => {
  const h = settled('E4', 'full');
  const here = at(...Object.values(cellOf('E4')));
  h.camera(here, false, 90);
  assert.ok(h.find('F4', 'lod0'));
  const kept = h.camera(here, false, 45);                        // north-east: east is still in the fan
  assert.deepEqual(kept.filter((c) => c.type === 'cancel'), []);
  const turned = h.camera(here, false, 270);                     // west: the fan is w, nw, sw
  assert.deepEqual(turned.filter((c) => c.type === 'cancel').map((c) => `${c.sheet}/${c.level}`).sort(), ['F4/halo', 'F4/lod0']);
  assert.ok(turned.some((c) => c.type === 'load' && c.sheet === 'D4' && c.level === 'lod0'));
});

test('no prefetch on a constrained network, under pressure, or on the low tier; balanced holds one extra bundle', () => {
  const here = at(...Object.values(cellOf('E4')));
  const slow = settled('E4', 'full', DEFAULT_CONFIG, 'constrained');
  assert.deepEqual(slow.camera(here, false, 90).filter((c) => c.type === 'load'), []);
  slow.send({ type: 'network-changed', network: 'fast' });
  assert.ok(slow.find('F4', 'lod0'), 'back on a fast network the prefetch starts');

  const low = settled('E4', 'low');
  assert.deepEqual(low.camera(here, false, 90).filter((c) => c.type === 'load'), []);

  const pressed = settled('E4', 'full');
  pressed.send({ type: 'memory-pressure', level: 'moderate' });
  assert.deepEqual(pressed.camera(here, false, 90).filter((c) => c.type === 'load'), []);

  const balanced = settled('E4', 'balanced');
  balanced.camera(here, false, 90);
  balanced.drain();
  assert.deepEqual(balanced.of('load').filter((c) => c.level === 'lod0').map((c) => c.sheet), ['E4', 'F4'], 'cap 2: current + one');
});

test('a prefetch that becomes the target is promoted to high priority, not fetched twice', () => {
  const h = settled('E4', 'full');
  h.camera(at(...Object.values(cellOf('E4'))), false, 90);
  const first = h.find('F4', 'lod0');
  const cmds = h.select('F4');
  assert.deepEqual(cmds.filter((c) => c.type === 'reprioritise').map((c) => [c.requestId, c.level, c.priority]).sort(),
    [[first.requestId, 'lod0', 'high'], [h.find('F4', 'halo').requestId, 'halo', 'high']].sort());
  assert.ok(!cmds.some((c) => c.type === 'load' && c.sheet === 'F4'));
});

// ── eviction and budgets ────────────────────────────────────────────────────

test('the LRU keeps the tier cap of bundles: the least recently used goes, its halo with it', () => {
  const h = settled('E4', 'balanced');                        // cap 2
  h.select('F4'); h.drain();
  const mark = h.log.length;
  h.select('G4'); h.drain();
  const gone = h.since(mark).filter((c) => c.type === 'evict' && (c.level === 'lod0' || c.level === 'halo'));
  assert.deepEqual(gone.map((c) => [c.sheet, c.level, c.reason]).sort(), [['E4', 'halo', 'with-lod0'], ['E4', 'lod0', 'lru']].sort());
  assert.equal(levelOf(h.state(), 'E4', 'lod0').status, 'evicted');
  assert.equal(levelOf(h.state(), 'F4', 'lod0').status, 'ready');
  h.select('E4');
  assert.ok(h.find('E4', 'lod0'), 'an evicted sheet is fetched again');
});

test('prefetch keeps working on balanced after the first move: it takes the oldest visited slot, never a pinned one (audit S4)', () => {
  const h = settled('E4', 'balanced');                           // cap 2
  h.select('F4'); h.drain();                                      // E4 and F4 visited: both slots are 'full'
  const fAt = at(...Object.values(cellOf('F4')));
  const mark = h.log.length;
  h.camera(fAt, false, 90);                                       // heading east from F4
  const cmds = h.since(mark);
  assert.deepEqual(cmds.filter((c) => c.type === 'load').map((c) => [c.sheet, c.level]), [['G4', 'lod0'], ['G4', 'halo']]);
  assert.deepEqual(cmds.filter((c) => c.type === 'evict' && c.level === 'lod0').map((c) => c.sheet), ['E4'], 'the oldest visited bundle makes the room');
  h.drain();
  assert.equal(levelOf(h.state(), 'F4', 'lod0').status, 'ready', 'the sheet we are in is never the victim');
  assert.equal(levelOf(h.state(), 'G4', 'lod0').status, 'ready');
  // the guess now counts as a held slot: no second prefetch evicts it
  const more = h.camera(fAt, false, 135);
  assert.ok(!more.some((c) => c.type === 'load' && c.level === 'lod0'), 'one guess at a time on a two-slot device');
  assert.ok(!more.some((c) => c.type === 'evict' && c.sheet === 'G4'));
});

test('the current sheet and the outgoing mesh are never evicted, even over the cap', () => {
  const h = settled('E4', 'low');                              // cap 1
  h.select('F4');
  assert.equal(levelOf(h.state(), 'E4', 'lod0').status, 'ready', 'E4 stays while F4 loads: it is still on screen');
  h.drain();
  assert.equal(levelOf(h.state(), 'E4', 'lod0').status, 'evicted');
  assert.equal(levelOf(h.state(), 'F4', 'lod0').status, 'ready');
});

/* P3b turned the cross-fade OFF in the shipped table (a kept mesh would be tinted by the new sheet's heat); the machinery stays, so
   these tests switch it on. */
const FADING = { ...DEFAULT_CONFIG, budgets: { ...SHEET_BUDGETS, full: { ...SHEET_BUDGETS.full, crossFade: true } } };

test('cross-fade: full keeps the old mesh until handover-done; other tiers dispose it at once; a second move cleans the first', () => {
  const full = settled('E4', 'full', FADING);
  full.select('F4');
  const swap = full.finish('F4', 'lod0').find((c) => c.type === 'make-current');
  assert.deepEqual(swap, { type: 'make-current', sheet: 'F4', outgoing: 'E4', outgoingMesh: 'keep-until-handover' });
  assert.equal(full.state().outgoing, 'E4');
  const done = full.send({ type: 'handover-done' });
  assert.deepEqual(done, [{ type: 'dispose-mesh', sheet: 'E4' }]);
  assert.equal(full.state().outgoing, null);

  const quick = settled('E4', 'full', FADING);
  quick.select('F4'); quick.drain();
  quick.select('G4');
  const second = quick.finish('G4', 'lod0');
  assert.ok(second.some((c) => c.type === 'dispose-mesh' && c.sheet === 'E4'), 'the unfinished hand-over is closed');
  assert.ok(second.some((c) => c.type === 'make-current' && c.outgoing === 'F4'));

  const phone = settled('E4', 'balanced');
  phone.select('F4');
  assert.equal(phone.finish('F4', 'lod0').find((c) => c.type === 'make-current').outgoingMesh, 'dispose-now');
});

test('cross-fade is refused when both meshes would not fit under the ceiling', () => {
  const tight = { ...DEFAULT_CONFIG, budgets: { ...SHEET_BUDGETS, full: { ...SHEET_BUDGETS.full, gpuCeilingMB: 200 } } };
  const h = settled('E4', 'full', { ...tight, budgets: { ...tight.budgets, full: { ...tight.budgets.full, crossFade: true } } });   // E4 alone is 44 + 131 MB
  h.select('F4');
  assert.equal(h.finish('F4', 'lod0').find((c) => c.type === 'make-current').outgoingMesh, 'dispose-now');
});

test('over the GPU ceiling the massing is shed, farthest first, never the mesh', () => {
  const b = SHEET_BUDGETS.balanced, e4 = lod0MeshMB('balanced', T.buildings('E4'));
  const tight = { ...DEFAULT_CONFIG, budgets: { ...SHEET_BUDGETS, balanced: { ...b, gpuCeilingMB: b.baselineMB + e4 + b.lod1MeshMB * 3.2 } } };
  const h = settled('E4', 'balanced', tight);                  // room for three LOD1 meshes after E4's ~23 MB
  const ready = [...h.state().sheets].filter(([, e]) => e.lod1.status === 'ready').map(([c]) => c);
  assert.equal(ready.length, 3);
  assert.ok(gpuMB(tight, h.state()) <= tight.budgets.balanced.gpuCeilingMB);
  assert.ok(ready.every((c) => ['E3', 'F4', 'E5', 'D4'].includes(c)), 'edge neighbours are kept before corners');
});

test('the budget table holds the plan ceilings for the densest pair of sheets, ring included', () => {
  const sizes = T.codes.map((c) => T.buildings(c)).sort((a, b) => b - a);
  const mesh = (tier, n) => (n * SHEET_BUDGETS[tier].lod0.verticesPerBuilding * SHEET_BUDGETS[tier].lod0.bytesPerVertex) / 1e6;
  for (const tier of ['full', 'balanced', 'low']) {
    const b = SHEET_BUDGETS[tier];
    const ring = (b.ring === 'ring8' ? 8 : 4) * b.lod1MeshMB;
    const meshes = b.crossFade ? mesh(tier, sizes[0]) + mesh(tier, sizes[1]) : mesh(tier, sizes[0]);
    assert.ok(b.baselineMB + meshes + ring <= b.gpuCeilingMB, `${tier}: ${b.baselineMB + meshes + ring} MB over ${b.gpuCeilingMB}`);
  }
});

test('memory pressure: moderate narrows the ring to edges and drops spare bundles; critical keeps only the current sheet', () => {
  const h = settled('E4', 'full');
  h.select('F4'); h.drain(); h.select('G4'); h.drain();       // E4, F4, G4 resident (cap 3)
  h.send({ type: 'handover-done' });
  const mod = h.send({ type: 'memory-pressure', level: 'moderate' });
  assert.ok(mod.some((c) => c.type === 'evict' && c.level === 'lod0' && c.reason === 'pressure'), 'cap 3 -> 2');
  const dropped = mod.filter((c) => c.type === 'evict' && c.level === 'lod1');
  assert.ok(dropped.length > 0, 'the corner massing goes');
  for (const c of dropped) {
    const { i, j } = cellOf(c.sheet), g = cellOf('G4');
    assert.equal(c.reason, 'pressure');
    assert.ok(Math.abs(i - g.i) + Math.abs(j - g.j) !== 1, `${c.sheet} shares an edge with G4 and must stay`);
  }
  const crit = h.send({ type: 'memory-pressure', level: 'critical' });
  assert.ok(crit.every((c) => c.type === 'evict' || c.type === 'cancel'));
  const left = [...h.state().sheets].filter(([, e]) => e.lod0.status === 'ready' || e.lod1.status === 'ready').map(([c]) => c);
  assert.deepEqual(left, ['G4']);
  const calm = h.send({ type: 'memory-pressure', level: 'none' });
  assert.ok(calm.some((c) => c.type === 'load' && c.level === 'lod1'), 'the ring comes back when the pressure lifts');
});

test('a tier change re-fits: low evicts spare bundles and shrinks the ring, tagged "tier"', () => {
  const h = settled('E4', 'full');
  h.select('F4'); h.drain();
  const cmds = h.send({ type: 'tier-changed', tier: 'low' });
  const evicted = cmds.filter((c) => c.type === 'evict');
  assert.ok(evicted.some((c) => c.level === 'lod0' && c.sheet === 'E4' && c.reason === 'tier'));
  assert.ok(evicted.some((c) => c.level === 'lod1'), 'the diagonal massing goes');
  assert.equal(h.state().tier, 'low');
});

// ── failure ─────────────────────────────────────────────────────────────────

test('a failed load is retried on the backoff schedule, then reported once and left for an explicit retry', () => {
  const h = new Host('full');
  h.start('E4');
  const t0 = h.t;
  h.fail('E4', 'lod0');
  assert.equal(h.m.nextWakeMs(t0 + 1300), t0 + RETRY_BACKOFF_MS[0], 'the loader phases are behind us; the retry is next');
  const quiet = (cmds) => cmds.filter((c) => c.type !== 'loader');
  assert.deepEqual(quiet(h.at(t0 + RETRY_BACKOFF_MS[0] - 1).tick()), []);
  const second = quiet(h.at(t0 + RETRY_BACKOFF_MS[0]).tick());
  assert.deepEqual(second.map((c) => [c.type, c.sheet, c.level]), [['load', 'E4', 'lod0']]);
  h.fail('E4', 'lod0');
  const t2 = h.t;
  assert.equal(quiet(h.at(t2 + RETRY_BACKOFF_MS[1] - 1).tick()).length, 0);
  assert.equal(h.at(t2 + RETRY_BACKOFF_MS[1]).tick().filter((c) => c.type === 'load').length, 1);
  const last = h.fail('E4', 'lod0');
  assert.deepEqual(last, [{ type: 'failure', sheet: 'E4', level: 'lod0', attempts: MAX_ATTEMPTS }]);
  assert.deepEqual(quiet(h.advance(600_000).tick()), [], 'exhausted: no more automatic tries');
  assert.equal(h.m.nextWakeMs(h.t), null);
  const again = h.send({ type: 'retry', sheet: 'E4', level: 'lod0' });
  assert.deepEqual(again.map((c) => [c.type, c.sheet, c.level]), [['load', 'E4', 'lod0']]);
});

test('a lost halo still lets the sheet solve, on the edge rule, once it is given up on', () => {
  const h = new Host('full');
  h.start('E4');
  h.finish('E4', 'lod0');
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    h.fail('E4', 'halo');
    if (k < MAX_ATTEMPTS - 1) h.advance(RETRY_BACKOFF_MS[k]).tick();
  }
  const solve = h.of('solve');
  assert.equal(solve.length, 1);
  assert.equal(solve[0].haloLoaded, false);
  assert.ok(!h.of('failure').some((c) => c.level === 'lod1'));
});

test('a neighbour whose massing fails is retried quietly: no failure report for a non-current sheet', () => {
  const g = new Host('full');
  g.start('E4'); g.finish('E4', 'lod0'); g.finish('E4', 'halo');
  const first = [...g.pending.values()].find((c) => c.level === 'lod1');
  g.fail(first.sheet, 'lod1');
  g.advance(RETRY_BACKOFF_MS[0]).tick();
  assert.ok(g.pending.size > 0);
  assert.equal(g.of('failure').length, 0);
});

// ── the machine itself ──────────────────────────────────────────────────────

test('reduce is pure: the input state is untouched and the output frozen', () => {
  const s0 = initialState('full');
  const s1 = reduce(DEFAULT_CONFIG, s0, { type: 'start', atMs: 0, sheet: 'E4' }).state;
  assert.equal(s0.current, null);
  assert.equal(s0.sheets.size, 0);
  assert.ok(Object.isFrozen(s1));
  const snapshot = JSON.stringify([...s1.sheets]);
  reduce(DEFAULT_CONFIG, s1, { type: 'select', atMs: 5, sheet: 'F4' });
  assert.equal(JSON.stringify([...s1.sheets]), snapshot, 'the previous state is not mutated by the next step');
});

test('gpuMB follows the model: baseline + displayed mesh + massing', () => {
  const h = settled('E4', 'full');
  const ring = [...h.state().sheets].filter(([, e]) => e.lod1.status === 'ready').length;
  const e4 = (T.buildings('E4') * 128 * 48) / 1e6;
  assert.ok(Math.abs(gpuMB(DEFAULT_CONFIG, h.state()) - (44 + e4 + ring * SHEET_BUDGETS.full.lod1MeshMB)) < 1e-9);
  assert.ok(Math.abs(e4 - 131.1) < 0.2, `E4 is ${e4} MB bevelled (bevel-core: 131.1)`);
});

/** A tiny seeded generator, so a failing walk can be replayed. */
function rng(seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32); }

test('B2: arriving at a sheet that failed for good while the user was away fetches it afresh, instead of leaving the plate up', () => {
  const h = settled('E4');
  h.select('F4');
  for (let k = 0; k < MAX_ATTEMPTS; k++) {                       // F4's lod0 fails every time, until it is reported
    h.fail('F4', 'lod0');
    if (k < MAX_ATTEMPTS - 1) h.advance(RETRY_BACKOFF_MS[k]).tick();
  }
  assert.equal(h.of('failure').length, 1);
  h.select('E4');                                               // the user gives up and goes back
  h.advance(1000);
  assert.equal(h.state().displayed, 'E4');
  const mark = h.log.length;
  h.select('F4');                                               // and tries again
  const loads = h.since(mark).filter((c) => c.type === 'load');
  assert.deepEqual(loads.map((c) => [c.sheet, c.level, c.priority]), [['F4', 'lod0', 'high'], ['F4', 'halo', 'high']], 'a fresh fetch, not a silent plate');
  // if the network is still down it ends as before: three attempts, then a second report, never a plate with nothing behind it
  for (let k = 0; k < MAX_ATTEMPTS; k++) {
    h.fail('F4', 'lod0');
    if (k < MAX_ATTEMPTS - 1) h.advance(RETRY_BACKOFF_MS[k]).tick();
  }
  assert.equal(h.of('failure').length, 2);
  assert.equal(h.m.nextWakeMs(h.t + 100_000), null);
});

test('S1: a demotion rebuilds the on-screen mesh at the new tier, and the model prices what is really there', () => {
  const h = settled('E4', 'full');
  assert.ok(gpuMB(DEFAULT_CONFIG, h.state()) > 150, 'the bevelled E4 mesh is on screen (153 MB)');
  const cmds = h.send({ type: 'tier-changed', tier: 'low' });
  assert.deepEqual(cmds.filter((c) => c.type === 'rebuild-mesh'), [{ type: 'rebuild-mesh', sheet: 'E4', tier: 'low' }]);
  assert.equal(h.state().displayedTier, 'low');
  assert.ok(gpuMB(DEFAULT_CONFIG, h.state()) <= SHEET_BUDGETS.low.gpuCeilingMB);
  // a promotion keeps the cheaper mesh: nothing to rebuild, nothing over the ceiling
  const up = h.send({ type: 'tier-changed', tier: 'full' });
  assert.equal(up.filter((c) => c.type === 'rebuild-mesh').length, 0);
  assert.equal(h.state().displayedTier, 'low');
  // a mesh built at a tier stays priced at that tier even if the ceiling moves under it
  h.select('F4'); h.finish('F4', 'lod0');
  assert.equal(h.state().displayedTier, 'full', 'new meshes are built at the current tier');
});

test('S1: a demotion in the middle of a cross-fade drops the outgoing mesh built at the old tier', () => {
  const h = settled('E4', 'full', FADING);
  h.select('F4'); h.finish('F4', 'lod0');
  assert.equal(h.state().outgoing, 'E4');
  const cmds = h.send({ type: 'tier-changed', tier: 'balanced' });
  assert.deepEqual(cmds.filter((c) => c.type === 'dispose-mesh'), [{ type: 'dispose-mesh', sheet: 'E4' }]);
  assert.deepEqual(cmds.filter((c) => c.type === 'rebuild-mesh').map((c) => c.sheet), ['F4']);
});

test('S2: the first solve does not wait for the halo; a halo arriving later (after a failure or a slow fetch) re-solves once', () => {
  const h = new Host('full');
  h.start('E4');
  const shown = h.finish('E4', 'lod0');                          // P3b: the solve runs on the edge rule at once
  const solve = shown.find((c) => c.type === 'solve');
  assert.ok(solve && solve.haloLoaded === false && solve.upgrade === false);
  const failed = h.fail('E4', 'halo');                           // one failure: nothing more to solve
  assert.equal(failed.filter((c) => c.type === 'solve').length, 0);
  h.advance(RETRY_BACKOFF_MS[0]).tick();                         // the automatic retry
  const arrived = h.finish('E4', 'halo');
  const again = arrived.filter((c) => c.type === 'solve');
  assert.equal(again.length, 1);
  assert.ok(again[0].haloLoaded === true && again[0].upgrade === true);
  assert.equal(h.of('solve').length, 2);
  h.advance(10);
  assert.equal(h.tick().filter((c) => c.type === 'solve').length, 0, 'and no third');
});

test('S2: a halo that is already here when the sheet is shown makes the first solve the real one; it is never "upgraded"', () => {
  const h = new Host('full');
  h.start('E4'); h.finish('E4', 'halo');
  assert.equal(h.of('solve').length, 0, 'the halo alone changes nothing: the solve needs the displayed sheet');
  h.finish('E4', 'lod0');
  assert.equal(h.of('solve').length, 1);
  assert.equal(h.of('solve')[0].upgrade, false);
  assert.equal(h.of('solve')[0].haloLoaded, true);
});

test('N1: a second start disposes the meshes the first one left on screen', () => {
  const h = settled('E4', 'full', FADING);
  h.select('F4'); h.finish('F4', 'lod0');                       // E4 outgoing, F4 displayed
  const cmds = h.start('D4');
  assert.deepEqual(cmds.filter((c) => c.type === 'dispose-mesh').map((c) => c.sheet).sort(), ['E4', 'F4']);
  assert.equal(h.state().displayed, null);
});

test('N2: no wake for the retry of a level nobody wants any more', () => {
  const h = new Host('full');
  h.start('E4'); h.finish('E4', 'lod0'); h.finish('E4', 'halo');
  const ring = [...h.pending.values()].find((c) => c.level === 'lod1');
  const t0 = h.t;
  h.fail(ring.sheet, 'lod1');
  assert.equal(h.m.nextWakeMs(t0), t0 + RETRY_BACKOFF_MS[0], 'wanted while it is a neighbour of the current sheet');
  h.select('B3');                                               // far away: that neighbour is not in B3's ring
  h.drain();
  assert.equal(levelOf(h.state(), ring.sheet, 'lod1').status, 'failed', 'the failure is still on record');
  assert.equal(h.t, t0);
  assert.equal(h.m.nextWakeMs(h.t), null, 'but nobody wants it, so nothing is due');
});

test('a random walk of 3,000 events on every tier keeps every invariant', () => {
  for (const [seed, tier] of [[1, 'full'], [2, 'balanced'], [3, 'low'], [4, 'full'], [5, 'balanced']]) {
    const rand = rng(seed);
    const pick = (a) => a[Math.floor(rand() * a.length)];
    const h = new Host(tier);
    h.start(pick(T.codes));
    const tiers = ['full', 'balanced', 'low'];
    for (let step = 0; step < 3000; step++) {
      h.advance(Math.floor(rand() * 700));
      const r = rand();
      const mark = h.log.length;
      if (r < 0.28 && h.pending.size) { const c = pick([...h.pending.values()]); h.pending.delete(c.requestId); h.finished = c; h.send({ type: 'load-finished', requestId: c.requestId }); }
      else if (r < 0.34 && h.pending.size) { const c = pick([...h.pending.values()]); h.pending.delete(c.requestId); h.finished = c; h.send({ type: 'load-failed', requestId: c.requestId, reason: 'r' }); }
      else if (r < 0.40) h.select(rand() < 0.1 ? 'ZZ' : pick(T.codes));
      else if (r < 0.80) {
        const cell = cellOf(pick(T.codes));
        h.camera(at(cell.i + Math.round(rand() * 2 - 1), cell.j + Math.round(rand() * 2 - 1), (rand() - 0.5) * 3000, (rand() - 0.5) * 3000), rand() < 0.4, rand() < 0.8 ? rand() * 360 : null);
      }
      else if (r < 0.86) h.tick();
      else if (r < 0.89) h.send({ type: 'tier-changed', tier: pick(tiers) });
      else if (r < 0.92) h.send({ type: 'network-changed', network: pick(['fast', 'constrained']) });
      else if (r < 0.95) h.send({ type: 'memory-pressure', level: pick(['none', 'moderate', 'critical']) });
      else if (r < 0.98) h.send({ type: 'handover-done' });
      else h.send({ type: 'retry', sheet: pick(T.codes), level: pick(['lod0', 'halo', 'lod1']) });

      const s = h.state();
      for (const c of h.since(mark)) {
        if (c.type === 'load') assert.ok(T.has(c.sheet), `seed ${seed} step ${step}: loaded ${c.sheet}`);
      }
      // a request id is in flight at most once, and the host's view equals the machine's
      const loading = [];
      for (const [sheet, e] of s.sheets) for (const lv of ['lod0', 'halo', 'lod1']) if (e[lv].status === 'loading') loading.push(e[lv].requestId);
      assert.equal(new Set(loading).size, loading.length);
      assert.deepEqual([...h.pending.keys()].sort((a, b) => a - b), loading.sort((a, b) => a - b), `seed ${seed} step ${step}: host and machine disagree about what is in flight`);
      // the picture on screen is always a ready sheet, and the sheet we are in is never evicted
      if (s.displayed !== null) assert.equal(levelOf(s, s.displayed, 'lod0').status, 'ready', `step ${step}: displayed ${s.displayed}`);
      if (s.current !== null) assert.notEqual(levelOf(s, s.current, 'lod0').status, 'evicted');
      // bundles held never exceed the cap, except for the pinned ones
      const cap = Math.max(1, SHEET_BUDGETS[s.tier].maxLod0Sheets - (s.pressure === 'moderate' ? 1 : 0));
      const pinned = new Set([s.current, s.displayed, s.outgoing].filter(Boolean)).size;
      const held = [...s.sheets.values()].filter((e) => e.lod0.status === 'ready' || e.lod0.status === 'loading').length;
      assert.ok(held <= Math.max(cap, pinned) + 1, `seed ${seed} step ${step}: ${held} bundles held, cap ${cap}, pinned ${pinned}`);
      // the GPU model never exceeds the tier's ceiling, tier changes included (audit S1)
      const ceiling = SHEET_BUDGETS[s.tier].gpuCeilingMB;
      assert.ok(gpuMB(DEFAULT_CONFIG, s) <= ceiling, `seed ${seed} step ${step}: model ${gpuMB(DEFAULT_CONFIG, s)} MB over the ${s.tier} ceiling ${ceiling}`);
      // wake times, when there are any, lie ahead
      const wake = nextWakeMs(DEFAULT_CONFIG, s, h.t);
      assert.ok(wake === null || wake > h.t);
    }
  }
});

/* S3 (P3b audit): the manager changes `displayed` only when the page answers `opened`. */
test('S3: make-current alone changes nothing the page can see: displayed, solve and the old sheet\'s bundle stay as they were', () => {
  const h = settled('E4', 'balanced');
  h.autoOpen = false;
  const solvesBefore = h.of('solve').length;
  h.select('F4');
  const cmds = h.finish('F4', 'lod0');
  assert.ok(cmds.some((c) => c.type === 'make-current' && c.sheet === 'F4'));
  const s = h.state();
  assert.equal(s.displayed, 'E4', 'the page still shows E4');
  assert.equal(s.opening.sheet, 'F4');
  assert.equal(cmds.filter((c) => c.type === 'solve').length, 0, 'no solve for a sheet that is not open');
  assert.equal(cmds.filter((c) => c.type === 'evict' && c.sheet === 'E4' && c.level === 'lod0').length, 0, 'the bundle of the ward on screen is not evicted');
  assert.equal(h.of('solve').length, solvesBefore);
  h.send({ type: 'tick' });
  assert.equal(h.of('make-current').filter((c) => c.sheet === 'F4').length, 1, 'asked once, not every event');
  const done = h.send({ type: 'opened', sheet: 'F4' });
  assert.equal(h.state().displayed, 'F4');
  assert.ok(done.some((c) => c.type === 'solve' && c.sheet === 'F4'));
});

test('S3: an `opened` for a sheet the user has since left is ignored', () => {
  const h = settled('E4', 'balanced');
  h.autoOpen = false;
  h.select('F4'); h.finish('F4', 'lod0');
  h.select('D4');                                                // the user moved on while F4 was opening
  h.send({ type: 'opened', sheet: 'F4' });
  assert.equal(h.state().displayed, 'E4');
  assert.equal(h.state().opening, null);
});

test('S3: a failed open leaves the manager and the page agreeing on the old sheet, and does not retry in a loop', () => {
  const h = settled('E4', 'balanced');
  h.autoOpen = false;
  h.select('F4'); h.finish('F4', 'lod0');
  const cmds = h.send({ type: 'open-failed', sheet: 'F4' });
  const s = h.state();
  assert.equal(s.current, 'E4'); assert.equal(s.displayed, 'E4'); assert.equal(s.opening, null);
  assert.ok(cmds.some((c) => c.type === 'failure' && c.sheet === 'F4'));
  assert.equal(cmds.filter((c) => c.type === 'evict' && c.sheet === 'E4').length, 0);
  assert.equal(s.loader, null, 'no plate left up');
  // the camera is still over F4: it must be seen inside E4 again before F4 can be crossed into
  const over = { lon: T.cell('F4') && at(1, 0, 0, 0).lon, lat: at(1, 0, 0, 0).lat };
  h.advance(5_000); h.camera(over); h.advance(1_000); h.tick();
  assert.equal(h.of('make-current').filter((c) => c.sheet === 'F4').length, 1, 'no second attempt while the camera has not come back');
});
