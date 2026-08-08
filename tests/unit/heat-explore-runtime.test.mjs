import test from 'node:test';
import assert from 'node:assert/strict';

const { exploreRuntimeBudget, nextFrameDelayMs } = await import('../../src/scripts/climate-engine/explore/runtime-budget.ts');
const { ExploreFrameScheduler } = await import('../../src/scripts/climate-engine/explore/frame-scheduler.ts');

test('Explore runtime suspends simulation while hidden or interacting', () => {
  assert.equal(exploreRuntimeBudget({ visible: false, interacting: false, reducedMotion: false, deviceTier: 'full' }).simulate, false);
  assert.equal(exploreRuntimeBudget({ visible: true, interacting: true, reducedMotion: false, deviceTier: 'full' }).simulate, false);
  assert.equal(exploreRuntimeBudget({ visible: true, interacting: false, reducedMotion: true, deviceTier: 'full' }).allowCloudMotion, false);
});

/* Suspension follows real cost, not a uniform "pause everything" reflex. The sim
   is a 192² grid over hundreds of explicit steps and must not run mid-gesture;
   the cloud deck is transform/opacity writes on 26 sprites, and gating it on
   `interacting` froze the drift on pointerdown and snapped it back on release —
   a visible hitch at both ends of every drag. */
test('ambient cloud drift rides through a gesture; the solver does not', () => {
  const dragging = { visible: true, interacting: true, reducedMotion: false, deviceTier: 'full' };
  assert.equal(exploreRuntimeBudget(dragging).allowCloudMotion, true);
  assert.equal(exploreRuntimeBudget(dragging).simulate, false);
  // The genuine suspensions are unchanged.
  assert.equal(exploreRuntimeBudget({ ...dragging, visible: false }).allowCloudMotion, false);
  assert.equal(exploreRuntimeBudget({ ...dragging, reducedMotion: true }).allowCloudMotion, false);
  assert.equal(exploreRuntimeBudget({ ...dragging, deviceTier: 'low' }).allowCloudMotion, false);
});

/* An animating frame must ask for the NEXT display frame, which is a delay of 0.
   Any non-zero delay is serviced by a timer, and a timer can only be picked up on
   a subsequent vsync — so it quantises UP to whole refresh intervals. At 144 Hz
   (6.94 ms) a nominal "60 fps" 16 ms waits three refreshes: 20.8 ms, i.e. 48 fps
   instead of 143. At 60 Hz both values land on the same 16.7 ms vsync, so the
   defect is completely invisible on the display most people test on. */
test('an animating Explore frame asks for the next display frame, never a delay', () => {
  const animating = { animating: true, cloudMotion: false, simEligible: false, msUntilNextSim: 0 };
  assert.equal(nextFrameDelayMs(animating), 0);
  // Animation outranks every slower cadence rather than averaging with it.
  assert.equal(nextFrameDelayMs({ ...animating, cloudMotion: true, simEligible: true, msUntilNextSim: 720 }), 0);
});

test('Explore frame cadence falls back through ambient, simulation, then idle', () => {
  const base = { animating: false, cloudMotion: false, simEligible: false, msUntilNextSim: 0 };
  assert.equal(nextFrameDelayMs({ ...base, cloudMotion: true }), 50);
  assert.equal(nextFrameDelayMs({ ...base, cloudMotion: true, simEligible: true, msUntilNextSim: 720 }), 50);
  assert.equal(nextFrameDelayMs({ ...base, simEligible: true, msUntilNextSim: 720 }), 720);
  // An overdue simulation asks for the next frame, never a negative delay.
  assert.equal(nextFrameDelayMs({ ...base, simEligible: true, msUntilNextSim: -400 }), 0);
  // Nothing to do: the loop stops instead of spinning at some floor rate.
  assert.equal(nextFrameDelayMs(base), null);
});

test('Explore frame scheduler coalesces visual reasons into one requested frame', () => {
  let callback;
  let requests = 0;
  const seen = [];
  const scheduler = new ExploreFrameScheduler((time, reasons) => seen.push([time, [...reasons].sort()]), {
    requestFrame(fn) { requests++; callback = fn; return 17; },
    cancelFrame() {},
  });
  scheduler.request('drag');
  scheduler.request('grow');
  assert.equal(requests, 1);
  callback(50);
  assert.deepEqual(seen, [[50, ['drag', 'grow']]]);
  scheduler.dispose();
});

test('Explore frame scheduler keeps the earliest requested deadline', () => {
  let now = 100;
  let timerId = 0;
  let frameCallback;
  const timers = new Map();
  const cleared = [];
  const frames = [];
  const scheduler = new ExploreFrameScheduler((time, reasons) => frames.push([time, [...reasons]]), {
    now: () => now,
    requestFrame(fn) { frameCallback = fn; return 30; },
    cancelFrame() {},
    setTimer(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimer(id) { cleared.push(id); timers.delete(id); },
  });

  scheduler.requestAfter('render', 720);
  scheduler.requestAfter('orbit', 16);
  scheduler.requestAfter('render', 1500);
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 16);
  assert.deepEqual(cleared, [1]);

  now = 116;
  [...timers.values()][0].fn();
  frameCallback(116);
  assert.deepEqual(frames, [[116, ['orbit']]]);
  scheduler.dispose();
});
