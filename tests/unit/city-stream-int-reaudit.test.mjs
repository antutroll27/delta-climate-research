import assert from 'node:assert/strict';
import test from 'node:test';

import { createCityStream } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';
import { createPageFurniture } from '../../src/scripts/climate-engine/streaming/area-page.ts';
import { createLoaderModel, isVisible, parseAreaNames } from '../../src/scripts/climate-engine/streaming/loader-model.ts';
import { configureStreamData } from '../../src/scripts/climate-engine/streaming/data-source.ts';

/* THE INTEGRATION RE-AUDIT (INT-REAUDIT.md, R2 R3 R4 R5): the real manager, executor, controller, loader model and page furniture; only the
   network, the worker and the DOM are faked. Derived from the auditor's repros (flyhold.mjs, revealwin.mjs). Like the INT audit's rig,
   THE PAGE'S OPEN TAKES TIME: `showSheet` commits at once and then holds for `holdMs`, as the app's does (buildings + the first solve, capped at 4 s). */

const N = 384 * 384;
const layers = () => ({ albedo: new Float32Array(N), veg: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N) });
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await wait(5); }
}
const C = { E4: [4.885, 52.364], F4: [4.926190546565045, 52.364], E5: [4.885, 52.33866980278632] };

function rig({ holdMs = 5, fail = () => false, delay = () => 0, rejectAfterCommit = false, rejectBeforeCommit = false, useVisibleHook = true } = {}) {
  const log = { show: [], visible: [], commands: [], warn: [], failures: [], urls: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    log.urls.push(u);
    const d = delay(u);
    if (d > 0) await wait(d);
    if (fail(u)) return new Response('no', { status: 500 });
    if (u.endsWith('ams-r2-manifest.json')) return new Response(JSON.stringify(manifestFor(['ams-f4'])), { status: 200 });
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
    command: (c) => { log.commands.push({ at: clock(), type: c.type, sheet: c.sheet ?? '', phase: c.phase ?? '' }); if (c.type === 'failure') log.failures.push(c.sheet); loaderModel.dispatch({ type: 'command', atMs: clock(), command: c }); },
    stage: (sheet, stage) => loaderModel.dispatch({ type: 'stage', atMs: clock(), sheet, stage }),
    setFacts: (sheet, facts) => loaderModel.dispatch({ type: 'facts', atMs: clock(), sheet, facts }),
    state: () => loaderModel.state(),
  };
  const furniture = createPageFurniture({
    loader, picker: { update() {}, setDrawnCount() {} }, names: parseAreaNames(null),
    location: () => ({ pathname: '/', search: '?stream=1', hash: '' }), writer: { header() {}, areaSelect() {}, address() {} },
    now: clock,
  });
  let committed = null;
  const hooks = {
    tier: () => 'full', network: () => 'fast', relief: () => ({ setNeighbours() {}, setSeamFade() {} }),
    registeredSurface: () => Promise.resolve({ means: { fvc: 0.2, albedo: 0.2 }, surface: null }),
    installBundle() {}, dropBundle() {},
    async showSheet(code, prepared, ao, first, afterCommit, fly = false, rebuild = false) {
      log.show.push({ code, first, fly, rebuild, at: clock() });
      if (rejectBeforeCommit) throw new Error('could not draw');
      committed = code; furniture.areaShown(code, 1); afterCommit();
      await wait(holdMs);                              // the app's post-commit hold (buildingsReady + the first solve)
      if (rejectAfterCommit) throw new Error('the hold failed');
    },
    setHaloSupply() {}, resolve() {}, loader() {}, failure: (code) => log.failures.push(`hook:${code}`), warn: (m) => log.warn.push(m),
    command: furniture.command, stage: furniture.stage, facts: furniture.facts, dispatched: furniture.dispatched,
    ...(useVisibleHook ? { loaderVisible: furniture.loaderVisible } : {}),
  };
  const stream = createCityStream(hooks, worker);
  const timer = setInterval(() => {
    if (isVisible(loaderModel.state(), clock())) log.visible.push({ at: clock(), committed, sheet: loaderModel.state().sheet, mode: loaderModel.state().mode });
  }, 10);
  return { stream, log, loaderModel, stop: () => { clearInterval(timer); stream.dispose(); globalThis.fetch = realFetch; configureStreamData({ kind: 'local' }); } };
}

async function openE4(r) {
  r.stream.start('E4');
  await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
  await wait(300);
}

// ── R2 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('R2: the fly ends (the person grabs the map) while a SHOWN loader still holds the picked area\'s open; panning on then streams the area under the camera', async () => {
  let slow = false;
  const r = rig({ holdMs: 1500, delay: (u) => (slow && /ams-f4/.test(u) ? 700 : 0) });   // F4 is not resident: the loader rises at 400 ms
  try {
    await openE4(r);
    slow = true;
    r.stream.camera(...C.E4, false, null);
    r.stream.select('F4');
    await until(() => r.log.show.some((s) => s.code === 'F4'), 'F4 committed');
    await wait(200);                                            // 200 ms into the fly: the person grabs the map over E4
    r.stream.flyEnded();
    assert.equal(r.stream.report().displayed, 'E4', 'premise: the open is still held (a loader was shown), the manager has not been told');
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed', 8000);
    for (let i = 0; i < 20; i++) { r.stream.camera(C.E4[0], C.E4[1] + (C.E5[1] - C.E4[1]) * i / 19, true, null); await wait(110); }
    r.stream.camera(...C.E5, false, null);
    await until(() => r.stream.report().displayed === 'E5', 'E5 opened by the pan after the interrupted fly', 5000);
    assert.equal(r.stream.report().current, 'E5');
  } finally { r.stop(); }
});

// ── R3 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('R3: a commit inside the 150 ms between the manager\'s rise and the view\'s reveal is a FAST open: no chip over the drawn area, however long the post-commit hold', async () => {
  let slow = false;
  const r = rig({ holdMs: 1500, delay: (u) => (slow && /ams-f4/.test(u) ? 900 : 0) });
  try {
    await openE4(r);
    slow = true;
    r.stream.camera(...C.E4, false, null);
    r.stream.camera(...C.F4, false, null);                      // a pan crossing into F4
    await until(() => r.log.show.some((s) => s.code === 'F4'), 'F4 committed', 10000);
    const commit = r.log.show.find((s) => s.code === 'F4').at;
    const rise = r.log.commands.find((c) => c.type === 'loader' && c.phase === 'rise' && c.sheet === 'F4');
    assert.ok(rise, 'premise: the manager issued a rise before the commit');
    assert.ok(commit >= rise.at && commit < rise.at + 150, `premise: the commit (+${Math.round(commit - rise.at)} ms after the rise) is inside the reveal window`);
    await until(() => r.stream.report().displayed === 'F4', 'F4 displayed', 5000);
    await wait(1700);
    assert.deepEqual(r.log.visible.filter((v) => v.committed === 'F4'), [], 'the loader was drawn over an area that was already on screen');
    assert.ok(!r.log.commands.some((c) => c.type === 'loader' && c.sheet === 'F4' && c.phase === 'plate'), 'and no plate came up either');
  } finally { r.stop(); }
});

// ── R4 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const manifestFor = (ids) => ({
  schema: 1, city: 'amsterdam', version: 'v1', prefix: 'amsterdam/v1', baseUrl: 'https://r2.example',
  files: Object.fromEntries(ids.flatMap((id) => [`${id}.json`, `${id}-roads.json`, `${id}-water.json`, `${id}-trees.json`, `${id}-terrain.json`, `${id}-surface.png`].map((f) => [f, { sha256: 'x', size: 1 }]))),
});

test('R4: a manifest that was unreadable at page load does not poison the session: Retry reads it again and the area opens', async () => {
  let manifestUp = false;
  const r = rig({ fail: (u) => !manifestUp && u.endsWith('ams-r2-manifest.json') });
  try {
    configureStreamData({ kind: 'unavailable', reason: 'HTTP 500' });
    await openE4(r);                                              // Canal Ring never needs the manifest
    r.stream.select('F4');
    await until(() => r.log.failures.includes('F4'), 'the F4 failure plate (the manifest is down)', 30000);
    assert.equal(r.stream.report().displayed, 'E4');
    manifestUp = true;                                            // the phone's connection came back
    r.stream.retry('F4', 'lod0');
    await until(() => r.stream.report().displayed === 'F4', 'Retry opens F4 from the re-read manifest', 15000);
    assert.ok(r.log.urls.some((u) => u.startsWith('https://r2.example/amsterdam/v1/ams-f4')), 'and it came from the manifest\'s R2 base');
  } finally { r.stop(); }
});

test('R4: a neighbour\'s texts asked for while the source was unavailable are not remembered as a rejection (the halo asks first, the pick comes later)', async () => {
  const r = rig({ fail: (u) => u.endsWith('ams-r2-manifest.json') });      // the manifest stays down: only the memo could still hold the failure
  try {
    configureStreamData({ kind: 'unavailable', reason: 'HTTP 500' });
    await openE4(r);                                              // E4's halo asked for every neighbour's texts while the source was down
    await wait(300);
    configureStreamData({ kind: 'manifest', manifest: Object.freeze({ baseUrl: 'https://r2.example', prefix: 'amsterdam/v1', files: manifestFor(['ams-f4']).files }) });
    r.stream.select('F4');
    await until(() => r.stream.report().displayed === 'F4', 'F4 opens once the source is good', 15000);
  } finally { r.stop(); }
});

// ── R5 ──────────────────────────────────────────────────────────────────────────────────────────────────────────

test('R5: a showSheet that rejects AFTER its commit leaves the area open: a warning, no failure plate, and the manager is told it opened', async () => {
  const r = rig({ holdMs: 20, rejectAfterCommit: true });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed although the hold rejected');
    assert.equal(r.stream.report().current, 'E4');
    await until(() => r.log.warn.length > 0, 'the late failure to be reported');
    await wait(100);
    assert.ok(r.log.warn.some((m) => /opened, but its hold failed/.test(m)), `the late failure was reported as such: ${r.log.warn.join(' | ')}`);
    assert.ok(!r.log.warn.some((m) => /could not open sheet/.test(m)), 'and not as an open that failed');
    assert.deepEqual(r.log.failures, [], 'no failure plate for an area that is drawn');
    assert.equal(r.stream.report().displayed, 'E4');
  } finally { r.stop(); }
});

test('R5: a showSheet that rejects BEFORE its commit is an open that failed: the failure plate, and the manager keeps the area on screen', async () => {
  const r = rig({ rejectBeforeCommit: true });
  try {
    r.stream.start('E4');
    await until(() => r.log.failures.includes('E4'), 'the failure plate for an area that never drew');
    assert.equal(r.stream.report().displayed, null);
    assert.ok(r.log.warn.some((m) => /could not open sheet E4/.test(m)));
  } finally { r.stop(); }
});
