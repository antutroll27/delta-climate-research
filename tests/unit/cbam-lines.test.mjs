import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import Decimal from 'decimal.js';

import {
  yearOf, lineFingerprint, packSnapshotHash, thresholdByYear, sumTotals, csvRows, toCsv,
} from '../../src/scripts/cbam-lines.ts';
import { estimateFromPack } from '../../src/scripts/cbam-algos/estimator/estimate-from-pack.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

// emissionsScope defaults to 'direct' here, NOT 'direct_and_indirect' (cbam-app.ts's own
// default, and line()'s below) — deliberately. Every existing call site in this file predates
// scope threading and was written against direct-only numbers; defaulting this helper to
// 'direct_and_indirect' would silently change every one of them (several goods this file
// tests, e.g. 25231000/DZ, DO carry a published indirect default) rather than fail loud. Tests
// that need to exercise the app's real default configuration pass 'direct_and_indirect'
// explicitly (see the indirect-emissions tests below).
const est = (cn, country, route, massT, date = '2026-03-15', emissionsScope = 'direct') =>
  estimateFromPack(pack, { cn, country, route, massT, date, emissionsScope });

// tier defaults to 'default+markup' — the tier every call site in this file was written
// against, back when it was the only tier the calculator had. Defaulting to it (rather than
// making each existing call pass one) keeps every pre-existing test's meaning EXACTLY as it
// was; the verified-tier tests below opt in explicitly, the same way the scope-threading tests
// opt into 'direct_and_indirect' on est().
const line = (over = {}) => ({
  id: 'L1', cn: '25231000', country: 'DZ', route: '(A)',
  scope: 'direct_and_indirect', massT: '30', date: '2026-03-15',
  tier: 'default+markup', ...over,
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

test('csvRows carries figures, locators and the §4 claims per row', () => {
  const lines2 = [line({ id: 'L1', massT: '100' })];
  const results = [est('25231000', 'DZ', '(A)', '100')];
  const rows = csvRows(lines2, results, fp, 'f'.repeat(64), pack);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.cn_code, '25231000');
  assert.equal(r.embedded_tco2e, '136.4');
  assert.equal(r.free_allocation_tco2e, '64.935');
  assert.equal(r.chargeable_tco2e, '71.465');
  assert.equal(r.cost_eur, '5385.60');
  assert.equal(r.cscf_status, 'pending (what-if)');
  assert.match(r.benchmark_locator, /2025\/2620 Annex/);
  assert.match(r.cbam_factor_locator, /Art 10a\(1a\)/);
  // cscf_locator was reachable but unasserted anywhere in this file until a mutation-testing
  // review found it — a legal citation surviving in an audit CSV with no test protecting it.
  assert.match(r.cscf_locator, /DR \(EU\) 2019\/331 Art 14\(6\)/);
  assert.equal(r.line_fingerprint, 'a'.repeat(64));
  assert.equal(r.pack_snapshot, 'f'.repeat(64));
  // NOT the general identity (see the design doc's 8 August 2026 correction and the dedicated
  // indirect-emissions/floor-clamp tests below for the real one). It holds here only because
  // this line's est() call defaults to 'direct' — indirect_tco2e is '0' and direct − faa is
  // already ≥ 0, so embedded − free_allocation and max(0, direct − faa) + indirect coincide.
  assert.equal(
    Number(r.embedded_tco2e) - Number(r.free_allocation_tco2e),
    Number(r.chargeable_tco2e));
});

test('a refused line exports its refusal, not empty-looking zeros', () => {
  const rows = csvRows(
    [line({ id: 'L1', cn: '72052100', country: 'IN', route: '(C)', massT: '60' })],
    [est('72052100', 'IN', '(C)', '60')], fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].status, 'unavailable');
  assert.equal(rows[0].certificates, '');
  assert.equal(rows[0].cost_eur, '');
});

test('a refused line blanks embedded and free-allocation too, not just certificates', () => {
  // Regression for a review finding on Task 4's draft: EstimateBase carries emissionsTco2e on
  // EVERY branch, including 'unavailable' (it sits outside the Priced intersection — see
  // certificate-estimate.ts), so an `'emissionsTco2e' in e` guard is always true and would leak
  // a number onto a refused row. Worse, estimateFromPack's `!factor` path seeds it with a '0'
  // placeholder that was never computed — exporting that reads as a confirmed zero-emission
  // line, the exact false claim this file's Totals.certificates doc already refuses. Gate on
  // status explicitly instead.
  const rows = csvRows(
    [line({ id: 'L1', cn: '72052100', country: 'IN', route: '(C)', massT: '60' })],
    [est('72052100', 'IN', '(C)', '60')], fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].direct_tco2e, '');
  assert.equal(rows[0].indirect_tco2e, '');
  assert.equal(rows[0].embedded_tco2e, '');
  assert.equal(rows[0].free_allocation_tco2e, '');
  assert.equal(rows[0].chargeable_tco2e, '');
});

test('free_allocation_tco2e is populated for a zero_by_fiat line too, not just a pending one', () => {
  // Regression for a review finding on Task 4's draft: the original code read
  // `pending ? e.scenario.faaTco2e : ''`, which exported an EMPTY free allocation for every
  // 'ok'/'zero_by_fiat' line while still exporting a chargeable_tco2e for it — silently
  // breaking the row's own identity (chargeable = embedded − free_allocation) for every
  // non-pending line. Electricity is zero_by_fiat with a real (zero) SEFA, reachable through
  // the real engine by extending the pack with a synthetic electricity row (same pattern as
  // the sumTotals mixed-total test above).
  const electricPack = {
    ...pack,
    classifications: [...pack.classifications, { code: '27160000', description: 'Electrical energy' }],
    defaultFactors: [...pack.defaultFactors, {
      scopeCode: '27160000', originCountry: 'DZ', emissionsType: 'direct',
      productionRoute: 'default', reportingYear: 2026, baseIntensity: '0.5', markupPct: '0',
    }],
  };
  const zero = estimateFromPack(electricPack, {
    cn: '27160000', country: 'DZ', route: 'default', massT: '10', date: '2026-03-15',
  });
  assert.equal(zero.status, 'zero_by_fiat');
  const rows = csvRows(
    [line({ id: 'L1', cn: '27160000', country: 'DZ', route: 'default', massT: '10' })],
    [zero], fp, 'f'.repeat(64), electricPack);
  const r = rows[0];
  assert.equal(r.embedded_tco2e, '5');
  assert.equal(r.free_allocation_tco2e, '0', 'Art 2(2): the deduction itself is nil, not the charge');
  assert.equal(r.chargeable_tco2e, '5');
  // The zero_by_fiat legal claim itself: a spec review mutated this exact string to garbage and
  // all 32 tests still passed. Pinned here, next to its two siblings ('published' above,
  // 'pending (what-if)' on the main csvRows test) — an unpinned legal claim on an audit
  // artefact is not acceptable in this file of all files.
  assert.equal(r.cscf_status, 'not applicable (Art 1(2): nil by law)');
  assert.equal(
    Number(r.embedded_tco2e) - Number(r.free_allocation_tco2e),
    Number(r.chargeable_tco2e));
});

test('free_allocation_tco2e is populated for a published (\'ok\') line too', () => {
  // Same regression as above, proven against the 'ok' branch specifically: the shipped pack's
  // CSCF is unpublished for every year it carries (2026-2030), so 'ok' is unreachable through
  // estimateFromPack over the real pack — publish 2026 at CSCF 1 (the same value the
  // cscf_pending scenario already assumes) to reach it honestly through the real engine.
  const publishedPack = {
    ...pack,
    cscf: pack.cscf.map((c) => (c.year === 2026 ? { ...c, value: '1', status: 'published' } : c)),
  };
  const ok = estimateFromPack(
    publishedPack, { cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15' });
  assert.equal(ok.status, 'ok');
  const rows = csvRows(
    [line({ id: 'L1', massT: '100' })], [ok], fp, 'f'.repeat(64), publishedPack);
  const r = rows[0];
  assert.equal(r.free_allocation_tco2e, '64.935', 'same SEFA math as the pending scenario, at CSCF 1');
  assert.equal(r.chargeable_tco2e, '71.465');
  assert.equal(r.cscf_status, 'published');
});

test('assumed_cscf pins the CSCF a cscf_pending line assumed, and blanks it everywhere else', () => {
  // Legally load-bearing (review finding): this column is the ONLY place a cscf_pending row's
  // assumed factor is written down. Eq 6 (§2.2 of the reference doc) feeds CSCF into the free
  // allocation calculation directly — without this column recorded, the certificate figure on
  // that row cannot be reconstructed from the CSV alone, since the CSCF value it assumed is
  // nowhere else in the exported artefact. Blanking the column unconditionally left the whole
  // suite green until this test existed.
  const pending = est('25231000', 'DZ', '(A)', '100');
  assert.equal(pending.status, 'cscf_pending', 'sanity: the shipped pack has no published CSCF');
  const pendingRow = csvRows(
    [line({ id: 'L1', massT: '100' })], [pending], fp, 'f'.repeat(64), pack)[0];
  assert.equal(pendingRow.assumed_cscf, '1',
    'a cscf_pending line must record the exact CSCF it assumed — the last value the Commission '
    + 'actually set (CSCF_2021_25, sefa.ts)');

  // 'ok': a published CSCF is a fact read off the pack, not an assumption — nothing to record.
  const publishedPack = {
    ...pack,
    cscf: pack.cscf.map((c) => (c.year === 2026 ? { ...c, value: '1', status: 'published' } : c)),
  };
  const ok = estimateFromPack(
    publishedPack, { cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15' });
  assert.equal(ok.status, 'ok');
  const okRow = csvRows(
    [line({ id: 'L1', massT: '100' })], [ok], fp, 'f'.repeat(64), publishedPack)[0];
  assert.equal(okRow.assumed_cscf, '', 'a published CSCF is a fact, not an assumption');

  // 'zero_by_fiat': electricity's nil allocation is by Art 1(2), not a CSCF-scaled calculation —
  // no CSCF was assumed because none was ever applied.
  const electricPack = {
    ...pack,
    classifications: [...pack.classifications, { code: '27160000', description: 'Electrical energy' }],
    defaultFactors: [...pack.defaultFactors, {
      scopeCode: '27160000', originCountry: 'DZ', emissionsType: 'direct',
      productionRoute: 'default', reportingYear: 2026, baseIntensity: '0.5', markupPct: '0',
    }],
  };
  const zero = estimateFromPack(electricPack, {
    cn: '27160000', country: 'DZ', route: 'default', massT: '10', date: '2026-03-15',
  });
  assert.equal(zero.status, 'zero_by_fiat');
  const zeroRow = csvRows(
    [line({ id: 'L1', cn: '27160000', country: 'DZ', route: 'default', massT: '10' })],
    [zero], fp, 'f'.repeat(64), electricPack)[0];
  assert.equal(zeroRow.assumed_cscf, '', 'nil-by-law free allocation assumes no CSCF at all');

  // 'unavailable': a refused line has no scenario, so no CSCF was assumed for one.
  const refused = est('72052100', 'IN', '(C)', '60');
  assert.equal(refused.status, 'unavailable');
  const refusedRow = csvRows(
    [line({ id: 'L1', cn: '72052100', country: 'IN', route: '(C)', massT: '60' })],
    [refused], fp, 'f'.repeat(64), pack)[0];
  assert.equal(refusedRow.assumed_cscf, '', 'a refused line has no scenario to have assumed a CSCF for');
});

test('a line resolving more than one benchmark term fails loud instead of dropping one', () => {
  // Regression for a review finding: terms.benchmarks carries one entry per precursor
  // (Eq 4 / Column A). The public estimator only ever runs scope='full_product' with no
  // precursors, so this is unreachable through estimateFromPack today — this test drives
  // csvRows directly with a hand-built two-benchmark CertificateEstimate (the shape sefa.ts
  // produces on the process_only/Eq 4 path) to prove the exporter refuses to silently
  // truncate to benchmarks[0] rather than to prove the path is reachable.
  const twoTermEstimate = {
    ...est('25231000', 'DZ', '(A)', '100'),
  };
  twoTermEstimate.terms = {
    ...twoTermEstimate.terms,
    benchmarks: [...twoTermEstimate.terms.benchmarks, { ...twoTermEstimate.terms.benchmarks[0] }],
  };
  assert.throws(
    () => csvRows([line({ id: 'L1', massT: '100' })], [twoTermEstimate], fp, 'f'.repeat(64), pack),
    /L1/);
});

test('est() threads emissionsScope through — the harness can express the app\'s default configuration', () => {
  // The regression this fixes: est() used to silently drop the scope argument, so a test could
  // build a line() with scope 'direct_and_indirect' (the fixture's own default, and
  // cbam-app.ts's) and still be computing a direct-only estimate underneath it — which is
  // exactly why the indirect-column defect below was invisible to Task 4's test suite.
  const directOnly = est('25231000', 'DZ', '(A)', '100');
  const withIndirect = est('25231000', 'DZ', '(A)', '100', '2026-03-15', 'direct_and_indirect');
  assert.equal(directOnly.status, 'cscf_pending');
  assert.equal(withIndirect.status, 'cscf_pending');
  assert.equal(directOnly.scenario.indirectTco2e, '0', 'direct-only leaves indirect at 0');
  // DZ/2026 publishes an indirect default per ROUTE, not one per good: (A) 0.04 and (B) 0.06.
  // This asked for route (A) but pinned 6.6 — route (B)'s 0.06 x 1.10 x 100 — because the
  // lookup ignored the route. Route (A)'s own electricity is 0.04 x 1.10 x 100 = 4.4.
  assert.equal(withIndirect.scenario.indirectTco2e, '4.4', 'a scope-threaded call reaches DZ/2026\'s published indirect default for the declared route');
});

test('the indirect case: free allocation deducts from the direct side only (the app\'s default scope)', () => {
  // cbam-app.ts:353 defaults emissionsScope to 'direct_and_indirect' — this is what the
  // calculator computes unless a user changes the select, not an edge case. Confirmed against
  // d434711: that commit's `embedded_tco2e - free_allocation_tco2e` identity produced 34.065
  // against a real chargeable_tco2e of 37.365 — off by exactly the indirect component (3.3),
  // because embedded_tco2e was direct-only there and indirect never entered the subtraction.
  const line1 = line({
    id: 'L1', cn: '25232900', country: 'AL', route: 'default', massT: '100',
    scope: 'direct_and_indirect',
  });
  const result = est('25232900', 'AL', 'default', '100', '2026-03-15', 'direct_and_indirect');
  assert.equal(result.status, 'cscf_pending');
  const rows = csvRows([line1], [result], fp, 'f'.repeat(64), pack);
  const r = rows[0];
  assert.equal(r.direct_tco2e, '99');
  assert.equal(r.indirect_tco2e, '3.3');
  assert.equal(r.embedded_tco2e, '102.3');
  assert.equal(r.free_allocation_tco2e, '64.935');
  assert.equal(r.chargeable_tco2e, '37.365');
  // The engine's real identity, reproducible from the CSV columns alone. Decimal, not plain
  // JS floats: 99 − 64.935 + 3.3 hits float drift (34.065 + 3.3 → 37.364999999999995 in IEEE
  // 754 double), the exact class of error this codebase uses decimal.js to avoid everywhere
  // else (see sumTotals's own doc comment above).
  assert.equal(
    Decimal.max(0, new Decimal(r.direct_tco2e).minus(r.free_allocation_tco2e))
      .plus(r.indirect_tco2e).toFixed(),
    r.chargeable_tco2e);
  assert.equal(new Decimal(r.direct_tco2e).plus(r.indirect_tco2e).toFixed(), r.embedded_tco2e);
});

test('the floor clamp: free allocation exceeding direct emissions never drives chargeable negative', () => {
  // NOT a hypothetical: dozens of real goods in the shipped 2026 direct-factor table clamp
  // here. cn 25070080 (calcined clay) / AO / route (A) is one — direct emissions (24.2) sit
  // below the good's own free-allocation benchmark (64.935 at CBAM factor 0.975, assumed CSCF
  // 1), so the deduction floors at zero and the entire charge is the indirect component (4.4)
  // alone: a clean producer paying only for the electricity it used, which is a normal live
  // outcome of this calculator, not an edge case.
  //
  // A prior version of this test claimed "no good in the shipped pack has a benchmark generous
  // enough to exceed its own direct emissions" and built a case by hand rather than reach for
  // one. That claim was never checked against the pack and was wrong — a spec reviewer scanned
  // all 10,930 direct-2026 factor rows and found dozens of goods that clamp, including this
  // one, 26011200/AU/default, 72071190/CA/(C), and several 72xx/73xx steel codes at AZ/(E). No
  // hand-built case is kept: real data exercises the same fields (direct_tco2e, indirect_tco2e,
  // embedded_tco2e, free_allocation_tco2e, chargeable_tco2e) that the hand-built one did, and
  // this line reaches status 'cscf_pending' (reading from e.scenario) the same way the
  // hand-built one exercised e.figure's 'ok' shape — already covered separately by "free_
  // allocation_tco2e is populated for a published ('ok') line too" above.
  const line1 = line({
    id: 'L1', cn: '25070080', country: 'AO', route: '(A)', massT: '100',
    scope: 'direct_and_indirect',
  });
  const result = est('25070080', 'AO', '(A)', '100', '2026-03-15', 'direct_and_indirect');
  assert.equal(result.status, 'cscf_pending');
  const rows = csvRows([line1], [result], fp, 'f'.repeat(64), pack);
  const r = rows[0];
  assert.equal(r.direct_tco2e, '24.2');
  assert.equal(r.indirect_tco2e, '4.4');
  assert.equal(r.embedded_tco2e, '28.6');
  assert.equal(r.free_allocation_tco2e, '64.935');
  assert.equal(r.chargeable_tco2e, '4.4', 'floored at zero on the direct side, then indirect added back — never negative');
  // the identity, in Decimal: max(0, direct − free_allocation) + indirect === chargeable
  assert.equal(
    Decimal.max(0, new Decimal(r.direct_tco2e).minus(r.free_allocation_tco2e))
      .plus(r.indirect_tco2e).toFixed(),
    r.chargeable_tco2e);
});

test('toCsv escapes commas and quotes and round-trips its own header', () => {
  const csv = toCsv([{ a: 'plain', b: 'has,comma', c: 'has "quote"' }]);
  assert.equal(csv.split('\n')[0], 'a,b,c');
  assert.equal(csv.split('\n')[1], 'plain,"has,comma","has ""quote"""');
});

test('toCsv quotes a bare CR the same as LF, not just commas and double quotes', () => {
  // Regression for a review finding: the quoting class was /[",\n]/ — no \r. cn_code is
  // free-typed, so a stray carriage return from a paste would reach the output unquoted. An
  // unquoted CR inside a field is itself malformed RFC 4180: Python's csv module rejects it
  // outright ('new-line character seen in unquoted field'), which is a worse failure than a
  // slightly-off cell — it makes the whole file unreadable by a common consumer.
  const csv = toCsv([{ cn_code: 'a\rb', safe: 'plain' }]);
  const [header, row] = csv.split('\n');
  assert.equal(header, 'cn_code,safe');
  assert.equal(row, '"a\rb",plain');
});

test('toCsv neutralises a formula-leading cell to block CSV injection', () => {
  // A cell opening with = + - @ is executed as a formula by Excel/Sheets on open, and this
  // artefact is explicitly designed to be opened in a spreadsheet. cn_code is free-typed by
  // the user and description comes from the pack — both would reach toCsv unescaped otherwise.
  const csv = toCsv([{
    formula: '=1+2', plusLead: '+SUM(A1)', minusLead: '-2+3', atLead: '@SUM(1)', safe: 'plain',
  }]);
  const [header, row] = csv.split('\n');
  assert.equal(header, 'formula,plusLead,minusLead,atLead,safe');
  assert.equal(row, "'=1+2,'+SUM(A1),'-2+3,'@SUM(1),plain");
});

test('toCsv throws on a row whose keys do not match row 0, rather than silently reshaping it', () => {
  // Regression for a review finding: the header is taken from row 0 alone. A later row with an
  // extra key would have that key silently dropped (never appears in any column); a row missing
  // a key would silently read as '' — both indistinguishable from a genuinely blank field, and
  // toCsv is general-purpose and exported, so it cannot assume every caller shapes rows the way
  // csvRows does.
  assert.throws(
    () => toCsv([{ a: '1', b: '2' }, { a: '3', c: '4' }]),
    /row 1/);
});

test('a line carries its tier, and the fingerprint pins attested figures as entered', async () => {
  const base = line({ id: 'L1' });
  const dflt = { ...base, tier: 'default+markup' };
  const ver  = { ...base, tier: 'actual-verified', seeDirect: '2.31', verifiedRef: 'BV-2026-0142' };
  const [a, b] = await Promise.all([lineFingerprint(dflt), lineFingerprint(ver)]);
  assert.notEqual(a, b, 'tier and figures must change the digest');
  // the reference alone must also change it — an attested claim is pinned as entered
  const c = await lineFingerprint({ ...ver, verifiedRef: 'BV-2026-0143' });
  assert.notEqual(b, c);
  // and a default line's digest is stable against the new optional fields being absent
  const d = await lineFingerprint({ ...base, tier: 'default+markup' });
  assert.equal(a, d);
});

test('two verified lines differing only in seeIndirect fingerprint differently', async () => {
  // seeDirect and verifiedRef are pinned by the test above; seeIndirect is the third attested
  // input and the easiest one to leave out of the hashed array by hand — it is optional, it is
  // only READ when emissionsScope is 'direct_and_indirect' (estimate-from-pack.ts's verified
  // branch gates on exactly that), and every fixture in this file that exercises the verified
  // path could omit it and still pass. But it multiplies straight into the charge: for a
  // cement or fertiliser line it IS a chunk of the certificate count, and free allocation
  // never deducts from it (it is added back after the direct-side floor — see the indirect
  // tests above). An importer who corrects 0.4 to 0.6 tCO2e/t and gets the same fingerprint
  // back has an audit trail that cannot tell the two submissions apart.
  const base = { ...line({ id: 'L1' }), tier: 'actual-verified', seeDirect: '2.31' };
  const a = await lineFingerprint({ ...base, seeIndirect: '0.4' });
  const b = await lineFingerprint({ ...base, seeIndirect: '0.6' });
  assert.notEqual(a, b, 'the attested indirect figure must be part of the digest');
  // and absent is not the same claim as zero: "no indirect figure supplied" and "attested at
  // nil" are different statements about what the importer had data for.
  assert.notEqual(a, await lineFingerprint(base), 'absent must differ from a supplied figure');
});

test('tier ALONE changes the fingerprint — the marked-up and the attested bill are distinguishable', async () => {
  // The test above varies tier, seeDirect and verifiedRef TOGETHER, so it cannot attribute the
  // difference to any one of them: deleting `line.tier` from the hashed array left all 39 tests
  // green (verified by mutation). tier is the single field that says whether the punitive
  // mark-up was applied at all — the mark-up prices NOT HAVING DATA, so a 'default+markup' line
  // and an 'actual-verified' line are opposite claims about what the importer could evidence.
  // Two lines carrying identical figures under different tiers must never share a digest, or
  // the audit trail can no longer say which bill it stamped.
  const a = await lineFingerprint(line({ tier: 'default+markup' }));
  const b = await lineFingerprint(line({ tier: 'actual-verified' }));
  assert.notEqual(a, b, 'the tier alone must change the digest — nothing else differs here');
});

test('an ABSENT attested figure is a different digest from an EMPTY one — different engine outcomes', async () => {
  // The previous implementer filled absent optionals with `?? ''` and argued the collision was
  // benign because "the engine's shape gate refuses '' anyway, so both mean no attested figure".
  // That is wrong: the shape gate NEVER SEES the absent case. estimate-from-pack.ts's verified
  // branch tests `input.verified.indirectTco2ePerT !== undefined` BEFORE calling verifiedPerT,
  // so absent skips the branch and the line PRICES (indirectTco2e '0'), while '' reaches
  // verifiedPerT, fails the shape gate and REFUSES the whole line. Probed against the real
  // engine on 25231000/DZ/(A)/100 t at direct_and_indirect: absent → cscf_pending, 166.065
  // certificates, EUR 12,514.66; '' → unavailable, no figure at all. A priced certificate count
  // and a refusal are not the same submission and must not carry the same fingerprint.
  const base = { ...line({ id: 'L1' }), tier: 'actual-verified', seeDirect: '2.31' };
  const { seeDirect: _drop, ...noDirect } = base;
  const pairs = [
    ['seeIndirect', base, { ...base, seeIndirect: '' }],
    ['seeDirect', noDirect, { ...noDirect, seeDirect: '' }],
    ['verifiedRef', base, { ...base, verifiedRef: '' }],
  ];
  for (const [field, absent, empty] of pairs) {
    assert.notEqual(
      await lineFingerprint(absent), await lineFingerprint(empty),
      `${field}: absent and empty-string are different claims and must digest differently`);
  }
});

test('the hashed field ORDER is pinned to a golden digest — a transposition cannot hide', async () => {
  // A GOLDEN LITERAL, and it has to be one. The obvious test — fingerprint {seeDirect:'X',
  // seeIndirect:'Y'} and {seeDirect:'Y', seeIndirect:'X'} and assert they differ — provably
  // CANNOT catch a transposition of those two elements, and asserting it would have been
  // security theatre. Transposing two positions in the hashed array is a BIJECTION on the input
  // space: it does not collapse any two lines together, it merely relabels which line gets
  // which digest. Measured on the real function: shipped, fp(X,Y)=9daaa162… and fp(Y,X)=
  // 3e8eb482…; transposed, fp(X,Y)=3e8eb482… and fp(Y,X)=9daaa162… — the same two digests,
  // swapped. `notEqual` holds identically before and after, and running the transposition
  // mutation against that assertion left the whole suite green.
  //
  // Every pair-comparison in this file has the same blind spot, because each one compares
  // fingerprints only to EACH OTHER. Detecting a reordering needs an anchor OUTSIDE the
  // function — a value computed once, from a known input, and written down. That is this
  // constant. It pins all ten positions at once, plus the JSON encoding and the null filler.
  //
  // The stakes are real: 2.31 direct / 0.4 indirect and 0.4 direct / 2.31 indirect are wildly
  // different bills, and free allocation deducts from the DIRECT side only (indirect is added
  // back after the floor — see the indirect tests above), so a swap does not cancel out.
  //
  // IF THIS TEST FAILS, the serialised form of the audit trail changed. That is not
  // automatically a bug — appending a new field at the end (the documented way to extend this)
  // will fail it too. But it must never change by ACCIDENT: every fingerprint already printed
  // on an exported CSV or a printable document was produced by the old form, so re-deriving it
  // from a line stops working the moment this value moves. Update the constant only alongside a
  // deliberate, documented change to the hashed array — never to make a red test go green.
  const fixture = line({
    id: 'L1', tier: 'actual-verified',
    seeDirect: '2.31', seeIndirect: '0.4', verifiedRef: 'BV-2026-0142',
  });
  assert.equal(
    await lineFingerprint(fixture),
    '2807c1968d0719c2b465cac434b938c0dd66eca54c475b383e7d87b5d04b0cab',
    'the hashed array\'s field order/encoding changed — see this test\'s comment before updating');

  // The default tier's shape, pinned the same way: same six leading facts, tier flipped, all
  // three optionals absent (the `?? null` fillers).
  //
  // WHAT THIS SECOND CONSTANT IS ACTUALLY FOR — corrected after review, because the first
  // version of this comment had it backwards and would have sent a reader chasing the wrong
  // failure. It is NOT a second guard against transposition: every optional here is `null`, so
  // swapping two of them is a no-op and this digest cannot move. The constant above is the one
  // that catches a transposed pair.
  //
  // This one is the ONLY assertion that pins the fixed-LENGTH shape. Drop the `?? null` fillers
  // so absent fields vanish instead of serialising, and the array truncates from ten elements to
  // seven — every relational test still passes, the constant above still passes (its optionals
  // are all present), and only this one fails. That is the property `lineFingerprint`'s own
  // doc comment promises: "field absent" must never be confusable with "array truncated".
  const dflt = line({ id: 'L1', tier: 'default+markup' });
  assert.equal(
    await lineFingerprint(dflt),
    '6e0def457815078246b0dc3a8e39bf7fb06434d5b39db0e25e368d2f2267b5cb',
    'the default-tier digest shape changed — see this test\'s comment before updating');
});

test('threshold maths ignores the tier — 50 t is 50 t', () => {
  const dflt = { ...line({ id: 'L1', massT: '60' }), tier: 'default+markup' };
  const ver  = { ...line({ id: 'L2', massT: '60' }), tier: 'actual-verified', seeDirect: '2.31' };
  const fps = new Map([['L1', 'a'.repeat(64)], ['L2', 'b'.repeat(64)]]);
  const [ya] = thresholdByYear([dflt], fps, new Set(), pack);
  const [yb] = thresholdByYear([ver],  fps, new Set(), pack);
  assert.equal(ya.state, yb.state);
  assert.equal(ya.knownEligibleMassT, yb.knownEligibleMassT);
});

// A real verified-tier estimate through the real engine — never a hand-built literal. The
// attested path is reached by passing `verified` to estimateFromPack, which overrides the
// defaults-path tier on the stamp ('actual-verified') and skips the mark-up entirely. Defaults
// to direct_and_indirect because line()'s own fixture scope is that, and a row whose scope
// column says one thing while its figures were computed at another is the very confusion the
// est() harness comment above already warns about.
const verEst = (over = {}) => estimateFromPack(pack, {
  cn: '25231000', country: 'DZ', route: '(A)', massT: '100', date: '2026-03-15',
  emissionsScope: 'direct_and_indirect', verified: { directTco2ePerT: '2.31' }, ...over,
});

test('CSV rows carry the data tier and the attested reference', () => {
  const l = line({
    id: 'L1', massT: '100', tier: 'actual-verified', seeDirect: '2.31',
    verifiedRef: 'BV-2026-0142',
  });
  const e = verEst();
  assert.equal(e.stamp.tier, 'actual-verified', 'sanity: the engine stamped the attested tier');
  const rows = csvRows([l], [e], fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].data_tier, 'actual-verified');
  assert.equal(rows[0].verified_reference, 'BV-2026-0142');
  // Column ORDER is part of the CSV's contract: toCsv derives the header from row 0 alone, and
  // a consumer's column mapping (an auditor's model, an importer's importer) is positional the
  // moment anyone writes one. Pinned by position, not just by presence — the two new columns
  // belong beside the other provenance/status columns, not appended after pack_snapshot.
  const keys = Object.keys(rows[0]);
  const i = keys.indexOf('cscf_status');
  assert.ok(i >= 0, 'sanity: cscf_status is still a column');
  assert.deepEqual(keys.slice(i + 1, i + 3), ['data_tier', 'verified_reference']);
});

test('a default-tier line writes its tier and an EMPTY reference, never the text "undefined"', () => {
  // Line.verifiedRef is optional, so `l.verifiedRef` alone is `undefined` on every default line —
  // and Record<string, string> does not stop it: `String(undefined)` is 'undefined', and toCsv's
  // own `r[c] ?? ''` only covers a MISSING key, not a present-but-undefined one. An auditor
  // opening the file would read the literal word "undefined" in a column that is meant to say
  // "no verifier reference was cited". The `?? ''` in csvRows is what keeps it blank.
  const rows = csvRows([line({ id: 'L1', massT: '100' })], [est('25231000', 'DZ', '(A)', '100')],
    fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].data_tier, 'default+markup');
  assert.equal(rows[0].verified_reference, '');
  assert.equal(typeof rows[0].verified_reference, 'string', 'not undefined, not null — a string');
  const csv = toCsv(rows);
  assert.ok(!csv.includes('undefined'), 'the literal text "undefined" must never reach the file');
});

test('a hostile reference cannot become a spreadsheet formula', () => {
  // verifiedRef is free-typed by the importer, exactly like cn_code, and this artefact is
  // explicitly built to be opened in a spreadsheet. This must pass because toCsv's cell()
  // neutralises by CONTENT, not by column — a new free-text column inherits the guard without
  // toCsv being told about it. If this ever fails, the guard has been narrowed to a column list
  // and every future free-text column is unprotected.
  const l = line({
    id: 'L1', massT: '100', tier: 'actual-verified', seeDirect: '2.31', verifiedRef: '=cmd()',
  });
  const csv = toCsv(csvRows([l], [verEst()], fp, 'f'.repeat(64), pack));
  assert.ok(!csv.includes(',=cmd()'), 'a formula-leading reference must not reach a cell raw');
  assert.ok(csv.includes(",'=cmd()"), 'and it must still be READABLE, neutralised by a leading quote');
});

test('csvRows refuses a line paired with an estimate computed at a different tier', () => {
  // The load-bearing half of this task. csvRows takes two parallel arrays and validated only
  // their LENGTH — nothing checked that results[i] was computed FROM lines[i]. The row it builds
  // is already a blend of line-sourced columns (cn_code, origin, mass_t, line_fingerprint) and
  // result-sourced figures, so a mispaired call exports the importer's attested inputs and their
  // verifier's reference NEXT TO a marked-up figure, labelled as the importer's own.
  const verifiedLine = line({
    id: 'L1', massT: '100', tier: 'actual-verified', seeDirect: '2.31',
    verifiedRef: 'BV-2026-0142',
  });
  const defaultEstimate = est('25231000', 'DZ', '(A)', '100');
  assert.equal(defaultEstimate.stamp.tier, 'default+markup', 'sanity: this one carries the mark-up');
  assert.throws(
    () => csvRows([verifiedLine], [defaultEstimate], fp, 'f'.repeat(64), pack),
    /L1/);
  assert.throws(
    () => csvRows([verifiedLine], [defaultEstimate], fp, 'f'.repeat(64), pack),
    /actual-verified/);
  // and the other direction: a default line handed a verified figure would DROP the mark-up
  // from an importer who had no data to justify dropping it.
  assert.throws(
    () => csvRows([line({ id: 'L2', massT: '100' })], [verEst()], fp, 'f'.repeat(64), pack),
    /L2/);
});

test('the tier guard does not fire on a legitimate refusal', () => {
  // 'unavailable' is a first-class answer here, not an error (certificate-estimate.ts's own
  // doc), and ProvenanceStamp.tier is set in baseOf — OUTSIDE the priced branches — so a refused
  // estimate carries a real tier like every other. A guard that read the tier off a priced-only
  // field would throw on every honest refusal and turn "we cannot price this" into a crashed
  // export. An unreadable attested figure is exactly how a user reaches this.
  const refused = verEst({ verified: { directTco2ePerT: 'abc' } });
  assert.equal(refused.status, 'unavailable');
  assert.equal(refused.stamp.tier, 'actual-verified', 'a refusal still knows which tier asked');
  const l = line({
    id: 'L1', massT: '100', tier: 'actual-verified', seeDirect: 'abc', verifiedRef: 'BV-2026-0142',
  });
  const rows = csvRows([l], [refused], fp, 'f'.repeat(64), pack);
  assert.equal(rows[0].status, 'unavailable');
  assert.equal(rows[0].certificates, '', 'still a refusal, not a number');
  assert.equal(rows[0].data_tier, 'actual-verified');
  assert.equal(rows[0].verified_reference, 'BV-2026-0142',
    'the reference stands even when the figure it cites was refused');
});

test('csvRows throws naming the mismatch when lines and results are different lengths', () => {
  // Regression for a review finding: results[i]! on a mismatch previously surfaced as a bare
  // TypeError with no line id and no counts — nothing a new caller (Tasks 5-8) could use to
  // find their bug. This file's own idiom is to name what's missing (packSnapshotHash's
  // missing-workbook-hash throw, thresholdByYear's missing-fingerprint throw); this matches it.
  assert.throws(
    () => csvRows([line({ id: 'L1' }), line({ id: 'L2' })], [est('25231000', 'DZ', '(A)', '100')],
      fp, 'f'.repeat(64), pack),
    /2 line\(s\) but 1 result\(s\)/);
});
