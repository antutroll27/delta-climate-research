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

/* ── F-06 ───────────────────────────────────────────────────────────────────── */

test('F-06 legal premise: the 2026 threshold row lists the sectors that aggregate into the one 50 t test', () => {
  // Reg (EU) 2023/956 Art 2a(1) (inserted by Reg (EU) 2025/2083): "That threshold shall apply to the total net mass of
  // goods under all CN codes aggregated per importer and per calendar year." Art 2a(4): not electricity or hydrogen.
  const row = pack.thresholds.find((r) => r.calendarYear === 2026);
  assert.deepEqual([...row.includedSectors].sort(), ['aluminium', 'cement', 'fertilisers', 'iron_and_steel']);
});

test('F-06 above threshold: says the line alone exceeds it and the exemption does not apply — nothing about the exposure below', () => {
  const t = thresh('2523100090', '100');
  assert.equal(t.state, 'above_threshold');
  const text = plain(renderThreshold(t));
  assert.ok(text.includes(
    'This line alone exceeds the 50 t annual threshold, so the exemption does not apply to your 2026 imports.'), text);
  assert.doesNotMatch(text, /exposure below stands/i);
});

test('F-06 indeterminate: one line is not the annual total, and every in-scope sector counts toward the 50 t', () => {
  const t = thresh('2523100090', '10');
  assert.equal(t.state, 'indeterminate');
  const row = pack.thresholds.find((r) => r.calendarYear === 2026);
  for (const html of [renderThreshold(t), renderDraftThreshold(pack, { cn: '2523100090', massT: '10', date: '2026-03-15' })]) {
    const text = plain(html);
    const sectors = sectorList(row.includedSectors);
    assert.ok(text.includes(
      'The exemption covers an importer whose CBAM goods total 50 t or less in a calendar year. '
      + 'This is one line, not your annual total, so it cannot show you are under the threshold. '
      + `Add all your other CBAM imports for 2026 — ${sectors} — before relying on the exemption.`), text);
    for (const key of row.includedSectors) {
      const word = key === 'iron_and_steel' ? 'iron & steel' : key === 'fertilisers' ? 'fertiliser' : key;
      assert.ok(text.includes(word), `the sentence names ${word}`);
    }
  }
});

test('F-06 the sentence follows the row: a 2027 line and a different sector list are read, not hard-coded', () => {
  const t = thresh('72083800', '10', '2027-03-15');
  const html = renderThreshold({ ...t, thresholdT: '60' }, ['cement', 'aluminium']);
  const text = plain(html);
  assert.ok(text.includes('total 60 t or less'), text);
  assert.ok(text.includes('CBAM imports for 2027 — cement and aluminium — before'), text);
});

test('F-06 no threshold surface says "exposure below stands" or "owes nothing" (single line, per-year, List tile, print)', () => {
  const found = (html) => assert.doesNotMatch(plain(html), /exposure below stands|owes nothing/i);
  for (const m of ['10', '100', '49.9999', '50', '50.0001']) {
    found(renderThreshold(thresh('2523100090', m)));
    found(renderDraftThreshold(pack, { cn: '2523100090', massT: m, date: '2026-03-15' }));
  }
  const row = pack.thresholds.find((r) => r.calendarYear === 2026);
  for (const [state, attested] of [['indeterminate', false], ['above_threshold', false], ['below_threshold', true]]) {
    const y = {
      calendarYear: 2026, ruleFound: true, state, knownEligibleMassT: '30', thresholdT: '50',
      sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)', entryIds: ['L1'], entryHashes: ['a'.repeat(64)],
      attested, eligibleLineCount: 1, linesInYear: 2, includedSectors: row.includedSectors,
    };
    found(yearTile(y)); found(renderYearThreshold(y));
    // 'owes nothing' survives in the below-threshold NEGATION "does not mean you owe nothing" only — a different phrase.
  }
  const e = run('100');
  found(buildPrintDocument({
    lines: [{ id: 'L1', cn: '2523100090', country: 'DZ', route: '(A)', scope: 'direct_and_indirect', massT: '100', date: '2026-03-15' }],
    results: [e], yearCards: [], totals: sumTotals([e]), packSnapshot: 'f'.repeat(64),
    rulePackages: ['eu-cbam-2026-free-allocation@v1'], pack, generatedOn: '2026-11-03',
  }));
});

