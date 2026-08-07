import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  yearOf, lineFingerprint, packSnapshotHash, thresholdByYear,
} from '../../src/scripts/cbam-lines.ts';

const pack = JSON.parse(readFileSync(
  fileURLToPath(new URL('../../public/cbam/estimator-pack.json', import.meta.url)), 'utf8'));

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

test('calendar years sort numerically, not lexicographically', () => {
  // Array.prototype.sort's default comparator is string-based: [2027, 2026, 10]
  // would sort to [10, 2026, 2027]. Not reachable with real years today, but the
  // fix is a one-token comparator and worth pinning so a future refactor can't
  // silently drop it back to the default.
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
