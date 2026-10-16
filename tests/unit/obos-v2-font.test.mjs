// tests/unit/obos-v2-font.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

test('three digit subsets ship, each small, under an Apache-2.0 licence file (spec §2.6)', () => {
  for (const w of [300, 400, 500]) {
    const f = `public/fonts/obos-num-${w}.woff2`;
    const size = statSync(f).size;
    assert.ok(size > 500 && size <= 8192, `${f} is ${size} bytes`);
    assert.equal(readFileSync(f).subarray(0, 4).toString('latin1'), 'wOF2');
  }
  const lic = readFileSync('public/fonts/OBOS-NUM-LICENSE.txt', 'utf8');
  assert.match(lic, /Apache License/);
  assert.match(lic, /Version 2\.0/);
});

test('the stack keeps Helvetica Neue first and the subset second; unicode-range is digits only', () => {
  const css = readFileSync('src/styles/obos-v2/tokens.css', 'utf8');
  assert.match(css, /--sans: "Helvetica Neue", "OBOS Num", Helvetica, Arial, Roboto, sans-serif;/);
  const ranges = [...css.matchAll(/unicode-range: ([^;]+);/g)].map((m) => m[1]);
  assert.equal(ranges.length, 3);
  for (const r of ranges) assert.equal(r, 'U+0030-0039, U+002B-002E, U+0025, U+00B0, U+00B1, U+2212, U+2013, U+003A, U+002F');
  assert.ok(!/Helvetica[^"]*\.woff/.test(css), 'never embed Helvetica');
});
