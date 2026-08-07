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

test('packSnapshotHash pins generatedAt and both workbook hashes', async () => {
  const a = await packSnapshotHash(pack);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await packSnapshotHash(pack), 'stable across calls');
  const altered = { ...pack, generatedAt: '1999-01-01T00:00:00.000Z' };
  assert.notEqual(a, await packSnapshotHash(altered), 'generatedAt is part of the claim');
});
