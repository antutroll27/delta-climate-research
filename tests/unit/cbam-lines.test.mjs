import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  yearOf, lineFingerprint, packSnapshotHash, thresholdByYear, sumTotals,
} from '../../src/scripts/cbam-lines.ts';
import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

const est = (cn, country, route, massT, date = '2026-03-15') =>
  estimateFromPack(pack, { cn, country, route, massT, date });

const line = (over = {}) => ({
  id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
  scope: 'direct_and_indirect', massT: '30', date: '2026-03-15', ...over,
});

test('yearOf reads the calendar year from the import date', () => {
  assert.equal(yearOf(line()), 2026);
  assert.equal(yearOf(line({ date: '2027-01-02' })), 2027);
});

test('yearOf returns NaN for a malformed date, never a fabricated year', () => {
  // <input type="date"> yields '' when cleared. yearOf must not throw (it runs
  // inside thresholdByYear's grouping loop, uncaught) and must not silently
  // bucket the line into "year 0" via Number(''.slice(0, 4)).
  assert.ok(Number.isNaN(yearOf(line({ date: '' }))));
  assert.ok(Number.isNaN(yearOf(line({ date: '2026-3-15' }))), 'not zero-padded is not ISO');
});

test('lineFingerprint is deterministic and input-sensitive', async () => {
  const a = await lineFingerprint(line());
  const b = await lineFingerprint(line());
  const c = await lineFingerprint(line({ massT: '31' }));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, b, 'same inputs must give the same fingerprint');
  assert.notEqual(a, c, 'a changed mass must change the fingerprint');
  // The id is a UI key, not an input: two identical lines fingerprint identically.
  assert.equal(a, await lineFingerprint(line({ id: 'L2' })));
});

test('lineFingerprint does not collide across a shifted field boundary', async () => {
  // #cbCn is free text, so a delimiter-free join would hash cn='2523100'+
  // country='0DZ' the same as cn='25231000'+country='DZ'. These must differ.
  const a = await lineFingerprint(line({ cn: '2523100', country: '0DZ' }));
  const b = await lineFingerprint(line({ cn: '25231000', country: 'DZ' }));
  assert.notEqual(a, b, 'a boundary shift between cn and country must change the fingerprint');
});

test('packSnapshotHash pins generatedAt and both workbook hashes', async () => {
  const a = await packSnapshotHash(pack);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await packSnapshotHash(pack), 'stable across calls');
  const altered = { ...pack, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.notEqual(a, await packSnapshotHash(altered), 'generatedAt is part of the claim');
});

test('packSnapshotHash treats each workbook hash as a real digest input, not just a presence check', async () => {
  // Forward-guard, not a regression test: the pre-fix code already folded
  // workbookSha256 into the digest, so this passes against both the old and
  // new implementation — it is the missing-hash test below that pins the bug
  // this commit fixed. What this one catches is a FUTURE refactor that keeps
  // the field present but stops it from actually varying the hash (e.g.
  // hashing only presence/absence, or only the first entry's hash).
  const a = await packSnapshotHash(pack);
  const altered = {
    ...pack,
    generatedFrom: pack.generatedFrom.map((s, i) => (i === 0 ? { ...s, workbookSha256: 'f'.repeat(64) } : s)),
  };
  assert.notEqual(a, await packSnapshotHash(altered), 'a workbook hash must be part of the claim');
});

test('packSnapshotHash throws rather than silently omit a missing workbook hash', async () => {
  const altered = {
    ...pack,
    generatedFrom: pack.generatedFrom.map((s, i) => (i === 0 ? { ...s, workbookSha256: undefined } : s)),
  };
  await assert.rejects(packSnapshotHash(altered), new RegExp(pack.generatedFrom[0].id));
});

const fp = new Map([['L1', 'a'.repeat(64)], ['L2', 'b'.repeat(64)], ['L3', 'c'.repeat(64)]]);

test('per-year, not per-estimate: a 2027 line cannot push 2026 over the threshold', () => {
  // THE regression test for the per-year decision. A per-estimate model sums
  // 30 + 30 = 60 t and reports above_threshold — inventing a liability. The pack
  // publishes a threshold row for 2026 only, so 2027 gets ruleFound: false
  // rather than a fabricated 50 t default.
  const lines = [
    line({ id: 'L1', massT: '30', date: '2026-03-15' }),
    line({ id: 'L2', massT: '30', date: '2027-03-15' }),
  ];
  const cards = thresholdByYear(lines, fp, new Set([2026, 2027]), pack);
  const y26 = cards.find((c) => c.calendarYear === 2026);
  const y27 = cards.find((c) => c.calendarYear === 2027);
  assert.equal(y26.ruleFound, true);
  assert.equal(y26.state, 'below_threshold', '30 t attested-complete is below 50 t');
  assert.equal(y27.ruleFound, false, 'no threshold rule is published for 2027');
});

test('above threshold is a fact — the attestation cannot gate it', () => {
  const cards = thresholdByYear([line({ massT: '60' })], fp, new Set(), pack);
  assert.equal(cards[0].state, 'above_threshold');
});

test('unattested and under 50 t stays indeterminate', () => {
  const cards = thresholdByYear([line({ massT: '30' })], fp, new Set(), pack);
  assert.equal(cards[0].state, 'indeterminate');
});

test('exactly 50 t attested-complete is below threshold — the .gt boundary', () => {
  // The highest-stakes single case this function handles. evaluateThreshold
  // uses .gt(thresholdT), so a line sitting exactly ON the 50 t threshold is
  // NOT above it. Every other test here uses 60 or 30 — neither would notice
  // if .gt ever became .gte, which would start taxing an importer at exactly
  // the line the regulation exempts.
  const cards = thresholdByYear([line({ massT: '50' })], fp, new Set([2026]), pack);
  assert.equal(cards[0].state, 'below_threshold', '50 t is AT the threshold, not above it');
});

test('a hydrogen line is excluded from the eligible mass', () => {
  // sectorForCn('28041000') is hydrogen, absent from the 2026 row's
  // includedSectors. aggregateThresholdBasis's own massSectors filter would also
  // drop it; we exclude before aggregation so entryIds reflects reality.
  const lines = [line({ id: 'L1', massT: '30' }), line({ id: 'L3', cn: '28041000', massT: '900' })];
  const [card] = thresholdByYear(lines, fp, new Set([2026]), pack);
  assert.equal(card.state, 'below_threshold', '900 t of hydrogen must not count');
  assert.deepEqual(card.entryIds, ['L1']);
  assert.deepEqual(card.entryHashes, ['a'.repeat(64)]);
});

test('eligibleLineCount tracks what aggregateThresholdBasis actually kept, not our own pre-filter', () => {
  // Regression for a review finding: entries.length (our filter, keyed on
  // rule.includedSectors) and basis.entryIds.length (ALSO filtered by
  // aggregateThresholdBasis's own hardcoded massSectors) agree today only
  // because the shipped 2026 row's includedSectors happens to equal
  // massSectors exactly. Simulate a future rule that widens includedSectors
  // to hydrogen: our filter lets a hydrogen line through, but the vendored
  // massSectors filter (cement/aluminium/fertilisers/iron_and_steel only)
  // still drops it. eligibleLineCount must follow entryIds, not the count of
  // what we handed to aggregateThresholdBasis.
  const widerPack = {
    ...pack,
    thresholds: pack.thresholds.map((t) => (t.calendarYear === 2026
      ? { ...t, includedSectors: [...t.includedSectors, 'hydrogen'] }
      : t)),
  };
  const lines = [line({ id: 'L1', massT: '10' }), line({ id: 'L3', cn: '28041000', massT: '5' })];
  const [card] = thresholdByYear(lines, fp, new Set([2026]), widerPack);
  assert.deepEqual(card.entryIds, ['L1'], 'the vendored massSectors filter still drops hydrogen');
  assert.equal(card.eligibleLineCount, 1, 'count must match entryIds.length, not our own pre-filter length');
});

test('a line with an unresolved date produces no phantom NaN-year card', () => {
  // yearOf(line({date: ''})) is NaN (Task 1). [...new Set(...)] collapses every
  // NaN into one Set member (SameValueZero), so an unfiltered years list would
  // yield exactly one bogus card with calendarYear: NaN, and its rule lookup
  // (pack.thresholds.find(t => t.calendarYear === NaN)) would always miss —
  // masking the real 2026 card behind a meaningless "no rule" one. The
  // undated line must simply be absent from every year's aggregation, not
  // counted as its own year.
  const lines = [
    line({ id: 'L1', massT: '30', date: '2026-03-15' }),
    line({ id: 'L2', massT: '999', date: '' }),
  ];
  const cards = thresholdByYear(lines, fp, new Set([2026]), pack);
  assert.equal(cards.length, 1, 'no card at all for the undated line');
  assert.equal(cards[0].calendarYear, 2026);
  assert.equal(cards[0].state, 'below_threshold', 'the 999 t undated line must not be swept in');
});

test('calendar years sort numerically — pinned as intent, not as reachable behaviour', () => {
  // Forward-guard, not a regression test: yearOf only ever returns a number
  // sliced from a regex-validated YYYY-MM-DD, so a real year is always exactly
  // 4 digits — lexicographic and numeric order can never disagree on input
  // this function can actually receive. This test passes identically against
  // a bare .sort() (verified: reverting the comparator keeps all tests green).
  // What it pins is INTENT — the (a, b) => a - b comparator stays in place as
  // defensive code, in case a future yearOf ever returns something other than
  // a 4-digit year.
  const lines = [
    line({ id: 'L1', massT: '5', date: '2027-03-15' }),
    line({ id: 'L2', massT: '5', date: '2026-03-15' }),
  ];
  const cards = thresholdByYear(lines, fp, new Set(), pack);
  assert.deepEqual(cards.map((c) => c.calendarYear), [2026, 2027]);
});

test('a line missing from the fingerprint map is a loud bug, not a silent empty hash', () => {
  // packSnapshotHash throws rather than fold a missing workbookSha256 into ''
  // (Task 1); the same instinct applies here. A missing fingerprint means some
  // caller forgot to hash a line before building cards — '' would print on the
  // audit trail as an ordinary, complete entryHashes value instead of surfacing
  // the bug.
  const lines = [line({ id: 'L9', massT: '30' })];
  assert.throws(() => thresholdByYear(lines, fp, new Set(), pack), /L9/);
});

test('sumTotals sums scenarios in Decimal and stays labelled a what-if', () => {
  // Two known cscf_pending lines. 25231000/DZ/(A)/100 has certificates 71.465
  // (§8-pinned); the same line at 200 t doubles it. 0.1-style float drift is
  // what Decimal prevents; the assertion is exact string equality.
  const a = est('25231000', 'DZ', '(A)', '100');
  const b = est('25231000', 'DZ', '(A)', '200');
  const t = sumTotals([a, b]);
  assert.equal(t.certificates, '214.395');
  assert.equal(t.costEur, '16156.80');       // (71.465 + 142.93) × 75.36
  assert.equal(t.pricedLines, 2);
  assert.equal(t.refusedLines, 0);
  assert.equal(t.anyPending, true, 'a total containing what-ifs is a what-if');
});

test('a refused line is counted and does not poison the total', () => {
  const good = est('25231000', 'DZ', '(A)', '100');
  const bad = est('72052100', 'IN', '(C)', '60');   // stranded: unavailable
  const t = sumTotals([good, bad]);
  assert.equal(bad.status, 'unavailable');
  assert.equal(t.certificates, '71.465');
  assert.equal(t.pricedLines, 1);
  assert.equal(t.refusedLines, 1);
});

test('a final zero_by_fiat line mixed with a pending line still taints the whole total', () => {
  // Electricity (27160000) is zero_by_fiat — final on its own, CSCF or no CSCF
  // (Art 2(2) sets it to nil by fiat). But the shipped pack does not offer
  // electricity as a good at all (no classification, no default factor), so
  // there is no real selector that reaches zero_by_fiat through estimateFromPack
  // with the shipped pack. Extend a copy of the pack with one synthetic
  // electricity row rather than hand-building a CertificateEstimate literal —
  // running the real engine keeps this test honest about the shape zero_by_fiat
  // actually returns.
  const electricPack = {
    ...pack,
    classifications: [...pack.classifications, { code: '27160000', description: 'Electrical energy' }],
    defaultFactors: [...pack.defaultFactors, {
      scopeCode: '27160000', originCountry: 'DZ', emissionsType: 'direct',
      productionRoute: 'default', reportingYear: 2026, baseIntensity: '0.5', markupPct: '0',
    }],
  };
  const pending = est('25231000', 'DZ', '(A)', '100');
  const zero = estimateFromPack(electricPack, {
    cn: '27160000', country: 'DZ', route: 'default', massT: '10', date: '2026-03-15',
  });
  assert.equal(zero.status, 'zero_by_fiat');

  const t = sumTotals([pending, zero]);
  assert.equal(t.certificates, '76.465');   // 71.465 + 5
  assert.equal(t.costEur, '5762.40');       // 5385.60 + 376.80
  assert.equal(t.pricedLines, 2);
  assert.equal(t.refusedLines, 0);
  // The zero_by_fiat component is exact on its own; the total still cannot be
  // shown as final, because the pending line inside it is a what-if.
  assert.equal(t.anyPending, true, 'one pending line makes the whole sum a what-if, even mixed with a final one');
});

test('one line with an unpublished quarter price nulls the whole euro total', () => {
  // Both lines are cscf_pending and both PRICE (certificates exist for both),
  // but 2026-Q3's certificate price is unpublished in the shipped pack (see
  // public/cbam/estimator-pack.json's prices array: Q1 is 'published' at
  // 75.36, Q3 is 'status: pending', priceEur: null) — reachable by any user
  // who dates an import in September. costEur must go to null for the WHOLE
  // total, not silently sum only the Q1 line's cost and drop the Q3 line's
  // absence on the floor: a costEur that looked complete while quietly
  // representing only one of two priced lines is exactly the partial-total
  // failure this function exists to refuse.
  const q1 = est('25231000', 'DZ', '(A)', '100', '2026-03-15');
  const q3 = est('25231000', 'DZ', '(A)', '100', '2026-08-15');
  assert.equal(q1.status, 'cscf_pending');
  assert.equal(q3.status, 'cscf_pending');
  assert.equal(q1.scenario.costEur, '5385.60', 'sanity: Q1 has a published price');
  assert.equal(q3.scenario.costEur, null, 'sanity: Q3 has no published price yet');

  const t = sumTotals([q1, q3]);
  assert.equal(t.pricedLines, 2, 'both lines priced in certificates — neither is refused');
  assert.equal(t.certificates, '142.93', 'certificates total is unaffected by the missing price');
  assert.equal(t.costEur, null, 'one missing price nulls the total, not just that line');
});

test('sumTotals([]) is the empty total, not a confirmed zero', () => {
  // certificates: '0' here means "nothing was summed", not "we priced this at
  // zero" — see the Totals.certificates doc comment. pricedLines: 0 is the
  // signal a caller must check before rendering '0' as a real figure.
  const t = sumTotals([]);
  assert.equal(t.certificates, '0');
  assert.equal(t.costEur, null, 'no priced line means no euro claim at all, not a 0.00');
  assert.equal(t.chargeableTco2e, '0');
  assert.equal(t.pricedLines, 0);
  assert.equal(t.refusedLines, 0);
  assert.equal(t.anyPending, false);
});
