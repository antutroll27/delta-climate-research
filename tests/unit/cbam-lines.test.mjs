import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  yearOf, lineFingerprint, packSnapshotHash,
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
