// tests/unit/relay-auth.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { MAX_SKEW_S, signV1, validKey, verifyV1 } from '../../src/lib/aqi/relay-auth.ts';

const VECTORS = JSON.parse(readFileSync(new URL('../fixtures/pi/hmac-vectors.json', import.meta.url), 'utf8'));
const KEY = 'a5'.repeat(32); // a test value, not a secret
const BODY = new TextEncoder().encode('<AqIndex/>');
const NOW = new Date('2026-09-27T00:00:00Z');
const TS = NOW.getTime() / 1000;
const headers = (ts, sig) => new Headers({ 'X-OBOS-Timestamp': String(ts), 'X-OBOS-Signature': sig });

test('signV1 reproduces every shared vector (the Go suite asserts the same file)', () => {
  assert.ok(VECTORS.length >= 4);
  for (const v of VECTORS) {
    assert.equal(signV1(v.key_hex, v.timestamp, Buffer.from(v.body_hex, 'hex')), v.expected_signature, v.name);
  }
});

test('verifyV1 accepts every shared vector at its own timestamp', () => {
  for (const v of VECTORS) {
    const r = verifyV1(v.key_hex, headers(v.timestamp, v.expected_signature), Buffer.from(v.body_hex, 'hex'), new Date(v.timestamp * 1000));
    assert.deepEqual(r, { ok: true }, v.name);
  }
});

test('a same-length wrong signature fails, wherever the difference is', () => {
  const good = signV1(KEY, TS, BODY);
  const flip = (s, i) => s.slice(0, i) + (s[i] === '0' ? '1' : '0') + s.slice(i + 1);
  for (const i of [3, 3 + 31, good.length - 1]) { // first hex char, middle, last
    assert.deepEqual(verifyV1(KEY, headers(TS, flip(good, i)), BODY, NOW), { ok: false, reason: 'mismatch' }, `flipped char ${i}`);
  }
});

test('the signature covers the body and the timestamp', () => {
  const good = signV1(KEY, TS, BODY);
  assert.deepEqual(verifyV1(KEY, headers(TS, good), new TextEncoder().encode('<AqIndex/> '), NOW), { ok: false, reason: 'mismatch' });
  assert.deepEqual(verifyV1(KEY, headers(TS - 1, good), BODY, new Date((TS - 1) * 1000)), { ok: false, reason: 'mismatch' });
});

test('the timestamp must be within 300 s of the server clock, either side', () => {
  assert.equal(MAX_SKEW_S, 300);
  for (const [dt, ok] of [[-300, true], [300, true], [-301, false], [301, false]]) {
    const ts = TS + dt;
    const r = verifyV1(KEY, headers(ts, signV1(KEY, ts, BODY)), BODY, NOW);
    assert.deepEqual(r, ok ? { ok: true } : { ok: false, reason: 'skew' }, `skew ${dt}`);
  }
});

test('missing or malformed headers are refused before any MAC is computed', () => {
  const good = signV1(KEY, TS, BODY);
  assert.deepEqual(verifyV1(KEY, new Headers(), BODY, NOW), { ok: false, reason: 'no_signature' });
  assert.deepEqual(verifyV1(KEY, headers(TS, good.toUpperCase()), BODY, NOW), { ok: false, reason: 'no_signature' });
  assert.deepEqual(verifyV1(KEY, headers(TS, good.slice(0, -2)), BODY, NOW), { ok: false, reason: 'no_signature' }, 'a truncated signature is malformed');
  assert.deepEqual(verifyV1(KEY, headers(TS, 'v2=' + good.slice(3)), BODY, NOW), { ok: false, reason: 'no_signature' });
  assert.deepEqual(verifyV1(KEY, headers('1.5e9', good), BODY, NOW), { ok: false, reason: 'bad_timestamp' });
  assert.deepEqual(verifyV1(KEY, headers('', good), BODY, NOW), { ok: false, reason: 'bad_timestamp' });
});

test('a key that is not at least 32 bytes of hex is no key at all', () => {
  assert.equal(validKey(KEY), true);
  assert.equal(validKey('A5'.repeat(32)), true, 'upper-case hex is hex');
  for (const bad of ['', 'zz'.repeat(32), 'a5'.repeat(31), 'a5'.repeat(32) + 'a']) {
    assert.equal(validKey(bad), false, JSON.stringify(bad));
    // An empty-key forgery: Buffer.from('zz…', 'hex') is empty, so this signature is computable by anyone.
    const forged = signV1('', TS, BODY);
    assert.deepEqual(verifyV1(bad, headers(TS, forged), BODY, NOW), { ok: false, reason: 'no_key' });
  }
});

test('the comparison is constant-time: timingSafeEqual, and no ===, !==, .equals or .compare in verifyV1', () => {
  const src = verifyV1.toString();
  assert.match(src, /timingSafeEqual\(/);
  assert.doesNotMatch(src, /===|!==|\.equals\(|\.compare\(/);
});
