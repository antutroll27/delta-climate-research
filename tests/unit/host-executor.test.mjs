import assert from 'node:assert/strict';
import test from 'node:test';

import { createExecutor } from '../../src/scripts/climate-engine/streaming/host-executor.ts';
import { createSheetManager } from '../../src/scripts/climate-engine/streaming/sheet-manager.ts';

/* The executor is the manager's shell: it must start every load, cancel the right ones, drop the replies of cancelled
   requests, run the timer nextWakeMs asks for, and carry a transition's commands out in order before the next event. */

class Fake {
  constructor(tier = 'full') {
    this.autoOpen = true; this.t = 0; this.log = []; this.loads = new Map(); this.timers = []; this.errors = [];
    this.manager = createSheetManager(tier, 'fast');
    const rec = (name) => (c) => { this.log.push(name + ':' + (c.sheet ?? '') + (c.level ? '/' + c.level : '') + (c.phase ? '/' + c.phase : '')); };
    this.ports = {
      now: () => this.t,
      schedule: (ms, fn) => { const timer = { at: this.t + ms, fn, live: true }; this.timers.push(timer); return () => { timer.live = false; }; },
      load: (job) => new Promise((resolve, reject) => {
        this.log.push(`load:${job.sheet}/${job.level}/${job.priority}`);
        this.loads.set(job.requestId, { job, resolve, reject });
        job.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
      reprioritise: rec('reprioritise'), evict: rec('evict'),
      makeCurrent: (c) => { rec('make-current')(c); if (this.autoOpen) queueMicrotask(() => this.exec.send({ type: 'opened', sheet: c.sheet })); }, disposeMesh: rec('dispose-mesh'),
      rebuildMesh: rec('rebuild-mesh'), loader: rec('loader'), solve: rec('solve'), failure: rec('failure'), refuse: rec('refuse'),
      onError: (e) => this.errors.push(e),
    };
    this.exec = createExecutor(this.manager, this.ports);
  }
  async settle() { for (let i = 0; i < 5; i++) await Promise.resolve(); }
  find(sheet, level) { return [...this.loads.values()].find((l) => l.job.sheet === sheet && l.job.level === level && !l.job.signal.aborted); }
  async finish(sheet, level) { const l = this.find(sheet, level); assert.ok(l, `no ${sheet}/${level}`); this.loads.delete(l.job.requestId); l.resolve(); await this.settle(); }
  async fail(sheet, level, msg = 'boom') { const l = this.find(sheet, level); assert.ok(l, `no ${sheet}/${level}`); this.loads.delete(l.job.requestId); l.reject(new Error(msg)); await this.settle(); }
  async advance(ms) {
    const until = this.t + ms;
    for (;;) {
      const due = this.timers.filter((x) => x.live && x.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false; this.t = Math.max(this.t, due.at); due.fn(); await this.settle();
    }
    this.t = until;
  }
}

test('start loads the sheet and its halo; finishing both makes it current and solves', async () => {
  const f = new Fake();
  f.exec.send({ type: 'start', sheet: 'E4' });
  assert.deepEqual(f.log.slice(0, 2), ['load:E4/lod0/high', 'load:E4/halo/high']);
  await f.finish('E4', 'lod0');
  assert.ok(f.log.includes('make-current:E4'));
  await f.finish('E4', 'halo');
  assert.ok(f.log.some((l) => l.startsWith('solve:E4')));
  assert.ok(f.log.some((l) => l.startsWith('load:') && l.endsWith('/lod1/low')), 'the ring starts loading once lod0 is ready');
  assert.deepEqual(f.errors, []);
});

test('a cancelled request is aborted and its late reply is ignored', async () => {
  const f = new Fake();
  f.exec.send({ type: 'start', sheet: 'E4' });
  const stale = f.find('E4', 'lod0');
  f.exec.send({ type: 'select', sheet: 'F4' });
  assert.ok(stale.job.signal.aborted, 'E4/lod0 was cancelled when the user chose F4');
  stale.resolve();                       // a late success must not mark E4 ready
  await f.settle();
  assert.ok(!f.log.includes('make-current:E4'));
  assert.equal(f.exec.inFlight(), 2);    // F4 lod0 + halo
});

test('a failed load retries by itself after the backoff and the timer is the manager\'s nextWakeMs', async () => {
  const f = new Fake();
  f.exec.send({ type: 'start', sheet: 'E4' });
  await f.fail('E4', 'lod0');
  assert.equal(f.find('E4', 'lod0'), undefined, 'not retried at once');
  await f.advance(2_000);
  assert.ok(f.find('E4', 'lod0'), 'retried after 2 s');
});

test('the loader phases are driven by the timer alone', async () => {
  const f = new Fake();
  f.exec.send({ type: 'start', sheet: 'E4' });
  await f.advance(500);
  assert.ok(f.log.includes('loader:E4/rise'));
  await f.advance(800);
  assert.ok(f.log.includes('loader:E4/plate'));
  await f.finish('E4', 'lod0');
  assert.ok(f.log.includes('loader:E4/end'));
});

test('a synchronous port that re-enters send does not interleave the batch', async () => {
  const f = new Fake();
  let nested = false;
  const original = f.ports.makeCurrent;
  f.ports.makeCurrent = (c) => {
    original(c);
    if (!nested) { nested = true; f.exec.send({ type: 'handover-done' }); f.log.push('after-nested-send'); }
  };
  f.exec.send({ type: 'start', sheet: 'E4' });
  await f.finish('E4', 'lod0');
  const i = f.log.indexOf('make-current:E4');
  assert.equal(f.log[i + 1], 'after-nested-send', 'the nested event waits for the batch to finish');
});

test('a throwing port is reported and the rest of the batch still runs; a make-current that throws is an open-failed', async () => {
  const f = new Fake();
  f.ports.makeCurrent = () => { throw new Error('gl'); };
  f.exec.send({ type: 'start', sheet: 'E4' });
  await f.finish('E4', 'lod0');
  await f.settle();
  assert.equal(f.errors.length, 1);
  assert.ok(f.log.some((l) => l.startsWith('failure:E4')), 'reported as a failure, the plate does not stay up');
  assert.ok(!f.log.some((l) => l.startsWith('solve:E4')), 'and nothing is solved for a sheet that never opened');
});

test('a load that throws synchronously becomes load-failed', async () => {
  const f = new Fake();
  let first = true;
  const real = f.ports.load;
  f.ports.load = (job) => { if (first) { first = false; throw new Error('sync'); } return real(job); };
  f.exec.send({ type: 'start', sheet: 'E4' });
  await f.settle();
  assert.equal(f.errors.length, 0);
  assert.ok(f.exec.inFlight() >= 1);
});

test('dispose cancels everything and stops the clock', async () => {
  const f = new Fake();
  f.exec.send({ type: 'start', sheet: 'E4' });
  const l = f.find('E4', 'lod0');
  f.exec.dispose();
  assert.ok(l.job.signal.aborted);
  const before = f.log.length;
  await f.advance(5_000);
  assert.equal(f.log.length, before);
  assert.equal(f.exec.inFlight(), 0);
});
