import assert from 'node:assert/strict';
import test from 'node:test';

import { ADMITTED_GRIDS, isAdmittedGrid, gridVersion } from '../../src/scripts/climate-engine/types.ts';

/* THE PAIR IS THE CONTRACT, NOT THE GRID SIZE. A grid without its matching ward
   size silently changes what a cell means while every array length still checks
   out — 384 cells over a 1400 m ward is 3.65 m cells, which no calibration in
   this repo describes. Both halves must agree or the request is refused. */

test('the two real city configurations are admitted', () => {
  assert.ok(isAdmittedGrid({ n: 192, cellMeters: 1400 / 192 }, 1400), 'Kolkata: 192 over 1400 m');
  assert.ok(isAdmittedGrid({ n: 384, cellMeters: 2800 / 384 }, 2800), 'Bengaluru: 384 over 2800 m');
});

test('a grid paired with the WRONG ward size is refused', () => {
  assert.equal(isAdmittedGrid({ n: 384, cellMeters: 1400 / 384 }, 1400), false,
    '384 cells over a 1400 m ward must not be admitted');
  assert.equal(isAdmittedGrid({ n: 192, cellMeters: 2800 / 192 }, 2800), false,
    '192 cells over a 2800 m ward must not be admitted');
});

/* THIS TEST EXISTS BECAUSE THE ONES ABOVE CANNOT FAIL ALONE. Delete the
   `grid.n !== g.n` comparison from isAdmittedGrid and every case above still
   passes: each builds cellMeters from its own wrong n (1400/384 = 3.65 m), so
   the coherence check refuses them without the grid ever being compared.

   The case that needs the comparison is the one where the CELL SIZE LOOKS
   RIGHT — 7.29 m copied from Kolkata onto a 384-cell grid. Coherence sees
   nothing wrong; only the pair does. That is the silent bug this contract is
   for, so it gets the test that kills the mutant. */
test('a grid carrying the RIGHT cell size on the WRONG n is refused', () => {
  assert.equal(isAdmittedGrid({ n: 384, cellMeters: 1400 / 192 }, 1400), false,
    '384 cells at Kolkata\'s 7.29 m cell size is not a 1400 m ward');
});

test('cellMeters must actually equal sizeM / n', () => {
  assert.equal(isAdmittedGrid({ n: 192, cellMeters: 99 }, 1400), false,
    'a cell size that disagrees with sizeM/n is incoherent even on an admitted pair');
});

test('every admitted pair yields the same cell size, so cities are comparable', () => {
  const sizes = ADMITTED_GRIDS.map((g) => g.sizeM / g.n);
  for (const s of sizes) assert.ok(Math.abs(s - sizes[0]) < 1e-9,
    `admitted pairs must share one cell size; got ${sizes.join(', ')}`);
});

/* `gridFor` FINDS ON `sizeM`, which makes it the lookup key: a duplicate ward
   size is not a second admitted option, it is an unreachable row, because `find`
   returns the first match and the later one can never be selected. The comment
   on ADMITTED_GRIDS states that uniqueness; this is what keeps it true. */
test('no two admitted pairs share a ward size, because sizeM is the lookup key', () => {
  const sizes = ADMITTED_GRIDS.map((g) => g.sizeM);
  assert.equal(new Set(sizes).size, sizes.length,
    `ADMITTED_GRIDS must not repeat a ward size; got ${sizes.join(', ')}`);
});

test('the grid version names the pair, not just the grid', () => {
  assert.equal(gridVersion(1400), 'hm-grid-192-v1', 'Kolkata keeps its existing version string');
  assert.equal(gridVersion(2800), 'hm-grid-384-2800-v1',
    'a version added now names BOTH halves: 384 alone stops identifying a pair the moment a coarse tier exists');
  assert.throws(() => gridVersion(999), /admitted/i);
});
