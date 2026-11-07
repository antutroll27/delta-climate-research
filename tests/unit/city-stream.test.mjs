import assert from 'node:assert/strict';
import test from 'node:test';

import { createCityStream } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';

/* The page controller, driven with a fake worker, a fake network and fake hooks: what it asks for, in what order, and what the
   renderer is left holding. No browser, no GL. */

const N = 384 * 384;
const layers = () => ({ albedo: new Float32Array(N), veg: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N) });
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await wait(5); }
}

function rig({ tier = 'full', showDelayMs = 0, failOpen = new Set() } = {}) {
  const calls = { mesh: [], massing: [], prepare: 0, forget: [], disposed: false, show: [], supply: [], neighbours: [], seams: [], resolve: 0, failures: [], timers: 0 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    const body = u.endsWith('-roads.json') ? { ways: [] } : u.endsWith('-water.json') ? { polys: [] } : /-(terrain|trees)\.json$/.test(u) ? {} : { b: [[10, 0, 0, 5, 0, 5, 5, 0, 5]], sizeM: 2800 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const worker = {
    async prepare() { calls.prepare++; return { base: layers(), spatial: {}, buildings: 1, ms: 0 }; },
    async mesh(key, _t, tr) { calls.mesh.push([key, tr]); return { mesh: { kind: tr === 'full' ? 'bevel' : 'packed', vertexCount: 0 }, ao: null, ms: 0 }; },
    async massing(key) { calls.massing.push(key); return { mesh: { kind: 'massing', position: new Float32Array(0), normal: new Int8Array(0), index: new Uint32Array(0), vertexCount: 0, buildings: 0 }, ms: 0 }; },
    forget(key) { calls.forget.push(key); },
    dispose() { calls.disposed = true; },
  };
  const state = { tier, held: new Set() };
  const relief = {
    setNeighbours(list) {
      calls.neighbours.push(list.map((s) => [s.key, s.mesh !== null]));
      const next = new Set();
      for (const s of list) {                                // like the renderer: a held key is only re-offset, a new one needs its mesh
        if (state.held.has(s.key) || s.mesh !== null) next.add(s.key);
      }
      state.held = next;
    },
    setSeamFade(...f) { calls.seams.push(f); },
  };
  const hooks = {
    tier: () => state.tier, network: () => 'fast', relief: () => relief,
    registeredSurface: () => Promise.resolve({ means: { fvc: 0.2, albedo: 0.2 }, surface: null }),
    installBundle: () => undefined, dropBundle: () => undefined,
    async showSheet(code, prepared, ao, first, afterCommit) {
      calls.show.push([code, prepared?.kind ?? null, first]);
      if (showDelayMs) await wait(showDelayMs);
      if (failOpen.has(code)) throw new Error('commit failed');
      afterCommit();
    },
    setHaloSupply: (f) => calls.supply.push(f === null ? null : 'supply'),
    resolve: () => { calls.resolve++; },
    loader: () => undefined, failure: (code) => calls.failures.push(code), warn: () => undefined,
  };
  const stream = createCityStream(hooks, worker);
  return { stream, calls, state, relief, hooks, restore: () => { globalThis.fetch = realFetch; } };
}

test('E4 -> F4 -> E4 sends a mesh for every neighbour that is new to the renderer, so there is never a hole', async () => {
  const r = rig();
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().open === 'E4' && r.stream.report().massing.length === 8, 'E4 and its ring');
    r.stream.select('F4');
    await until(() => r.stream.report().open === 'F4' && r.stream.report().massing.includes('E4'), 'F4 with E4 as a neighbour');
    r.stream.select('E4');
    await until(() => r.stream.report().open === 'E4' && r.stream.report().massing.includes('F4'), 'back on E4 with F4 as a neighbour');
    await wait(50);
    await until(() => [...r.stream.report().massing].sort().join() === [...r.state.held].sort().join(), 'the renderer to hold exactly the resident massing');
    assert.ok(r.calls.neighbours.some((l) => l.some(([k, has]) => k === 'E4' && has)), 'the sheet we left became massing');
    assert.ok(r.calls.neighbours.some((l) => l.some(([k, has]) => k === 'F4' && has)), 'and so did F4 on the way back');
    assert.ok(r.calls.seams.length >= 3);
  } finally { r.stream.dispose(); r.restore(); }
});

test('S2: a context restore asks the worker for a rebuild at the CURRENT tier and sends the grey neighbours again', async () => {
  const r = rig({ tier: 'low' });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().open === 'E4' && r.stream.report().massing.length === 4, 'E4 and its edge ring');
    const meshesBefore = r.calls.mesh.length, massingBefore = r.calls.massing.length, showsBefore = r.calls.show.length;
    r.state.held = new Set();                                // the renderer dropped every neighbour on the restore
    r.stream.contextRestored();
    await until(() => r.calls.show.length > showsBefore && r.calls.massing.length >= massingBefore + 4, 'the rebuild');
    assert.equal(r.calls.mesh.length, meshesBefore + 1);
    assert.deepEqual(r.calls.mesh.at(-1), ['E4', 'low'], 'a worker mesh at the current tier, never the main-thread bevel');
    assert.deepEqual(r.calls.show.at(-1), ['E4', 'packed', false]);
    await until(() => [...r.stream.report().massing].sort().join() === [...r.state.held].sort().join() && r.state.held.size === 4, 'the neighbours back');
  } finally { r.stream.dispose(); r.restore(); }
});

test('S3: the halo supply swaps inside the page\'s commit, not before it; a failed open leaves the old sheet and its supply', async () => {
  const r = rig({ showDelayMs: 40, failOpen: new Set(['F4']) });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().open === 'E4' && r.calls.supply.length >= 1, 'E4 open');
    const supplied = r.calls.supply.length;
    r.stream.select('F4');
    await until(() => r.calls.show.some(([c]) => c === 'F4'), 'the page starts opening F4');
    assert.equal(r.calls.supply.length, supplied, 'no supply change while F4 is still opening');
    await until(() => r.calls.failures.includes('F4'), 'the failure');
    await wait(30);
    const rep = r.stream.report();
    assert.equal(rep.open, 'E4');
    assert.equal(rep.displayed, 'E4', 'the manager agrees with the page');
    assert.equal(rep.current, 'E4');
    assert.equal(r.calls.supply.length, supplied, 'the supply stayed with E4');
  } finally { r.stream.dispose(); r.restore(); }
});

test('dispose terminates the worker, empties the neighbours and leaves nothing running', async () => {
  const r = rig();
  r.stream.start('E4');
  await until(() => r.stream.report().open === 'E4' && r.stream.report().massing.length >= 2, 'E4 and part of the ring');
  r.stream.dispose();
  assert.equal(r.calls.disposed, true);
  assert.deepEqual(r.calls.neighbours.at(-1), [], 'the renderer is told to drop every neighbour');
  const before = JSON.stringify([r.calls.mesh, r.calls.massing, r.calls.show, r.calls.supply, r.calls.neighbours.length, r.calls.resolve]);
  r.stream.camera(4.93, 52.364, false, null);
  r.stream.select('F4');
  await wait(1500);                                         // longer than any retry or idle timer
  assert.equal(JSON.stringify([r.calls.mesh, r.calls.massing, r.calls.show, r.calls.supply, r.calls.neighbours.length, r.calls.resolve]), before);
  r.restore();
});

test('S6: a tier change reaches the manager: a demotion rebuilds the open sheet in the worker at the new tier', async () => {
  const r = rig({ tier: 'full' });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().open === 'E4', 'E4 open');
    assert.equal(r.calls.mesh.at(-1)[1], 'full');
    r.state.tier = 'balanced';
    r.stream.tierChanged('balanced');
    await until(() => r.calls.mesh.length >= 2, 'the rebuild');
    assert.deepEqual(r.calls.mesh.at(-1), ['E4', 'balanced']);
    assert.equal(r.stream.report().tier, 'balanced');
    await until(() => r.calls.show.at(-1)[1] === 'packed', 'the packed mesh shown');
  } finally { r.stream.dispose(); r.restore(); }
});
