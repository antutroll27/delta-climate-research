// tests/unit/cbam-tiles-list.test.mjs
// The Shipment list's tiles (spec §5.4). The honesty prose they carry is pinned in
// cbam-render.test.mjs; this file covers what the tiles add: the shells, the ruler, shares.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { rulerScale, yearTile } from '../../src/scripts/cbam-ui/tiles-list.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));
const S = pack.thresholds.find((t) => t.calendarYear === 2026).includedSectors;
const found = (over) => ({
  calendarYear: 2026, ruleFound: true, state: 'above_threshold', knownEligibleMassT: '260', thresholdT: '50',
  sourceLocator: 'Regulation (EU) 2023/956 Article 2(3)', entryIds: ['L1'], entryHashes: ['a'.repeat(64)],
  attested: false, eligibleLineCount: 3, linesInYear: 3, includedSectors: S, ...over,
});

test('rulerScale: the scale ends at the next whole multiple of the threshold, never below twice it', () => {
  // The preview's case: 260 t against 50 t draws a 0–300 t ruler, the fill at 86.7%, the mark at 16.7%.
  assert.deepEqual(rulerScale('260', '50'), { fillPct: '86.7', markPct: '16.7', maxT: '300' });
  // Under the threshold the scale is twice the threshold, so the mark sits mid-ruler.
  assert.deepEqual(rulerScale('30', '50'), { fillPct: '30.0', markPct: '50.0', maxT: '100' });
  // Exactly on a multiple fills the ruler and does not add an empty step.
  assert.deepEqual(rulerScale('300', '50'), { fillPct: '100.0', markPct: '16.7', maxT: '300' });
});

test('rulerScale: an unreadable or impossible input draws no ruler rather than a made-up one', () => {
  for (const [m, t] of [['', '50'], ['abc', '50'], ['-1', '50'], ['30', '0'], ['30', ''], ['Infinity', '50']]) {
    assert.equal(rulerScale(m, t), null, `${m} / ${t}`);
  }
});

test('yearTile: a tile shell around the pinned honesty markup, with the hooks the e2e suite reads', () => {
  const html = yearTile(found({}));
  assert.match(html, /^\s*<section class="b-t b-s2 cb-thresh">/, 'the e2e hook cb-thresh stays on the tile');
  assert.match(html, /<h2 class="b-t-ti">Annual de minimis\.<\/h2>/);
  assert.match(html, /<p class="b-t-sub">Eligible mass, 2026 · 3 lines<\/p>/, 'the line count the old row carried survives');
  assert.match(html, /<div class="b-mid num">260<span class="b-u">t<\/span><\/div>/);
  assert.match(html, /<div class="b-thr" aria-hidden="true"><b style="width:86\.7%"><\/b><em style="left:16\.7%"><\/em><\/div>/);
  assert.match(html, /<p class="b-t-foot num"><span>0<\/span><span>50 t threshold<\/span><span>300 t<\/span><\/p>/);
  assert.match(html, /<span class="cb-tag unavail">Above threshold<\/span>/);
});

test('yearTile: one eligible line is singular', () => {
  assert.match(yearTile(found({ eligibleLineCount: 1 })), /Eligible mass, 2026 · 1 line</);
});

test('yearTile: a no-rule year draws no ruler, no mass and no 50', () => {
  const html = yearTile({ calendarYear: 2027, ruleFound: false, attested: false, eligibleLineCount: 0 });
  assert.match(html, /<span class="cb-tag pending">No published rule<\/span>/);
  // (class="…" anchored: the hook cb-thresh contains the substring b-thr.)
  assert.doesNotMatch(html, /class="b-thr"|class="b-mid/);
  assert.doesNotMatch(html, /50/);
});

test('yearTile: an unreadable mass keeps the verdict and drops only the ruler', () => {
  const html = yearTile(found({ knownEligibleMassT: 'abc' }));
  assert.doesNotMatch(html, /class="b-thr"/);
  assert.match(html, /cb-tag unavail/);
});
