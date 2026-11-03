// tests/unit/cbam-tiles-list.test.mjs
// The Shipment list's tiles (spec §5.4). The honesty prose they carry is pinned in
// cbam-render.test.mjs; this file covers what the tiles add: the shells, the ruler, shares.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  linePlate, listView, refusedLinePlate, rulerScale, shareOfTotal, thresholdErrorTile, totalTile, yearTile,
} from '../../src/scripts/cbam-ui/tiles-list.ts';

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
  // The year is in the heading, so a heading list tells the years' tiles apart (L6).
  assert.match(html, /<h2 class="b-t-ti">Annual de minimis, 2026\.<\/h2>/);
  assert.match(html, /<p class="b-t-sub">Eligible mass · 3 lines<\/p>/, 'the line count the old row carried survives');
  assert.match(html, /<div class="b-mid num">260<span class="b-u">t<\/span><\/div>/);
  assert.match(html, /<div class="b-thr" aria-hidden="true"><b style="width:86\.7%"><\/b><em style="left:16\.7%"><\/em><\/div>/);
  assert.match(html, /<p class="b-t-foot num"><span>0<\/span><span>50 t threshold<\/span><span>300 t<\/span><\/p>/);
  assert.match(html, /<span class="cb-tag unavail">Above threshold<\/span>/);
});

test('yearTile: one eligible line is singular', () => {
  assert.match(yearTile(found({ eligibleLineCount: 1 })), /Eligible mass · 1 line</);
});

test('yearTile: a year past the table draws no ruler, no mass and no 50', () => {
  // 2031, not 2027: the pack carries a 50 t row for 2026-2030 (Art 2a has no end date), so 2027 is
  // an ordinary verdict tile. Only a year with no row lands on this arm, and the tag says so.
  const html = yearTile({ calendarYear: 2031, ruleFound: false, attested: false, eligibleLineCount: 0 });
  assert.match(html, /<span class="cb-tag pending">Year not covered<\/span>/);
  assert.match(html, /<h2 class="b-t-ti">Annual de minimis, 2031\.<\/h2>/, 'the year is in the heading of a no-rule tile too');
  // (class="…" anchored: the hook cb-thresh contains the substring b-thr.)
  assert.doesNotMatch(html, /class="b-thr"|class="b-mid/);
  assert.doesNotMatch(html, /50/);
});

test('yearTile: an unreadable mass keeps the verdict and drops only the ruler', () => {
  const html = yearTile(found({ knownEligibleMassT: 'abc' }));
  assert.doesNotMatch(html, /class="b-thr"/);
  assert.match(html, /cb-tag unavail/);
});

const T = (over) => ({ certificates: '474.049', costEur: '35901.31', chargeableTco2e: '474.049',
  pricedLines: 3, refusedLines: 0, anyPending: true, ...over });
const LINE = { id: 'L1', cn: '73063077', country: 'IN', route: '(C)', scope: 'direct', massT: '100',
  date: '2026-03-15', tier: 'default+markup' };
const PARTS = { result: '<section class="cb-card cb-res">R</section>', attestation: '', delta: '',
  tierLabel: 'Commission default + mark-up' };

test('shareOfTotal: a line\'s share of the total, judged against the exact ratio', () => {
  // 329.8275 / 474.0485 = 69.5769…% — the preview's "69.6%".
  assert.equal(shareOfTotal('329.8275', '474.0485'), '69.6');
  assert.equal(shareOfTotal('474.0485', '474.0485'), '100.0');
  // Exactly on a half: ROUND_HALF_UP, so 0.05% → '0.1', never banker's '0.0'.
  assert.equal(shareOfTotal('1', '2000'), '0.1');
});

test('shareOfTotal: no share without a real, positive total — a zero total is not 0%', () => {
  for (const [p, t] of [['1', '0'], ['1', ''], ['', '10'], ['x', '10'], ['-1', '10'], ['1', '-10']]) {
    assert.equal(shareOfTotal(p, t), null, `${p} / ${t}`);
  }
});

test('totalTile: a hero tile carrying the e2e hook, the actions and one bar segment per share', () => {
  const html = totalTile(T({}), null, ['69.6', '24.8', '5.6']);
  assert.match(html, /^\s*<section class="b-t b-s2 b-hero cb-total">/);
  assert.match(html, /<h2 class="b-t-ti">Total\.<\/h2>/);
  assert.match(html, /<div class="b-stackbar" aria-hidden="true"><b style="flex:69\.6"><\/b><b style="flex:24\.8"><\/b><b style="flex:5\.6"><\/b><\/div>/);
  assert.match(html, /data-goto="export"[^>]*>Export</);
  assert.match(html, /data-goto="estimate"[^>]*>Add a line</);
});

test('totalTile: no shares, no stack bar — never an empty bar that reads as zero', () => {
  assert.doesNotMatch(totalTile(T({}), null, []), /b-stackbar/);
  assert.doesNotMatch(totalTile(T({ pricedLines: 0, refusedLines: 2, certificates: '0', costEur: null }), null, ['50']), /b-stackbar/,
    'a total with nothing priced draws no bar even if a caller passes shares');
});

test('linePlate: the e2e hooks, the 1-based title, the tier chip, the summary line', () => {
  const html = linePlate(LINE, 0, PARTS, { goodName: 'Other tubes <welded>' });
  assert.match(html, /^\s*<article class="b-t b-pass cb-line" data-line="L1">/);
  assert.match(html, /<h2 class="b-t-ti">Line 1\.<\/h2>/);
  assert.match(html, /<span class="chip bronze"><i aria-hidden="true"><\/i>Commission default \+ mark-up<\/span>/);
  assert.match(html, /<p class="b-pass-name" title="Other tubes &lt;welded&gt;">Other tubes &lt;welded&gt;<\/p>/);
  assert.match(html, /73063077 · IN · \(C\) · 100 t · 2026-03-15/);
  assert.match(html, /<button type="button" class="b-rm cb-line-x" data-remove="L1" aria-label="Remove line 1">Remove<\/button>/);
  assert.ok(html.includes(PARTS.result), 'the result card is carried verbatim');
});

test('linePlate: verified tiers wear cyan, the mixed tier wears both colours', () => {
  assert.match(linePlate({ ...LINE, tier: 'actual-verified' }, 0, { ...PARTS, tierLabel: 'Verified actual' }), /<span class="chip cyan"><i aria-hidden="true"><\/i>Verified actual<\/span>/);
  const mixed = linePlate({ ...LINE, tier: 'verified-direct+default-indirect' }, 0, { ...PARTS, tierLabel: 'Verified direct + Commission indirect' });
  assert.match(mixed, /<span class="chip cyan"><i aria-hidden="true"><\/i>Verified direct<\/span><span class="chip bronze"><i aria-hidden="true"><\/i>Commission indirect<\/span>/);
});

test('linePlate: a share draws a bar; an exempt line says so instead; neither, nothing', () => {
  const shared = linePlate(LINE, 0, PARTS, { sharePct: '69.6' });
  assert.match(shared, /<div class="b-share-row"><span>Share of the total<\/span><span class="num">69\.6%<\/span><\/div><div class="b-share" aria-hidden="true"><b style="width:69\.6%"><\/b><\/div>/);
  const exempt = linePlate(LINE, 0, PARTS, { exempt: true, sharePct: '69.6' });
  assert.match(exempt, /Exempt if your list is complete · not in the total/);
  assert.doesNotMatch(exempt, /b-share"/, 'an exempt line has no share of a total it is not in');
  assert.doesNotMatch(linePlate(LINE, 0, PARTS), /b-share/);
});

test('refusedLinePlate: a thrown line shows its reason and no figure, with the same hooks', () => {
  const html = refusedLinePlate({ ...LINE, id: 'X"1' }, 2, 'boom <b>');
  assert.match(html, /<article class="b-t b-pass cb-line" data-line="X&quot;1">/);
  assert.match(html, /Line 3\./);
  assert.match(html, /<div class="cb-res cb-unavail"><div class="cb-tag unavail">No estimate<\/div>\s*<p class="cb-reason">boom &lt;b&gt;<\/p><\/div>/);
  assert.match(html, /data-remove="X&quot;1" aria-label="Remove line 3"/);
  assert.doesNotMatch(html, /cb-fig|b-share|cb-cost/);
});

test('thresholdErrorTile: the error, escaped, in a tile', () => {
  const html = thresholdErrorTile('bad <year>');
  assert.match(html, /<div class="cb-tag unavail">Threshold error<\/div>/);
  assert.match(html, /<p class="cb-reason">bad &lt;year&gt;<\/p>/);
});

test('listView: Total then the years in one row, the lines in a three-column row', () => {
  assert.equal(listView({ total: 'T', years: 'Y', plates: 'P' }),
    '<div class="b-bento b-list">TY</div><div class="b-bento b-c3">P</div>');
});

test('linePlate: a tier outside the three known ones draws no chip and no raw text', () => {
  const html = linePlate({ ...LINE, tier: '<b>x</b>' }, 0, PARTS);
  assert.doesNotMatch(html, /<b>x<\/b>|class="chip/, 'never the unescaped value, never a chip');
});

// ── plan 05, P5-2 and P5-3: the crates beside a total, the gauge only above the threshold ──
const illCount = (html, name) => (html.match(new RegExp(`data-ill="${name}"`, 'g')) ?? []).length;

test('P5-2 - the crates sit in a priced Total, and in no other Total state', () => {
  assert.equal(illCount(totalTile(T({}), null, ['69.6', '24.8', '5.6']), 'box'), 1);
  assert.equal(illCount(totalTile(T({}), null, []), 'box'), 1, 'a total with no bar segments is still a figure');
  assert.match(totalTile(T({}), null, []), /^\s*<section class="b-t b-s2 b-hero cb-total"><svg[^>]*data-ill="box"/);
  const states = [
    ['no lines yet', T({ pricedLines: 0, refusedLines: 0, certificates: '0', costEur: null })],
    ['nothing priced', T({ pricedLines: 0, refusedLines: 2, certificates: '0', costEur: null })],
  ];
  for (const [name, t] of states) assert.doesNotMatch(totalTile(t, null, []), /data-ill=/, name);
  const exemptOnly = totalTile(T({ pricedLines: 0, refusedLines: 0, certificates: '0', costEur: null }),
    T({ pricedLines: 1, certificates: '12.5', costEur: '900', anyPending: false }), []);
  assert.match(exemptOnly, /Exempt if your list is complete/, 'premise: the exempt-only state');
  assert.doesNotMatch(exemptOnly, /data-ill=/, 'exempt-only: nothing owed, nothing drawn');
});

test('P5-3 - the gauge is drawn on an above-threshold year and on no other verdict', () => {
  const above = yearTile(found({}));
  assert.equal(illCount(above, 'gauge'), 1);
  assert.match(above, /<section class="b-t b-s2 cb-thresh"><svg[^>]*data-ill="gauge"/);
  for (const [name, y] of [
    ['below', found({ state: 'below_threshold', knownEligibleMassT: '30' })],
    ['indeterminate', found({ state: 'indeterminate' })],
    ['no rule', found({ ruleFound: false })],
  ]) assert.doesNotMatch(yearTile(y), /data-ill=/, name);
  assert.doesNotMatch(thresholdErrorTile('x'), /data-ill=/);
});
