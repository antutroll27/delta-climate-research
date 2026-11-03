// tests/unit/cbam-fingerprint.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

import { fingerprintBits, isRealDigest, renderFingerprint } from '../../src/scripts/cbam-ui/fingerprint.ts';

const bitString = (h) => fingerprintBits(h).map((b) => (b ? '1' : '0')).join('');

test('64 bits: the first 16 hex characters, most significant bit first', () => {
  const bits = fingerprintBits(`0123456789abcdef${'0'.repeat(48)}`);
  assert.equal(bits.length, 64);
  assert.equal(bitString(`0123456789abcdef${'0'.repeat(48)}`),
    '0000000100100011010001010110011110001001101010111100110111101111');
  assert.equal(bits.filter(Boolean).length, 32, 'the popcount of 0..f is 32');
});

test('the order matches the approved preview (snapshot f6af39ae…)', () => {
  assert.ok(bitString(`f6af39ae${'0'.repeat(56)}`).startsWith('11110110101011110011100110101110'));
});

test('case does not change the drawing, and characters past the 16th are not drawn', () => {
  const a = `ABCDEF0123456789${'1'.repeat(48)}`;
  const b = `abcdef0123456789${'f'.repeat(48)}`;
  assert.deepEqual(fingerprintBits(a), fingerprintBits(b));
});

test('a placeholder, or anything shorter than 16 hex characters, has no bits and no grid', () => {
  for (const s of ['not yet computed', 'unsealed-pack', '0123', '', `g${'0'.repeat(63)}`]) {
    assert.equal(fingerprintBits(s), null, s);
    assert.equal(renderFingerprint(s), '', s);
  }
});

test('the grid: 64 dots, hidden from assistive tech, and no hex text in it', () => {
  const h = '8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05';
  const html = renderFingerprint(h);
  assert.equal((html.match(/<i\b/g) ?? []).length, 64);
  assert.match(html, /^<div class="b-fp" aria-hidden="true">/);
  assert.doesNotMatch(html, /[0-9a-f]{6}/, 'the drawing must not carry the hash as text');
  assert.equal(renderFingerprint(h), html, 'deterministic');
  assert.match(renderFingerprint(h, 'b-fp-sm'), /^<div class="b-fp b-fp-sm"/);
});

test('isRealDigest: a hash of 16+ hex digits that is not all zeros; the placeholder and non-hash are not', () => {
  assert.equal(isRealDigest('8bbba79e7f33f0e4943140c28e91a8810612f2fa770bd6dcad33fdb7045e4c05'), true);
  assert.equal(isRealDigest('0123456789abcdef'), true);
  assert.equal(isRealDigest('0'.repeat(64)), false, 'the all-zero placeholder is not a hash');
  assert.equal(isRealDigest('0'.repeat(16)), false);
  assert.equal(isRealDigest('0123456789abcde'), false, 'fewer than 16 digits');
  assert.equal(isRealDigest('not-a-hash-not-a-hash'), false);
  assert.equal(isRealDigest(''), false);
  assert.equal(isRealDigest(null), false);
  assert.equal(isRealDigest(undefined), false);
});
