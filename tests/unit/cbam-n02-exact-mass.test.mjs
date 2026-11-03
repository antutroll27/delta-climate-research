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
  AMENDED_BY_2025_2083, sectorList, yearTile,
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

/* ── N-02 ───────────────────────────────────────────────────────────────────── */

test('N-02 the Estimate card prints the mass exactly at 49.9999, 50 and 50.0001 t', () => {
  const row = (m) => /<span>This line<\/span><b>([^<]*)<\/b>/.exec(renderThreshold(thresh('2523100090', m)))[1];
  assert.equal(row('49.9999'), '49.9999 t');
  assert.equal(row('50'), '50 t');
  assert.equal(row('50.0001'), '50.0001 t');
  assert.match(renderThreshold(thresh('2523100090', '50.0001')), /Above threshold/);
  assert.match(renderThreshold(thresh('2523100090', '50')), /Indeterminate/);
});

test('N-02 the print document prints the verdict mass exactly at 49.9999, 50 and 50.0001 t', () => {
  const row = pack.thresholds.find((r) => r.calendarYear === 2026);
  const doc = (m, state) => {
    const e = run(m);
    return buildPrintDocument({
      lines: [{ id: 'L1', cn: '2523100090', country: 'DZ', route: '(A)', scope: 'direct_and_indirect', massT: m, date: '2026-03-15' }],
      results: [e],
      yearCards: [{
        calendarYear: 2026, ruleFound: true, state, knownEligibleMassT: m, thresholdT: '50',
        sourceLocator: row.sourceLocator, entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: false,
        eligibleLineCount: 1, linesInYear: 1, includedSectors: row.includedSectors,
      }],
      totals: sumTotals([e]), packSnapshot: 'f'.repeat(64), rulePackages: ['eu-cbam-2026-free-allocation@v1'],
      pack, generatedOn: '2026-11-03',
    });
  };
  assert.match(doc('49.9999', 'indeterminate'), /at 49\.9999 t of 50 t/);
  assert.match(doc('50', 'indeterminate'), /at 50 t of 50 t/);
  const above = doc('50.0001', 'above_threshold');
  assert.match(above, /Above threshold<\/b> at 50\.0001 t of 50 t/);
  assert.match(above, /<td>50\.0001<\/td>/, 'and the line\'s own mass cell does not round to 50 beside it');
});

test('N-02 the per-year card prints the eligible mass exactly too', () => {
  const row = pack.thresholds.find((r) => r.calendarYear === 2026);
  const y = {
    calendarYear: 2026, ruleFound: true, state: 'above_threshold', knownEligibleMassT: '50.0001', thresholdT: '50',
    sourceLocator: row.sourceLocator, entryIds: ['L1'], entryHashes: ['a'.repeat(64)], attested: false,
    eligibleLineCount: 1, linesInYear: 1, includedSectors: row.includedSectors,
  };
  assert.match(renderYearThreshold(y), /<b>50\.0001 t<\/b>/);
});

