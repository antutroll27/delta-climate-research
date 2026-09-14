import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { asTreesFile } from '../../src/scripts/climate-engine/vegetation-layer.ts';

/**
 * THE SIX SHIPPED TREE FILES PARSE IN THE FORMAT THE BROWSER READS.
 *
 * asTreesFile returns null for a whole file on any malformed record, and a null
 * here is a ward drawn with no trees at all -- silently. So every shipped file is
 * read through the real reader, with its tree count and, for Bengaluru, its
 * species mix pinned. The mixes are the recovered draw (59,184 of 59,184 trees);
 * a regression to one species, or to the old object rows, fails here.
 */
const read = (ward) => asTreesFile(JSON.parse(readFileSync(
  new URL(`../../public/heat-map/data/${ward}-trees.json`, import.meta.url), 'utf8')));

const mixOf = (file) => file.trees.reduce((m, t) => ({ ...m, [t.species]: (m[t.species] ?? 0) + 1 }), {});

const EXPECTED = {
  /* Kolkata's mixes pinned too: counts alone let a species-index swap through, and
     fetch-canopy --check only tests membership in SPECIES. */
  ballygunge: { count: 12159, mix: { neem: 6101, palm: 3065, gulmohar: 2993 } },
  baruipur: { count: 8415, mix: { neem: 4182, palm: 2112, gulmohar: 2121 } },
  barrackpore: { count: 6811, mix: { neem: 3396, palm: 1688, gulmohar: 1727 } },
  indiranagar: { count: 23565, mix: { neem: 11779, palm: 5930, gulmohar: 5856 } },
  'mg-road': { count: 24819, mix: { neem: 12316, palm: 6262, gulmohar: 6241 } },
  whitefield: { count: 10800, mix: { neem: 5308, palm: 2754, gulmohar: 2738 } },
};

for (const [ward, expected] of Object.entries(EXPECTED)) {
  test(`${ward}: the shipped tree file parses, every tree kept, more than one species`, () => {
    const file = read(ward);
    assert.ok(file, `${ward}: asTreesFile rejected the shipped file -- the ward would render with no trees`);
    assert.equal(file.trees.length, expected.count);
    const mix = mixOf(file);
    assert.ok(Object.keys(mix).length > 1, `${ward}: every tree is one species`);
    if (expected.mix) assert.deepEqual(mix, expected.mix);
  });
}
