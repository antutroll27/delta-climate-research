import assert from 'node:assert/strict';
import test from 'node:test';

import { createCityStream } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';
import { createPageFurniture } from '../../src/scripts/climate-engine/streaming/area-page.ts';
import { createLoaderModel, isVisible, parseAreaNames, stagesOf } from '../../src/scripts/climate-engine/streaming/loader-model.ts';

/* THE INTEGRATION AUDIT (INT-AUDIT.md, F1 F2 F5 F7): the real manager, executor, controller (`createCityStream`), loader model and page
   furniture; only the network, the worker and the DOM are faked. Derived from the auditor's node repros (hold.mjs, flyinterrupt.mjs,
   races.mjs). Unlike the page-furniture test's rig, THE PAGE'S OPEN TAKES TIME, as the app's does: `showSheet` commits at once and
   then holds for `holdMs` (the app waits up to 4 s for the buildings and the first heat solve), so a loader that waits for the end of
   that hold can be seen drawing over an area that is already on screen. */

const N = 384 * 384;
const layers = () => ({ albedo: new Float32Array(N), veg: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N) });
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await wait(5); }
}
const C = { E4: [4.885, 52.364], F4: [4.926190546565045, 52.364], E5: [4.885, 52.33866980278632] };

function rig({ holdMs = 5, fail = () => false, hold = () => null, dispatchedThrows = false, stageThrows = false } = {}) {
  const log = { show: [], visible: [], commands: [], warn: [], areaSelect: [], failures: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const gate = hold(u);
    if (gate) await gate;
    if (fail(u)) return new Response('no', { status: 500 });
    const body = u.endsWith('-roads.json') ? { ways: [] } : u.endsWith('-water.json') ? { polys: [] } : /-(terrain|trees)\.json$/.test(u) ? {} : { b: [[10, 0, 0, 5, 0, 5, 5, 0, 5]], count: 1, sizeM: 2800 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const worker = {
    async prepare() { return { base: layers(), spatial: {}, buildings: 1, ms: 0 }; },
    async mesh() { return { mesh: { kind: 'packed', vertexCount: 0 }, ao: null, ms: 0 }; },
    async massing() { return { mesh: { kind: 'massing', position: new Float32Array(0), normal: new Int8Array(0), index: new Uint32Array(0), vertexCount: 0, buildings: 0 }, ms: 0 }; },
    forget() {}, dispose() {},
  };
  const loaderModel = createLoaderModel({ firstEntry: false });
  const clock = () => performance.now();
  const loader = {
    command: (c) => { log.commands.push(`${Math.round(clock())}:${c.type}:${c.sheet ?? ''}:${c.phase ?? ''}`); if (c.type === 'failure') log.failures.push(c.sheet); loaderModel.dispatch({ type: 'command', atMs: clock(), command: c }); },
    stage: (sheet, stage) => { if (stageThrows && stage === 'sim') throw new Error('the loader view threw'); loaderModel.dispatch({ type: 'stage', atMs: clock(), sheet, stage }); },
    setFacts: (sheet, facts) => loaderModel.dispatch({ type: 'facts', atMs: clock(), sheet, facts }),
  };
  let dispatchCount = 0;
  const furniture = createPageFurniture({
    loader, picker: { update() { dispatchCount++; if (dispatchedThrows && dispatchCount > 1) throw new Error('the picker threw'); }, setDrawnCount() {} }, names: parseAreaNames(null),
    location: () => ({ pathname: '/', search: '?stream=1', hash: '' }),
    writer: { header() {}, areaSelect: (c) => log.areaSelect.push(c), address() {} },
  });
  let committed = null;
  let tierNow = 'full';       // the page sets its tier BEFORE it tells the controller (heat-map-app `setStreamTier`)
  const hooks = {
    tier: () => tierNow, network: () => 'fast', relief: () => ({ setNeighbours() {}, setSeamFade() {} }),
    registeredSurface: () => Promise.resolve({ means: { fvc: 0.2, albedo: 0.2 }, surface: null }),
    installBundle() {}, dropBundle() {},
    async showSheet(code, prepared, ao, first, afterCommit, fly = false, rebuild = false) {
      log.show.push({ code, first, fly, rebuild, at: Math.round(clock()) });
      committed = code; furniture.areaShown(code, 1); afterCommit();
      await wait(holdMs);                              // the app's post-commit hold (buildingsReady + the first solve, capped at 4 s)
      if (stageThrows) furniture.stage(code, 'sim');   // the app reports the heat-solve stage here
    },
    setHaloSupply() {}, resolve() {}, loader() {}, failure() {}, warn: (m) => log.warn.push(m),
    command: furniture.command, stage: furniture.stage, facts: furniture.facts, dispatched: furniture.dispatched,
  };
  const stream = createCityStream(hooks, worker);
  const timer = setInterval(() => {
    if (isVisible(loaderModel.state(), clock())) log.visible.push({ at: Math.round(clock()), committed, sheet: loaderModel.state().sheet, mode: loaderModel.state().mode });
  }, 10);
  return { stream, log, loaderModel, setTier: (t) => { tierNow = t; }, committed: () => committed, stop: () => { clearInterval(timer); stream.dispose(); globalThis.fetch = realFetch; } };
}

async function openE4(r) {
  r.stream.start('E4');
  await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
  await wait(300);
}

// ── F1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('F1: a PANNED crossing whose area commits fast never shows the loader, however long the post-commit hold runs', async () => {
  const r = rig({ holdMs: 1500 });
  try {
    await openE4(r);
    r.stream.camera(...C.E4, false, null);
    r.stream.camera(...C.F4, false, null);                       // a pan crossing into F4; the network is instant
    await until(() => r.log.show.some((s) => s.code === 'F4'), 'F4 committed');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed', 4000);
    await wait(1700);                                             // past the hold, the 400 ms rise and the 1.2 s plate
    assert.deepEqual(r.log.visible.filter((v) => v.committed === 'F4'), [], 'the loader was drawn over an area that was already on screen');
    assert.ok(!r.log.commands.some((c) => /:loader:F4:(rise|plate)/.test(c)), `no rise/plate command after the commit: ${r.log.commands.filter((c) => c.includes('loader')).join(' ')}`);
    assert.equal(r.loaderModel.state().mode, 'idle');
  } finally { r.stop(); }
});

test('F1: a PICK of an area that is ready inside the fast window never shows the loader either', async () => {
  const r = rig({ holdMs: 1500 });
  try {
    await openE4(r);
    r.stream.select('F4');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed', 4000);
    await wait(1700);
    assert.deepEqual(r.log.visible.filter((v) => v.committed === 'F4'), []);
    assert.equal(r.log.show.at(-1).fly, true, 'a choice still flies the camera');
  } finally { r.stop(); }
});

test('F1: a loader that WAS legitimately shown (a slow area) holds until the hold ends, then ends, with the heat-solve stage reported first', async () => {
  let release = () => undefined;
  const gate = new Promise((res) => { release = res; });
  const r = rig({ holdMs: 700, hold: (u) => (u.includes('ams-f4') && !u.endsWith('ams-f4.json') ? gate : null) });
  try {
    await openE4(r);
    r.stream.select('F4');
    setTimeout(release, 1600);                                    // past the plate (1.2 s): the person has been looking at it
    await until(() => r.log.show.some((s) => s.code === 'F4'), 'F4 committed');
    assert.equal(r.loaderModel.state().mode, 'plate', 'the plate was up at the commit');
    assert.ok(isVisible(r.loaderModel.state(), performance.now()));
    await wait(200);
    assert.ok(isVisible(r.loaderModel.state(), performance.now()), 'and it holds while the buildings and the first solve land');
    assert.equal(r.stream.report().displayed, 'E4', 'the manager has not been told the area is open yet');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed');
    assert.equal(r.loaderModel.state().mode, 'idle');
    assert.equal(r.loaderModel.state().lastEnd.shown, true);
  } finally { r.stop(); }
});

// ── F2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('F2a: grabbing the map during the picker fly (the fly ends over E4) and panning on streams the area under the camera', async () => {
  const r = rig();
  try {
    await openE4(r);
    r.stream.select('F4');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed');
    r.stream.flyEnded?.();                                        // MapLibre's `moveend` for the interrupted fly: the camera is still over E4
    for (let i = 0; i < 20; i++) { r.stream.camera(C.E4[0], C.E4[1] + (C.E5[1] - C.E4[1]) * i / 19, true, null); await wait(110); }
    r.stream.camera(...C.E5, false, null);
    await until(() => r.stream.report().displayed === 'E5', 'E5 opened by the pan', 4000);
    assert.equal(r.stream.report().current, 'E5');
  } finally { r.stop(); }
});

test('F2a: the end of a fly that completed (camera over the picked area) changes nothing', async () => {
  const r = rig();
  try {
    await openE4(r);
    r.stream.select('F4');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed');
    r.stream.camera(...C.F4, false, null);
    r.stream.flyEnded?.();
    await wait(800);
    assert.equal(r.stream.report().current, 'F4');
    assert.equal(r.stream.report().displayed, 'F4');
    assert.equal(r.log.show.length, 2, 'E4, then F4: nothing else opened');
  } finally { r.stop(); }
});

test('F2b + F7: a picked area that fails for good — the Area select goes back to the area on screen, and panning on still streams', async () => {
  const r = rig({ fail: (u) => /ams-f4(\.json|-surface)/.test(u) });
  try {
    await openE4(r);
    const before = r.log.areaSelect.length;                       // E4's own commit wrote it once
    r.stream.select('F4');
    await until(() => r.log.failures.includes('F4'), 'the F4 failure plate', 20000);
    await wait(50);
    assert.ok(r.log.areaSelect.length > before, 'F7: the failure restates the Area select');
    assert.equal(r.log.areaSelect.at(-1), 'E4', 'F7: it names the area that is on screen, not the one that did not open');
    assert.equal(r.stream.report().displayed, 'E4');
    for (let i = 0; i < 20; i++) { r.stream.camera(C.E4[0] + (C.E5[0] - C.E4[0]) * i / 19, C.E4[1] + (C.E5[1] - C.E4[1]) * i / 19, true, null); await wait(110); }
    r.stream.camera(...C.E5, false, null);
    await until(() => r.stream.report().displayed === 'E5', 'E5 opened by the pan', 4000);
    assert.equal(r.stream.report().current, 'E5');
  } finally { r.stop(); }
});

test('F2b: after the failure plate, nudging the map inside the area on screen keeps the plate (and its Retry); only another area takes over', async () => {
  const r = rig({ fail: (u) => /ams-f4(\.json|-surface)/.test(u) });
  try {
    await openE4(r);
    r.stream.select('F4');
    await until(() => r.log.failures.includes('F4'), 'the F4 failure plate', 20000);
    for (let i = 0; i < 6; i++) { r.stream.camera(C.E4[0] + i * 0.0002, C.E4[1], true, null); await wait(110); }
    r.stream.camera(C.E4[0] + 0.001, C.E4[1], false, null);
    await wait(900);
    assert.equal(r.stream.report().current, 'F4', 'still the failed pick');
    assert.equal(r.loaderModel.state().mode, 'failed', 'the plate stays');
  } finally { r.stop(); }
});

// ── F5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('F5: a page-furniture view that throws in `dispatched` cannot swallow the commands of the event, or stop the next one', async () => {
  const r = rig({ dispatchedThrows: true });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed despite the throwing picker');
    await wait(200);
    r.stream.select('F4');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed despite the throwing picker');
    assert.ok(r.log.warn.some((m) => /page furniture/.test(m)), 'and the failure was reported');
  } finally { r.stop(); }
});

test('F5: a throw from the loader view\'s stage call AFTER the commit is a warning, not an `open-failed` that reverts a committed area', async () => {
  const r = rig({ holdMs: 20, stageThrows: true });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed despite a throwing stage');
    assert.equal(r.stream.report().current, 'E4');
    assert.deepEqual(r.log.failures, [], 'no failure plate for an area that opened');
  } finally { r.stop(); }
});

// ── F3 (controller side) ────────────────────────────────────────────────────────────────────────────────────────

test('F3: a tier demotion rebuilds the open area through showSheet as a REBUILD (no fly), (no fly, no grow)', async () => {
  const r = rig();
  const calls = [];
  try {
    await openE4(r);
    const hooksShow = r.log.show.length;
    r.setTier('balanced');
    r.stream.tierChanged('balanced');
    await until(() => r.log.show.length > hooksShow, 'the rebuild to reach showSheet');
    const last = r.log.show.at(-1);
    assert.equal(last.code, 'E4');
    assert.equal(last.rebuild, true, 'flagged as a rebuild, so the page can reload the ward on screen');
    assert.equal(last.fly, false);
    assert.equal(last.first, false);
  } finally { r.stop(); }
});

// ── F6 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

import { createLateStream } from '../../src/scripts/climate-engine/streaming/late-stream.ts';

test('F6: a choice made before the controller exists is kept (latest wins) and delivered on bind; nothing throws; a retry before any load is dropped', () => {
  const seen = [];
  const target = { select: (c) => seen.push(`select:${c}`), retry: (c, l) => seen.push(`retry:${c}/${l}`) };
  const late = createLateStream();
  assert.doesNotThrow(() => { late.select('F4'); late.select('G5'); late.retry('F4', 'lod0'); });
  assert.deepEqual(seen, []);
  late.bind(target);
  assert.deepEqual(seen, ['select:G5'], 'the latest choice, once');
  late.select('F5'); late.retry('F5', 'lod0');
  assert.deepEqual(seen, ['select:G5', 'select:F5', 'retry:F5/lod0'], 'after the bind everything goes straight through');
  const empty = createLateStream();
  empty.bind(target);
  assert.equal(seen.length, 3, 'binding with no queued choice selects nothing');
});
