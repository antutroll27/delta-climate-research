import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createStaticHost, createWorkerHost,
} from '../../src/scripts/climate-engine/sim-host.ts';
import { CANONICAL_GRID_N, CANONICAL_GRID_VERSION, DEFAULT_PARAMS } from '../../src/scripts/climate-engine/types.ts';

/* The sim host is the only thing standing between a wedged worker and a page
   that looks alive while showing a frozen field. Every guard below was written
   by inspection and defended by nothing until this file existed.

   createGpuHost is absent on purpose: it constructs a WebGl2HeatSim in its
   constructor, so it cannot exist without a real WebGL2 context. Its context-loss
   latch is covered by the e2e run, not here. */

const CELLS = CANONICAL_GRID_N * CANONICAL_GRID_N;

const request = (generation = 1, over = {}) => ({
  generation,
  grid: { n: CANONICAL_GRID_N, cellMeters: 7.29 },
  layers: {
    albedo: new Float32Array(CELLS).fill(0.2),
    veg: new Float32Array(CELLS).fill(0.1),
    built: new Float32Array(CELLS).fill(0.6),
    water: new Float32Array(CELLS),
  },
  params: { ...DEFAULT_PARAMS },
  settleSteps: 0,
  thresholdC: 35,
  ...over,
});

const snapshotFor = (requestId, generation) => ({
  type: 'snapshot',
  requestId,
  snapshot: {
    generation,
    backend: 'ts-worker',
    field: new Float32Array(CELLS).fill(30),
    stats: { meanC: 30, peakC: 30, fracAbove: 0, thresholdC: 35 },
    gridVersion: CANONICAL_GRID_VERSION,
  },
});

/** A worker that records what it was sent and lets the test decide when to answer. */
function fakeWorker() {
  const listeners = new Map();
  const worker = {
    posted: [],
    terminated: false,
    postMessage(message) { worker.posted.push(message); },
    terminate() { worker.terminated = true; },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    /** Deliver a message the way a real worker would. */
    emit(type, event) { for (const fn of [...(listeners.get(type) ?? [])]) fn(event); },
    reply(response) { worker.emit('message', { data: response }); },
    listenerCount(type) { return listeners.get(type)?.size ?? 0; },
    lastOf(type) { return [...worker.posted].reverse().find((m) => m.type === type); },
    countOf(type) { return worker.posted.filter((m) => m.type === type).length; },
  };
  return worker;
}

/** Host plus its worker, always disposed by the test that made it. */
function hosted() {
  const worker = fakeWorker();
  return { worker, host: createWorkerHost(() => worker) };
}

/* ————— the worker protocol ————— */

test('reset posts the request and resolves with the worker snapshot', async () => {
  const { worker, host } = hosted();
  const pending = host.reset(request(4));
  const sent = worker.lastOf('reset');
  assert.ok(sent, 'reset must reach the worker');
  assert.equal(sent.request.generation, 4);
  assert.equal(sent.request.grid.n, CANONICAL_GRID_N, 'the worker must be told the grid it is solving on');
  assert.equal(sent.request.layers.built.length, CELLS);

  worker.reply(snapshotFor(sent.requestId, 4));
  const snapshot = await pending;
  assert.equal(snapshot.generation, 4);
  assert.equal(snapshot.backend, 'ts-worker');
  host.dispose();
});

test('reset refuses a non-canonical grid before anything reaches the worker', async () => {
  const { worker, host } = hosted();
  await assert.rejects(
    () => host.reset(request(1, { grid: { n: 64, cellMeters: 7.29 } })),
    /canonical grid/,
  );
  assert.equal(worker.posted.length, 0, 'an invalid request must never be posted');
  host.dispose();
});

test('reset rejects rather than returning a superseded generation', async () => {
  const { worker, host } = hosted();
  const first = host.reset(request(1));
  const firstId = worker.lastOf('reset').requestId;
  host.reset(request(2)).catch(() => {});       // generation moves on before the answer lands
  worker.reply(snapshotFor(firstId, 1));
  await assert.rejects(() => first, /superseded/);
  host.dispose();
});

test('a snapshot for a generation the host no longer holds resolves null, it does not reject', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 1));
  await reset;

  const advance = host.advance(1, 8);
  const advanceId = worker.lastOf('advance').requestId;
  /* Not awaited: reset() latches the new generation synchronously, and this
     fake worker is never going to answer it. */
  host.reset(request(9)).catch(() => {});       // active generation moves to 9
  worker.reply(snapshotFor(advanceId, 1));      // the old advance finally answers
  assert.equal(await advance, null, 'a stale advance is skipped, never surfaced as an error');
  host.dispose();
});

test('an unknown requestId is ignored', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  const id = worker.lastOf('reset').requestId;
  assert.doesNotThrow(() => worker.reply(snapshotFor(id + 500, 1)));
  worker.reply(snapshotFor(id, 1));
  assert.equal((await reset).generation, 1);
  host.dispose();
});

/* ————— the generation guard and advance coalescing ————— */

test('advance refuses a generation the host does not hold, and posts nothing', async () => {
  const { worker, host } = hosted();
  assert.equal(await host.advance(1, 8), null, 'no reset yet, so there is nothing to advance');
  assert.equal(worker.countOf('advance'), 0);

  const reset = host.reset(request(3));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 3));
  await reset;

  assert.equal(await host.advance(2, 8), null, 'a stale generation must not reach the solver');
  assert.equal(worker.countOf('advance'), 0);
  host.dispose();
});

test('concurrent advances coalesce into one worker call', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 1));
  await reset;

  const a = host.advance(1, 8);
  const b = host.advance(1, 8);
  assert.equal(worker.countOf('advance'), 1, 'a second advance must ride the one in flight');
  assert.equal(a, b, 'both callers share the same promise');

  const advance = worker.lastOf('advance');
  assert.equal(advance.generation, 1);
  assert.equal(advance.steps, 8);
  assert.equal(advance.thresholdC, 35, 'the threshold rides along so stats stay comparable');

  worker.reply(snapshotFor(advance.requestId, 1));
  assert.equal((await a).generation, 1);
  assert.equal((await b).generation, 1);
  host.dispose();
});

test('the coalescing latch clears once the advance settles', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 1));
  await reset;

  const first = host.advance(1, 8);
  worker.reply(snapshotFor(worker.lastOf('advance').requestId, 1));
  await first;

  host.advance(1, 8).catch(() => {});           // reaching the worker is the assertion; the answer is not
  assert.equal(worker.countOf('advance'), 2, 'a settled advance must not wedge the next one');
  host.dispose();
});

test('the latch clears after a REJECTED advance too', async () => {
  /* The regression this pins: if `advancing` survived a failure, every later
     advance would return the same dead promise and the field would freeze
     silently for the rest of the session. */
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 1));
  await reset;

  const failing = host.advance(1, 8);
  worker.reply({ type: 'failure', requestId: worker.lastOf('advance').requestId, generation: 1, message: 'solver blew up' });
  await assert.rejects(() => failing, /solver blew up/);

  host.advance(1, 8).catch(() => {});
  assert.equal(worker.countOf('advance'), 2, 'a failed advance must not wedge the session');
  host.dispose();
});

/* ————— failure paths ————— */

test('a failure response rejects with the worker own message', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply({ type: 'failure', requestId: worker.lastOf('reset').requestId, generation: 1, message: 'CPU simulation could not complete.' });
  await assert.rejects(() => reset, /could not complete/);
  host.dispose();
});

test('a worker error rejects every call in flight', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 1));
  await reset;

  const advance = host.advance(1, 8);
  const second = host.reset(request(2));
  worker.emit('error', {});                     // the handler ignores the event, so its shape is irrelevant
  await assert.rejects(() => advance, /worker unavailable/);
  await assert.rejects(() => second, /worker unavailable/);
  host.dispose();
});

/* ————— disposal ————— */

test('dispose tells the worker, unhooks both listeners and terminates', async () => {
  const { worker, host } = hosted();
  assert.equal(worker.listenerCount('message'), 1);
  assert.equal(worker.listenerCount('error'), 1);

  const orphan = host.reset(request(1));
  host.dispose();

  assert.ok(worker.lastOf('dispose'), 'the worker must be told to free its solver');
  assert.equal(worker.terminated, true);
  assert.equal(worker.listenerCount('message'), 0, 'a terminated worker must not keep the host alive');
  assert.equal(worker.listenerCount('error'), 0);
  await assert.rejects(() => orphan, /disposed/, 'a call in flight at dispose must settle, not hang');
});

test('dispose is idempotent', async () => {
  const { worker, host } = hosted();
  host.dispose();
  host.dispose();
  assert.equal(worker.countOf('dispose'), 1);
});

test('a disposed host rejects reset and quietly refuses advance', async () => {
  const { worker, host } = hosted();
  const reset = host.reset(request(1));
  worker.reply(snapshotFor(worker.lastOf('reset').requestId, 1));
  await reset;
  const before = worker.posted.length;

  host.dispose();
  await assert.rejects(() => host.reset(request(2)), /disposed/);
  assert.equal(await host.advance(1, 8), null, 'advance after dispose is a no-op, not a throw');
  assert.equal(worker.countOf('advance'), 0);
  assert.equal(worker.posted.length, before + 1, 'only the dispose message may follow');
});

/* ————— the last rung of the ladder ————— */

test('the static host settles a real field and reports ts-main', async () => {
  const host = createStaticHost();
  const snapshot = await host.reset(request(1, { settleSteps: 48 }));
  assert.equal(snapshot.backend, 'ts-main');
  assert.equal(snapshot.generation, 1);
  assert.equal(snapshot.gridVersion, CANONICAL_GRID_VERSION);
  assert.equal(snapshot.field.length, CELLS);
  assert.ok(Number.isFinite(snapshot.stats.meanC), 'a settled field must produce finite stats');
  assert.equal(snapshot.stats.thresholdC, 35);
  host.dispose();
});

test('the static host never advances — it is the frozen fallback', async () => {
  const host = createStaticHost();
  await host.reset(request(1));
  assert.equal(await host.advance(1, 8), null);
  host.dispose();
});

test('a static reset superseded mid-settle gives up instead of finishing', async () => {
  const host = createStaticHost();
  const abandoned = host.reset(request(1, { settleSteps: 240 }));
  const winner = host.reset(request(2, { settleSteps: 24 }));
  await assert.rejects(() => abandoned, /superseded/, 'the old settle must not overwrite the new one');
  assert.equal((await winner).generation, 2);
  host.dispose();
});

test('a disposed static host refuses to reset', async () => {
  const host = createStaticHost();
  host.dispose();
  await assert.rejects(() => host.reset(request(1)), /disposed/);
});
