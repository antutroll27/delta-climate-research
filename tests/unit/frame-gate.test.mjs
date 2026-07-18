import assert from 'node:assert/strict';
import test from 'node:test';

import { createFrameGate } from '../../src/utils/frame-gate.ts';

test('permits the first frame and caps a 144 Hz clock near 60 fps', () => {
  const gate = createFrameGate(60);
  let rendered = 0;

  for (let frame = 0; frame <= 144; frame += 1) {
    if (gate.shouldRender(frame * (1000 / 144))) rendered += 1;
  }

  assert.ok(rendered >= 60 && rendered <= 61, `rendered ${rendered} frames`);
});

test('instances keep independent schedules', () => {
  const hero = createFrameGate(60);
  const vortex = createFrameGate(60);

  assert.equal(hero.shouldRender(0), true);
  assert.equal(vortex.shouldRender(0), true);
  assert.equal(hero.shouldRender(8), false);
  assert.equal(vortex.shouldRender(17), true);
});

test('reset permits an immediate frame after resuming', () => {
  const gate = createFrameGate(60);

  assert.equal(gate.shouldRender(100), true);
  assert.equal(gate.shouldRender(105), false);
  gate.reset();
  assert.equal(gate.shouldRender(105), true);
});

test('changes cadence live when a quality tier is downgraded', () => {
  const gate = createFrameGate(60);

  assert.equal(gate.shouldRender(0), true);
  gate.setTargetFps(30);
  assert.equal(gate.shouldRender(8), true);
  assert.equal(gate.shouldRender(20), false);
  assert.equal(gate.shouldRender(41), true);
});

test('recovers from a long suspension without emitting a burst', () => {
  const gate = createFrameGate(60);

  assert.equal(gate.shouldRender(0), true);
  assert.equal(gate.shouldRender(5_000), true);
  assert.equal(gate.shouldRender(5_001), false);
});

test('treats a restarted clock as a fresh cadence', () => {
  const gate = createFrameGate(60);

  assert.equal(gate.shouldRender(100), true);
  assert.equal(gate.shouldRender(50), true);
  assert.equal(gate.shouldRender(51), false);
});

test('rejects non-finite timestamps', () => {
  const gate = createFrameGate(60);

  assert.equal(gate.shouldRender(Number.NaN), false);
  assert.equal(gate.shouldRender(Number.POSITIVE_INFINITY), false);
});

test('rejects invalid target rates', () => {
  assert.throws(() => createFrameGate(0), RangeError);
  assert.throws(() => createFrameGate(Number.NaN), RangeError);
});
