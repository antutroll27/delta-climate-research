import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildPrintDocument, renderDraftThreshold, renderThreshold, renderYearThreshold,
} from '../../src/scripts/cbam-algos/cbam-app.ts';
import { estimateFromPack, resolveThreshold } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';
import { sumTotals } from '../../src/scripts/cbam-lines.ts';
import { renderMassRuler } from '../../src/scripts/cbam-ui/inputs-estimate.ts';
import {
  AMENDED_BY_2025_2083, sectorList, thresholdCitation, yearTile,
} from '../../src/scripts/cbam-ui/tiles-list.ts';

/**
 * Four small audit fixes (2026-11-03): F-06 the threshold sentences, F-08 the ruler label, N-02 exact masses
 * beside a threshold verdict, N-03 the citation. Written against the REAL pack, like cbam-render.test.mjs.
 */
const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const thresh = (cn, massT, date = '2026-03-15') => resolveThreshold(pack, { cn, massT, date });
const run = (massT) => estimateFromPack(pack, { cn: '2523100090', country: 'DZ', route: '(A)', massT, date: '2026-03-15' });
// Tags and entities out, whitespace collapsed: the sentence as a reader gets it.
const plain = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

/* ── N-03 ───────────────────────────────────────────────────────────────────── */

test('N-03 thresholdCitation appends the amending act only when the locator does not already name it', () => {
  assert.equal(thresholdCitation('Regulation (EU) 2023/956 Article 2(3)'),
    `Regulation (EU) 2023/956 Article 2(3) · ${AMENDED_BY_2025_2083}`);
  const own = 'Regulation (EU) 2025/2083 Article 1 and Annex II (new CBAM Annex VII)';
  assert.equal(thresholdCitation(own), own, 'already cites 2025/2083: nothing appended');
});

test('N-03 every threshold card cites 2025/2083 exactly once, on the pack\'s own locator', () => {
  const row = pack.thresholds.find((r) => r.calendarYear === 2026);
  const once = (html) => assert.equal((html.match(/2025\/2083/g) ?? []).length, 1, html);
  once(renderThreshold(thresh('2523100090', '10')));
  once(renderThreshold(thresh('2523100090', '100')));
  const y = {
    calendarYear: 2026, ruleFound: true, state: 'indeterminate', knownEligibleMassT: '30', thresholdT: '50',
    sourceLocator: row.sourceLocator, entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: false,
    eligibleLineCount: 1, linesInYear: 1, includedSectors: row.includedSectors,
  };
  once(renderYearThreshold(y));
  once(yearTile(y));
  // A locator that names only the consolidated article still gets the amending act, once.
  const old = { ...y, sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)' };
  once(renderYearThreshold(old)); once(yearTile(old));
});
