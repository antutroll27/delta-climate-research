// tests/unit/obos-v2-greenery-figure.test.mjs — rc3 bug 2: the building card said "Nearest greenery ≈0 m" while the map tag said "≈10 m" (#2342, #5721 in Ballygunge).
// ROOT CAUSE: one distance, two roundings. The card rounded to the nearest 10 m (1.53 m -> 0); the tag rounded the same way and then `|| 10`, lifting a 0 to 10.
// The measured distances are 1.53 m (#2342) and 3.55 m (#5721), so the card was right and the tag overstated by 8.5 m. Both now read ONE function.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walkRoundM } from '../../src/scripts/climate-engine/explore/cooling-surfaces.ts';

const app = readFileSync('src/scripts/climate-engine/heat-map-app.ts', 'utf8');

test('walkRoundM rounds the measured distance to the nearest 10 m (the grid cell is 7.3 m) and never lifts a small one', () => {
  assert.equal(walkRoundM(1.5259932675828267), 0, '#2342, measured');
  assert.equal(walkRoundM(3.552723869023757), 0, '#5721, measured');
  assert.equal(walkRoundM(10.566831094033168), 10, '#3736');
  assert.equal(walkRoundM(164.5862585369476), 160);
  assert.equal(walkRoundM(5), 10, 'half rounds up, as Math.round does');
});

test('the card line, its range line and the map tag (v1 and v2) all take their metres from walkRoundM; no `|| 10` floor survives', () => {
  assert.match(app, /popCoolTag\(walkRoundM\(nearestCool\.distM\)\)/);
  assert.ok(!/distM \/ 10\) \* 10 \|\| 10/.test(app), 'the old tag floor of 10 m is back');
  assert.match(app, /Nearest greenery ≈<b>\$\{walkRoundM\(d\)\} m<\/b>/);
  assert.ok(!/const rnd = \(m: number\) => Math\.round\(m \/ 10\) \* 10;/.test(app), 'a second rounding function is still defined on the card');
});
