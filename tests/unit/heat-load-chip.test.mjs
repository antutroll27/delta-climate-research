import assert from 'node:assert/strict';
import test from 'node:test';
import { createLoadChip, MIN_VISIBLE_MS, SHOW_AFTER_MS } from '../../src/scripts/climate-engine/load-chip.ts';

function rig() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  const classes = new Set();
  const el = { textContent: '', classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
  return { chip: createLoadChip(el, clock), el, visible: () => classes.has('on'), advance };
}

test('a switch that finishes before the threshold never shows the chip', () => {
  const r = rig();
  r.chip.start('Loading MG Road…');
  r.advance(299);
  /* Checked HERE, not only at the end: a chip shown at 0 ms is hidden again by
     2,299 ms, so an end-only assertion passes with SHOW_AFTER_MS = 0. */
  assert.equal(r.visible(), false, 'shown before the threshold');
  r.chip.done();
  r.advance(2000);
  assert.equal(r.visible(), false);
});

test('a slow load shows the chip once the threshold passes', () => {
  const r = rig();
  r.chip.start('Loading MG Road…');
  r.advance(SHOW_AFTER_MS - 1);
  assert.equal(r.visible(), false);
  r.advance(1);
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'Loading MG Road…');
});

test('a load finishing just after the threshold keeps the chip up for the minimum', () => {
  const r = rig();
  r.chip.start('Loading');
  r.advance(SHOW_AFTER_MS + 10);
  r.chip.done();
  assert.equal(r.visible(), true, 'must not vanish the instant it appeared');
  r.advance(MIN_VISIBLE_MS - 11);
  assert.equal(r.visible(), true);
  r.advance(1);
  assert.equal(r.visible(), false);
});

test('a failure shows at once, with no threshold', () => {
  const r = rig();
  r.chip.fail('MG Road could not load.');
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'MG Road could not load.');
});

test('a failure after a pending start cancels the delayed show and stays up', () => {
  const r = rig();
  r.chip.start('Loading');
  r.advance(100);
  r.chip.fail('could not load');
  r.advance(5000);
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'could not load');
});

test('a slow load, visible past the minimum, hides the moment it finishes', () => {
  /* The common case on Slow 4G, and the one no other test reaches: done() with the
     minimum already served. A chip that never hides here passed the other five. */
  const r = rig();
  r.chip.start('Loading');
  r.advance(2000);
  assert.equal(r.visible(), true);
  r.chip.done();
  assert.equal(r.visible(), false, 'no extra hold once the minimum has passed');
});

test('a new load while the chip is up retitles it at once and keeps it up', () => {
  const r = rig();
  r.chip.start('Loading MG Road…');
  r.advance(SHOW_AFTER_MS);
  r.chip.start('Loading Whitefield…');
  assert.equal(r.visible(), true);
  assert.equal(r.el.textContent, 'Loading Whitefield…', 'the old ward named for another 400 ms');
});
