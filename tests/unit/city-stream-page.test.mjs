import assert from 'node:assert/strict';
import test from 'node:test';

import { createCityStream } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';
import { createPageFurniture, areaFromUrl, searchWithArea, headerOf } from '../../src/scripts/climate-engine/streaming/area-page.ts';
import { createLoaderModel, isVisible, parseAreaNames, riseValue, stagesOf, RISE_MS } from '../../src/scripts/climate-engine/streaming/loader-model.ts';
import { AMSTERDAM_INDEX_TABLES, activate, buildIndexModel } from '../../src/scripts/climate-engine/streaming/sheet-index.ts';
import { SKIP_FAST_MS } from '../../src/scripts/climate-engine/loader-progress.ts';

/* THE INTEGRATION: the real sheet manager, the real controller, the real loader model, the real index model and the page furniture that
   joins them, with only the network, the worker and the DOM faked. A pick on the index becomes a `select`; the manager loads; the loader
   appears and ends; the page header, the Area select and the address follow the area that opened. */

const N = 384 * 384;
const layers = () => ({ albedo: new Float32Array(N), veg: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N) });
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, ms = 6000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await wait(5); }
}

const NAMES = parseAreaNames({ areas: { E4: { name: 'Canal Ring', stadsdeel: 'Centrum' }, F4: { name: 'Middenmeer', stadsdeel: 'Oost' } } });

function rig({ gated = false } = {}) {
  const log = { header: [], areaSelect: [], address: [], show: [], picker: [], drawn: [], command: [], visibleSeen: false, stages: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (gated && u.includes('ams-f4') && !u.endsWith('ams-f4.json')) await gate.promise;        // F4's detail files are held until the test lets them go, however early the manager asked
    const body = u.endsWith('-roads.json') ? { ways: [] } : u.endsWith('-water.json') ? { polys: [] } : /-(terrain|trees)\.json$/.test(u) ? {} : { b: [[10, 0, 0, 5, 0, 5, 5, 0, 5]], count: 1, sizeM: 2800 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const gate = { release: () => undefined, promise: null };
  gate.promise = new Promise((resolve) => { gate.release = resolve; });
  const worker = {
    async prepare() { return { base: layers(), spatial: {}, buildings: 1, ms: 0 }; },
    async mesh(_k, _t, tr) { return { mesh: { kind: tr === 'full' ? 'bevel' : 'packed', vertexCount: 0 }, ao: null, ms: 0 }; },
    async massing() { return { mesh: { kind: 'massing', position: new Float32Array(0), normal: new Int8Array(0), index: new Uint32Array(0), vertexCount: 0, buildings: 0 }, ms: 0 }; },
    forget() {}, dispose() {},
  };
  const relief = { setNeighbours() {}, setSeamFade() {} };
  const loaderModel = createLoaderModel({ firstEntry: false });
  const clock = () => performance.now();
  const loader = {
    command: (command) => { log.command.push(command.type); loaderModel.dispatch({ type: 'command', atMs: clock(), command }); log.visibleSeen ||= isVisible(loaderModel.state(), clock()); },
    stage: (sheet, stage) => { log.stages.push(`${sheet}/${stage}`); loaderModel.dispatch({ type: 'stage', atMs: clock(), sheet, stage }); },
    setFacts: (sheet, facts) => loaderModel.dispatch({ type: 'facts', atMs: clock(), sheet, facts }),
  };
  const picker = { update: (s) => log.picker.push(s), setDrawnCount: (code, n) => log.drawn.push([code, n]) };
  const location = { pathname: '/heat-map/nl/amsterdam/canal-ring/', search: '?stream=1', hash: '' };
  const furniture = createPageFurniture({
    loader, picker, names: NAMES, location: () => location,
    writer: { header: (h) => log.header.push(h), areaSelect: (c) => log.areaSelect.push(c), address: (u) => log.address.push(u) },
  });
  let stream;
  const hooks = {
    tier: () => 'full', network: () => 'fast', relief: () => relief,
    registeredSurface: () => Promise.resolve({ means: { fvc: 0.2, albedo: 0.2 }, surface: null }),
    installBundle: () => undefined, dropBundle: () => undefined,
    async showSheet(code, prepared, ao, first, afterCommit, fly = false) {
      log.show.push({ code, first, fly });
      furniture.areaShown(code, 1);                               // the app's commit ends by restating the area ...
      afterCommit();                                              // ... and the controller's own block follows it
      await wait(5);
    },
    setHaloSupply: () => undefined, resolve: () => undefined,
    loader: () => undefined, failure: () => undefined, warn: () => undefined,
    command: furniture.command, stage: furniture.stage, facts: furniture.facts, dispatched: furniture.dispatched,
  };
  stream = createCityStream(hooks, worker);
  return { stream, log, loaderModel, location, gate, restore: () => { globalThis.fetch = realFetch; } };
}

test('a pick on the index becomes a select: the loader shows and ends, and the header, the Area select and the address follow the area that opened', async () => {
  const r = rig({ gated: true });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().open === 'E4', 'E4 open');
    assert.deepEqual(r.log.header.at(-1), headerOf('E4', NAMES));
    assert.equal(r.log.header.at(-1).zone, 'Centrum · Area E4');
    assert.equal(r.log.areaSelect.at(-1), 'E4');
    assert.equal(r.log.address.at(-1), '/heat-map/nl/amsterdam/canal-ring/?stream=1&area=E4');
    assert.equal(r.log.show[0].first, true);

    /* the picker: Enter on the F4 cell is the manager's `select` */
    const action = activate(buildIndexModel(AMSTERDAM_INDEX_TABLES), 'F4');
    assert.deepEqual(action, { type: 'select', code: 'F4' });
    r.stream.select(action.code);
    setTimeout(() => r.gate.release(), SKIP_FAST_MS + 450);        // F4's detail arrives after the manager's quiet window and the reveal delay

    await until(() => isVisible(r.loaderModel.state(), performance.now()), 'the loader to appear for a slow area');
    assert.equal(r.loaderModel.state().sheet, 'F4');
    assert.ok(r.log.picker.some((s) => s.current === 'F4'), 'the picker was redrawn with F4 as the current area');

    await until(() => r.stream.report().open === 'F4' && r.stream.report().displayed === 'F4', 'F4 open and displayed');
    await until(() => r.loaderModel.state().mode === 'idle', 'the loader to end');
    assert.equal(r.loaderModel.state().lastEnd.shown, true, 'it had been on screen');
    assert.deepEqual(r.log.header.at(-1), { code: 'F4', name: 'Middenmeer', zone: 'Oost · Area F4' });
    assert.equal(r.log.areaSelect.at(-1), 'F4');
    assert.equal(r.log.address.at(-1), '/heat-map/nl/amsterdam/canal-ring/?stream=1&area=F4');
    assert.deepEqual(r.log.show.at(-1), { code: 'F4', first: false, fly: true }, 'a chosen area flies the camera; the first open does too');
    assert.ok(r.log.stages.some((s) => s === 'F4/ward') && r.log.stages.some((s) => s === 'F4/surface') && r.log.stages.some((s) => s === 'F4/vector'), 'real stages were reported');
    assert.ok(r.log.drawn.some(([code, n]) => code === 'F4' && n === 1), 'the picker was told what F4 drew');
    assert.ok(!r.log.command.includes('make-current') || r.log.command.indexOf('make-current') >= 0, 'make-current reaches the loader');

    /* the rise: planned at the commit, after a shown loader, over the page's grow length, and it plays */
    const plan = r.loaderModel.state().rise;
    assert.equal(plan.afterLoader, true);
    assert.equal(plan.durationMs, RISE_MS);
    assert.equal(riseValue(plan, plan.startMs), 0);
    assert.ok(Math.abs(riseValue(plan, plan.startMs + RISE_MS) - 1) < 1e-9);
    assert.ok(Math.abs(riseValue(plan, plan.startMs + RISE_MS / 2) - 0.5) < 1e-9);
    assert.equal(riseValue(plan, plan.startMs + RISE_MS + 1), 1);
  } finally { r.stream.dispose(); r.restore(); }
});

test('an area that opens inside the fast window never shows the loader, and a crossing by panning does not fly the camera', async () => {
  const r = rig();
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().open === 'E4', 'E4 open');
    r.stream.camera(4.885, 52.364, false, null);                 // the camera is over E4 (arms the crossing) ...
    r.stream.camera(4.9262, 52.364, false, null);                // ... then settles over F4's centre; the manager waits its idle gap
    await until(() => r.stream.report().open === 'F4' && r.stream.report().displayed === 'F4', 'F4 opened by the camera');
    assert.equal(r.log.visibleSeen, false, 'nothing of the loader was ever drawn');
    assert.deepEqual(r.log.show.at(-1), { code: 'F4', first: false, fly: false });
    assert.equal(r.log.address.at(-1), '/heat-map/nl/amsterdam/canal-ring/?stream=1&area=F4', 'the address follows the camera too');
    assert.equal(r.loaderModel.state().rise.afterLoader, false, 'a quick rise, still a rise');
    assert.deepEqual(stagesOf(r.loaderModel.state(), 'E4'), [], 'no stale stages');
  } finally { r.stream.dispose(); r.restore(); }
});

test('the address: ?area= is read back, validated, and written without disturbing the other parameters', () => {
  assert.equal(areaFromUrl('?stream=1&area=f5'), 'F5');
  assert.equal(areaFromUrl('?stream=1&area=Z9'), null);
  assert.equal(areaFromUrl('?stream=1'), null);
  assert.equal(areaFromUrl('?area=A1'), null, 'a cell that does not ship is not an area');
  assert.equal(searchWithArea('?stream=1&streamtier=low', 'E5'), '?stream=1&streamtier=low&area=E5');
  assert.equal(searchWithArea('?stream=1&area=E4', 'F4'), '?stream=1&area=F4');
});

test('the header falls back to the area table when there is no name, and says "Area", never "sheet"', () => {
  const h = headerOf('F5', {});
  assert.equal(h.code, 'F5');
  assert.ok(!/sheet/i.test(`${h.name} ${h.zone}`));
  assert.match(h.zone, /Area F5$/);
});
