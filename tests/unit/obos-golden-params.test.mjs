import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import test from 'node:test';

import {
  COST_CASES,
  GOLDEN_LAYERS,
  GOLDEN_PARAMS,
  layersMatrix,
  paramsMatrix,
} from '../../scripts/dump-obos-golden.mjs';

/* THIS FILE NEVER WRITES. It is the consumer half of the generator/consumer split that
   scripts/dump-water-oracle.mjs and scripts/gen-cbam-fixtures.mjs already use, and the
   split is load-bearing here rather than stylistic.

   The golden files are pre-migration EVIDENCE. A test that regenerated them when they
   were missing would let a drifted constant be laundered clean in three commands — run
   fails, delete the JSON, run rewrites it from the drifted code, run passes — leaving a
   green suite and no trace. Worse, the missing-file message could not warn about it,
   because a legitimate first capture prints exactly the same thing. So a missing file is
   an ERROR here, with the two cases spelled out, and only
   `node --import tsx scripts/dump-obos-golden.mjs` can produce one. */

const RESTORE = (p) => `git checkout -- ${relative(process.cwd(), p)}`;
const REGEN = 'node --import tsx scripts/dump-obos-golden.mjs';

function requireGolden(path) {
  assert.ok(existsSync(path),
    `${path} is missing. It is pre-migration EVIDENCE, not a cache. If it was deleted, `
    + `restore it with \`${RESTORE(path)}\`. Regenerate with \`${REGEN}\` ONLY to capture `
    + 'a NEW baseline before a migration, never to clear a failure.');
}

const drifted = (path, what) =>
  `${what} drifted from the frozen baseline in ${relative(process.cwd(), path)}. That file `
  + 'records what the physics produced BEFORE the scope migration moved PATH_DELTA, COST, '
  + `PARK_R_M and FALLBACK_TAIR out of the model. Do not edit it by hand. Re-capture with `
  + `\`${REGEN}\` ONLY if this change was intentional — and review that diff as a change to `
  + 'the numbers the twin reports.';

test('currentParams output is frozen against the pre-migration baseline', async () => {
  const now = paramsMatrix();
  assert.equal(Object.keys(now).length, 24, 'the matrix must be 24 cases');

  /* FACADE_Q reaches the frozen numbers only through iv.facades, the single `iv` field
     currentParams reads. At facades = 0 the term multiplies out and the constant becomes
     invisible, so assert the fixture still carries it rather than trusting the literal. */
  const qs = new Set(Object.values(now).map((p) => p.Q));
  assert.ok(!qs.has(0.419) && !qs.has(0.2095),
    'Q is back at its facades = 0 values — the FACADE_Q term has collapsed and the '
    + 'constant is no longer observable in this matrix');

  requireGolden(GOLDEN_PARAMS);
  const golden = JSON.parse(await readFile(GOLDEN_PARAMS, 'utf8'));
  assert.deepEqual(now, golden, drifted(GOLDEN_PARAMS, 'currentParams'));
});

test('computeCost and the park blob edge are frozen against the pre-migration baseline', async () => {
  const now = layersMatrix();

  /* Assert the PROPERTY that makes these figures a COST guard, not the case count — six
     cases for four fields says nothing, and swapping a `-only` case for a two-lever one
     would keep the count while isolation silently died. */
  for (const [name, iv] of Object.entries(COST_CASES)) {
    if (!name.endsWith('-only')) continue;
    assert.equal(Object.values(iv).filter((v) => v > 0).length, 1,
      `${name} must move exactly ONE lever, or its COST field is not isolated`);
    assert.ok(now.cost[name] > 0,
      `${name} costs nothing — its COST field is invisible in the frozen figures`);
  }

  /* Likewise for the park transect: it is a PARK_R_M guard only while it straddles the
     blob edge. Slid wholly inside or wholly outside, the golden would still compare
     equal while guarding nothing. (The generator separately asserts the transect stays
     on one grid row.) */
  const full = now.parkTransectPlusX['full-40-40'];
  assert.ok(full.some((p) => p.veg > 0.5), 'transect must sample INSIDE the blob');
  assert.ok(full.some((p) => p.veg === 0), 'transect must sample OUTSIDE the blob');

  requireGolden(GOLDEN_LAYERS);
  const golden = JSON.parse(await readFile(GOLDEN_LAYERS, 'utf8'));
  assert.deepEqual(now, golden, drifted(GOLDEN_LAYERS, 'computeCost or the park blob'));
});
