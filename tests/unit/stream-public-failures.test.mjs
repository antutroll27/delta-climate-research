import assert from 'node:assert/strict';
import test from 'node:test';

import { createCityStream } from '../../src/scripts/climate-engine/streaming-host/city-stream.ts';

/* PUBLIC AUDIT B1 and S3, through the real manager, executor and controller; only the network, the worker and the page are faked.
   B1: the Worker/R2 cannot be reached. Canal Ring (E4) is same-origin and draws; its halo needs its neighbours' files, which fail. The controller must NOT raise
   a failure for E4. S3 (R6): two tier demotions in quick succession rebuild the open mesh twice; the slower, higher-tier rebuild must not commit last. */

const N = 384 * 384;
const layers = () => ({ albedo: new Float32Array(N), veg: new Float32Array(N), built: new Float32Array(N), water: new Float32Array(N) });
const wait = (ms = 0) => new Promise((r) => setTimeout(r, ms));
async function until(cond, label, ms = 8000) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await wait(5); }
}

function rig({ workerDown = false, meshGate = null } = {}) {
  const log = { show: [], failures: [], warn: [], solves: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (workerDown && /\/ams-[a-z0-9]+(-[a-z]+)?\.(json|png)$/.test(u)) throw new TypeError('Failed to fetch');        // R2 through the Worker: every area but Canal Ring
    const body = u.endsWith('-roads.json') ? { ways: [] } : u.endsWith('-water.json') ? { polys: [] } : /-(terrain|trees)\.json$/.test(u) ? {} : { b: [[10, 0, 0, 5, 0, 5, 5, 0, 5]], count: 1, sizeM: 2800 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const state = { tier: 'full' };
  const worker = {
    async prepare() { return { base: layers(), spatial: {}, buildings: 1, ms: 0 }; },
    async mesh(_c, _t, tier) { if (meshGate) await meshGate(tier); return { mesh: { kind: 'packed', tier, vertexCount: 0 }, ao: null, ms: 0 }; },
    async massing() { return { mesh: { kind: 'massing', position: new Float32Array(0), normal: new Int8Array(0), index: new Uint32Array(0), vertexCount: 0, buildings: 0 }, ms: 0 }; },
    forget() {}, dispose() {},
  };
  const hooks = {
    tier: () => state.tier, network: () => 'fast', relief: () => ({ setNeighbours() {}, setSeamFade() {} }),
    registeredSurface: () => Promise.resolve({ means: { fvc: 0.2, albedo: 0.2 }, surface: null }),
    installBundle() {}, dropBundle() {},
    async showSheet(code, prepared, ao, first, afterCommit, fly = false, rebuild = false) { log.show.push({ code, rebuild, tier: prepared?.tier }); afterCommit(); },
    setHaloSupply(next) { log.solves.push(next); }, resolve() {}, loader() {}, failure: (sheet, why) => log.failures.push(`${sheet}: ${why}`), warn: (m) => log.warn.push(m),
    command() {}, stage() {}, facts() {}, dispatched() {},
  };
  const stream = createCityStream(hooks, worker);
  return { stream, log, state, stop: () => { stream.dispose(); globalThis.fetch = realFetch; } };
}

test('B1: with the Worker unreachable, Canal Ring opens, solves on the edge rule, and NEVER raises a failure for itself (through every retry)', async () => {
  const r = rig({ workerDown: true });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed with the Worker down');
    await wait(11_500);                                            // past the backoff schedule (2 s + 8 s): the halo has been tried, and given up on, for good
    assert.deepEqual(r.log.failures, [], 'no plate over a Canal Ring that is drawn');
    assert.equal(r.stream.report().displayed, 'E4');
    assert.equal(r.log.show.filter((s) => s.code === 'E4').length, 1, 'E4 was opened once, not reverted or reopened');
  } finally { r.stop(); }
});

test('B1: with the Worker unreachable, PICKING another area fails honestly for THAT area and leaves Canal Ring on screen', async () => {
  const r = rig({ workerDown: true });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
    r.stream.select('F4');
    await until(() => r.log.failures.length > 0, 'F4 to be reported as failed', 20_000);
    assert.ok(r.log.failures.every((f) => f.startsWith('F4:')), `only F4 fails: ${r.log.failures.join(' | ')}`);
    assert.equal(r.stream.report().displayed, 'E4', 'Canal Ring stays on screen');
  } finally { r.stop(); }
});

test('S3 (R6): two demotions in quick succession - the slower, higher-tier rebuild is dropped, so the lower tier is what ends up on screen', async () => {
  const releases = {};
  const r = rig({ meshGate: (tier) => (tier === 'balanced' ? new Promise((res) => { releases.balanced = res; }) : undefined) });
  try {
    r.stream.start('E4');
    await until(() => r.stream.report().displayed === 'E4', 'E4 displayed');
    await wait(100);
    r.state.tier = 'balanced'; r.stream.tierChanged('balanced');       // its mesh build is held
    await until(() => releases.balanced !== undefined, 'the balanced rebuild to start');
    r.state.tier = 'low'; r.stream.tierChanged('low');                  // a second demotion: its build is instant
    await until(() => r.log.show.some((s) => s.rebuild && s.tier === 'low'), 'the low rebuild to commit');
    releases.balanced();                                                // the slower, higher-tier build lands last
    await wait(200);
    const rebuilds = r.log.show.filter((s) => s.rebuild).map((s) => s.tier);
    assert.deepEqual(rebuilds, ['low'], 'the balanced mesh never committed over the low one');
  } finally { r.stop(); }
});
