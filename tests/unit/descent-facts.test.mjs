import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * The descent facts count up as you scroll, so the displayed value is a function
 * of scroll POSITION — wherever a reader stops is the number they are left
 * looking at. That is only safe if the count finishes before the fact becomes
 * legible.
 *
 * It did not. The count completed at 0.55 of the segment, the same moment the
 * fact hit full opacity, so 54 % of the legible window showed a wrong figure —
 * "$18 Trillion" against a true 32, at 81 % opacity. Reported by several people,
 * and a screenshot taken there captures a claim the site does not make.
 *
 * This asserts the invariant rather than the constant: ANY value that keeps the
 * legible window truthful passes. Tightening the fade or re-timing the count is
 * fine; shipping a legible wrong number is not.
 */
const src = await readFile(
  fileURLToPath(new URL('../../src/scripts/descent-facts.ts', import.meta.url)), 'utf8');

/** The smoothstep the component uses, copied so the test fails on a real change. */
const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Opacity of a fact at `local` position within its segment — sin(pi*local). */
const opacityAt = (local) => Math.sin(Math.PI * local);

/** Fraction of the target displayed at `local`, given the count finishes at k. */
const shownFractionAt = (local, k) => sm(0, k, local);

/** Anything a reader could plausibly read. Below this the fact is a ghost. */
const LEGIBLE = 0.5;

function countDoneAt() {
  const m = src.match(/COUNT_DONE_AT\s*=\s*([0-9.]+)/);
  assert.ok(m, 'COUNT_DONE_AT must exist and be a literal — the invariant below is about its value');
  return parseFloat(m[1]);
}

test('the count is finished before a fact is legible', () => {
  const k = countDoneAt();
  const bad = [];
  for (let i = 0; i <= 2000; i++) {
    const local = i / 2000;
    if (opacityAt(local) <= LEGIBLE) continue;
    const shown = shownFractionAt(local, k);
    // 0.995 not 1: the last sliver of a smoothstep rounds to the target anyway
    if (shown < 0.995) bad.push({ local, opacity: opacityAt(local), shown });
  }
  const worst = bad.reduce((w, b) => (b.shown < w.shown ? b : w), { shown: 1, opacity: 0, local: 0 });
  assert.equal(bad.length, 0,
    `${bad.length} scroll positions show a legible WRONG number. Worst: at local `
    + `${worst.local.toFixed(3)} the fact is ${(worst.opacity * 100).toFixed(0)}% opaque while showing `
    + `${(worst.shown * 100).toFixed(0)}% of its true value. Move COUNT_DONE_AT earlier.`);
});

test('the count still animates — this is a correctness fix, not a deletion', () => {
  const k = countDoneAt();
  assert.ok(k > 0, 'COUNT_DONE_AT must be positive; 0 would snap the number with no count at all');
  // it should still be visibly counting for a meaningful part of the fade-in
  assert.ok(shownFractionAt(k * 0.5, k) < 0.85,
    'the count should still traverse its range rather than jump; halfway through it '
    + 'should be well short of the target');
});

test('the guard would have caught the bug it was written for', () => {
  // The old value, checked against the same invariant.
  const OLD = 0.55;
  let bad = 0;
  for (let i = 0; i <= 2000; i++) {
    const local = i / 2000;
    if (opacityAt(local) > LEGIBLE && shownFractionAt(local, OLD) < 0.995) bad++;
  }
  assert.ok(bad > 0,
    'a test that passes on the buggy value is not testing anything — 0.55 must fail this invariant');
});
