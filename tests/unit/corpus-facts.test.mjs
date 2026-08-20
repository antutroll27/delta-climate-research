import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { validateEstimatorPack } from '../../src/scripts/cbam-algos/estimator/pack-v2.ts';
import { OTHER_ORIGIN } from '../../src/scripts/cbam-algos/regulatory/iso-3166.ts';

/**
 * THE SCALARS THE COMMENTS QUOTE, PINNED AGAINST THE SHIPPED PACK.
 *
 * Mirrors lib/estimator/corpus-facts.test.ts in the CBM repo, against the same corpus: the pack
 * under public/cbam/ is the SaaS's pack copied byte-for-byte, the same way src/scripts/cbam-algos/
 * is the SaaS's engine copied byte-for-byte (scripts/cbam-sync-check.mjs hash-guards both). So
 * every number below is asserted twice, once per repo, and a re-vendoring that quietly swapped
 * the corpus underneath the comments would fail here as well as there.
 *
 * Comments across both repos cite corpus counts as evidence — "572 goods", "421 of 572 goods",
 * "the 121 sheets plus the residual OTHER". Those numbers were measured once and then rotted
 * silently: an audit found 574 quoted where the pack held 572, and 120 where it held 121. A stale
 * number in a comment is worse than no number, because it reads like a measurement.
 *
 * WHEN ONE OF THESE LEGITIMATELY CHANGES — a new Commission workbook, a pack rebuild — do not
 * simply edit the expectation to make the suite green. Update it HERE, then grep BOTH repos for
 * the old value and fix every comment that quotes it:
 *
 *   rg -n '\b572\b' /Volumes/VSTSAMPLES/Projects/CBM /Volumes/VSTSAMPLES/Projects/angad-allroutes
 *
 * That grep is the point of this file. The assertion is only what forces someone to run it.
 *
 * ORIGINS ARE COUNTED AS PUBLISHED SHEETS, DELIBERATELY. The Commission's workbook gives each
 * listed origin its own sheet and puts everyone else on a residual sheet; `publishedOriginSheets`
 * holds ONLY the former and does NOT contain the 'OTHER' sentinel (asserted below, so the
 * relationship cannot drift either). So:
 *
 *   121 = origins with their own published sheet   ← what this file pins
 *   122 = those 121 + the 'OTHER' residual bucket  ← what a comment saying 122 means
 *
 * A comment saying 120 is simply stale. A prior audit found 120, 121 and 122 used
 * interchangeably in THIS repo for what a reader would take to be one quantity; stating the
 * arithmetic here is what stops the three being confused again. The form's origin <select> is
 * the 122 (initCbam derives it from the rows, not from the sheet list, so importers with no
 * sheet of their own have something honest to pick).
 */
const pack = validateEstimatorPack(JSON.parse(readFileSync(
  new URL('../../public/cbam/estimator-pack.json', import.meta.url), 'utf8')));

test('pins the scalars the comments quote', () => {
  assert.equal(pack.classifications.length, 572);
  assert.equal(pack.defaultValues.length, 76428);
  assert.equal(pack.benchmarks.length, 2465);
  assert.equal(new Set(pack.publishedOriginSheets).size, 121);
});

/**
 * The 121-vs-122 arithmetic, asserted rather than only described. If a future pack ever folds the
 * residual bucket into the sheet list, the count above would jump to 122 for a reason that has
 * nothing to do with the Commission listing another origin — and this is what would say so.
 */
test('counts published sheets only, with the residual bucket outside them', () => {
  assert.ok(!pack.publishedOriginSheets.includes(OTHER_ORIGIN));
  assert.equal(new Set([...pack.publishedOriginSheets, OTHER_ORIGIN]).size, 122);
  // The origin <select> is built from the ROWS, so this is the list the user actually sees.
  assert.equal(new Set(pack.defaultValues.map((r) => r.originCountry)).size, 122);
});
